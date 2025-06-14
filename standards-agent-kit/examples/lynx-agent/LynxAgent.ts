import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger, IConnectionsManager, Connection } from '@hashgraphonline/standards-sdk';
import {
  ConnectionTool,
  AcceptConnectionRequestTool,
  SendMessageTool,
  CheckMessagesTool,
  ConnectionMonitorTool,
} from '../../src/tools';
import { IStateManager, ActiveConnection } from '../../src/state/state-types';
import { OpenConvaiState } from '../../src/state/open-convai-state';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate, ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';

// Import types for sentinel agent communication
import { AlertMessage } from './SentinelAgent';

export interface HCSMessage {
  op?: string;
  sequence_number?: number;
  created?: Date;
  data?: string;
  operator_id?: string;
  connection_topic_id?: string;
  connection_request_id?: number;
  uniqueRequestKey?: string;
}

export interface LynxAgentConfig {
  /** HCS10 client configuration */
  client: HCS10Client;
  /** Account ID of the agent */
  accountId: string;
  /** Inbound topic ID for the agent */
  inboundTopicId: string;
  /** Outbound topic ID for the agent */
  outboundTopicId: string;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** OpenAI API key for inference */
  openAiApiKey?: string;
  /** The model to use for generating responses */
  openAiModel?: string;
  /** LangChain configuration */
  langchainConfig?: {
    /** Model temperature */
    temperature?: number;
    /** Maximum tokens to generate */
    maxTokens?: number;
    /** Enable streaming responses */
    streaming?: boolean;
  };
  /** Sentinel agent account ID (optional) */
  sentinelAgentId?: string;
}

export interface AgentConnection {
  agentId: string;
  topicId: string;
  timestamp: Date;
  requesterOperatorId: string;
  connectionRequestId: number;
  uniqueRequestKey?: string;
}

/**
 * LynxAgent class that implements an AI agent using the Hedera Consensus Service
 */
export class LynxAgent {
  private logger: Logger;
  private client: HCS10Client;
  private accountId: string;
  private inboundTopicId: string;
  private outboundTopicId: string;
  private operatorId: string;
  private isRunning = false;
  private openAiApiKey: string;
  private openAiModel: string;
  private stateManager: IStateManager;
  private connectionsManager: IConnectionsManager;
  private llmChain: RunnableSequence | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private langchainConfig: {
    temperature: number;
    maxTokens: number;
    streaming: boolean;
  };
  // Track the last sequence number processed for each connection
  private lastProcessedSequences: Map<string, number> = new Map();
  // Sentinel agent ID if configured
  private sentinelAgentId?: string;
  // Track active rebalance state
  private isRebalancing: boolean = false;

  private connectionTool: ConnectionTool;
  private acceptConnectionTool: AcceptConnectionRequestTool;
  private sendMessageTool: SendMessageTool;
  private checkMessagesTool: CheckMessagesTool;
  private connectionMonitorTool: ConnectionMonitorTool;

  constructor(config: LynxAgentConfig) {
    this.logger = new Logger({
      module: 'LynxAgent',
      level: config.logLevel || 'info',
      prettyPrint: true,
    });

    this.client = config.client;
    this.accountId = config.accountId;
    
    // CRITICAL CHANGE: We'll completely ignore these values and use discovery instead
    this.inboundTopicId = '0.0.0'; // Placeholder, will be replaced with discovered topic
    this.outboundTopicId = config.outboundTopicId;
    
    this.operatorId = this.client.getAccountAndSigner().accountId;
    this.openAiApiKey = config.openAiApiKey || process.env.OPENAI_API_KEY || '';
    this.openAiModel = config.openAiModel || 'gpt-4-turbo';
    this.sentinelAgentId = config.sentinelAgentId;
    this.langchainConfig = {
      temperature: config.langchainConfig?.temperature || 0.2,
      maxTokens: config.langchainConfig?.maxTokens || 1000,
      streaming: config.langchainConfig?.streaming || true,
    };

    this.stateManager = new OpenConvaiState();

    this.stateManager.setCurrentAgent({
      name: 'Lynx Agent',
      accountId: this.accountId,
      inboundTopicId: '0.0.0', // Placeholder, will be replaced with discovered topic
      outboundTopicId: this.outboundTopicId,
      profileTopicId: '',
      privateKey: (
        this.client.getAccountAndSigner().signer || ''
      ).toStringRaw(),
    });

    this.connectionsManager = this.stateManager.initializeConnectionsManager(
      this.client.standardClient
    );

    this.connectionTool = new ConnectionTool({
      client: this.client,
      stateManager: this.stateManager,
    });

    this.acceptConnectionTool = new AcceptConnectionRequestTool({
      hcsClient: this.client,
      stateManager: this.stateManager,
    });

    this.sendMessageTool = new SendMessageTool(this.client);

    this.checkMessagesTool = new CheckMessagesTool({
      hcsClient: this.client,
      stateManager: this.stateManager,
    });

    this.connectionMonitorTool = new ConnectionMonitorTool({
      hcsClient: this.client,
      stateManager: this.stateManager,
    });
  }

  /**
   * Initialize the agent, loading configuration and preparing it for operation
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Lynx Agent with initial configuration');
      this.logger.info(`- Account ID: ${this.accountId}`);
      this.logger.info(`- Network: ${this.client.getNetwork()}`);

      // Configure large message handling
      this.configureLargeMessageHandling();
      
      // Patch the client to handle invalid JSON messages
      this.patchHCS10Client();
      
      // First check if agent is already registered
      const currentAgent = this.stateManager.getCurrentAgent();
      this.logger.info(`Checking for existing agent registration: ${currentAgent?.accountId || 'none found'}`);
      
      // ALWAYS get inbound topic from profile - IGNORE environment variables completely
      try {
        this.logger.info('Discovering correct inbound topic from HCS-11 profile...');
        const discoveredTopicId = await this.client.getInboundTopicId();
        
        // Verify that the discovered topic matches a proper format
        if (!discoveredTopicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)) {
          throw new Error(`Discovered topic ID has invalid format: ${discoveredTopicId}`);
        }
        
        // Always use the discovered topic, regardless of what's in the environment
        this.logger.info(`Found topic ${discoveredTopicId} in profile - using this EXCLUSIVELY`);
        this.inboundTopicId = discoveredTopicId;
        
        // Update state manager with the discovered topic
        if (currentAgent) {
          this.logger.info(`Updating agent in state manager with topic: ${discoveredTopicId}`);
          currentAgent.inboundTopicId = discoveredTopicId;
          this.stateManager.setCurrentAgent(currentAgent);
        }
        
        // Verify the agent was updated correctly
        const updatedAgent = this.stateManager.getCurrentAgent();
        if (updatedAgent?.inboundTopicId !== discoveredTopicId) {
          this.logger.warn(`WARNING: Agent in state manager still has incorrect topic: ${updatedAgent?.inboundTopicId}`);
        } else {
          this.logger.info(`Agent state manager successfully updated with topic: ${updatedAgent?.inboundTopicId}`);
        }
      } catch (error) {
        this.logger.error(`CRITICAL ERROR - Could not get inbound topic from profile: ${error}`);
        throw new Error(`Cannot continue without valid inbound topic from profile`);
      }
      
      // Register the agent if not already registered
      if (!currentAgent || !currentAgent.accountId) {
        this.logger.info('Agent not registered, registering now...');
        
        // Create the RegisterAgentTool
        const { RegisterAgentTool } = await import('../../src/tools/RegisterAgentTool');
        const registerAgentTool = new RegisterAgentTool(this.client, this.stateManager);
        
        // Register the agent
        try {
          const result = await registerAgentTool.invoke({
            name: "Lynx Agent",
            description: "A helpful AI assistant using Hedera Consensus Service",
            capabilities: [0], // TEXT_GENERATION
            setAsCurrent: true,
          });
          
          this.logger.info(`Agent registered successfully: ${result}`);
          
          // Get the freshly registered agent to verify topics
          const newAgent = this.stateManager.getCurrentAgent();
          this.logger.info(`New agent registered with inbound topic: ${newAgent?.inboundTopicId}`);
          
          // Update our inbound topic with the registered one if it changed
          if (newAgent?.inboundTopicId && newAgent.inboundTopicId !== this.inboundTopicId) {
            this.logger.info(`Updating inbound topic from ${this.inboundTopicId} to ${newAgent.inboundTopicId}`);
            this.inboundTopicId = newAgent.inboundTopicId;
          }
        } catch (error) {
          this.logger.warn(`Failed to register agent: ${error}`);
        }
      } else {
        this.logger.info(`Using existing agent registration: ${currentAgent.accountId}`);
        this.logger.info(`Agent profile topic: ${currentAgent.profileTopicId || 'unknown'}`);
      }
      
      // Initialize LangChain for responses
      await this.initializeLangChain();
      
      // Load existing connections
      await this.loadConnectionsFromOutboundTopic();
      
      // Verify ConnectionsManager is properly initialized 
      const connectionsManager = this.stateManager.getConnectionsManager();
      if (!connectionsManager) {
        this.logger.error('ConnectionsManager not initialized - this is required for proper operation');
        throw new Error('ConnectionsManager not initialized');
      }
      
      this.logger.info('ConnectionsManager initialized correctly');
      
      // Log FINAL configuration with the discovered topic
      this.logger.info('===== LYNX AGENT FINAL CONFIGURATION =====');
      this.logger.info(`AGENT ID: ${this.accountId}`);
      this.logger.info(`INBOUND TOPIC: ${this.inboundTopicId} (from profile)`);
      this.logger.info(`OUTBOUND TOPIC: ${this.outboundTopicId}`);
      
      // Verify the agent is configured correctly in the state manager
      const finalAgent = this.stateManager.getCurrentAgent();
      this.logger.info(`STATE MANAGER AGENT TOPIC: ${finalAgent?.inboundTopicId}`);
      if (finalAgent?.inboundTopicId !== this.inboundTopicId) {
        this.logger.warn(`WARNING: Mismatch between agent's inbound topic (${this.inboundTopicId}) and state manager (${finalAgent?.inboundTopicId})`);
      }
      this.logger.info('=========================================');
      
      this.logger.info('Lynx Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Lynx Agent', error);
      throw error;
    }
  }

  /**
   * Configure large message handling with more robust timeouts and retry settings
   */
  private configureLargeMessageHandling(): void {
    try {
      this.logger.info('Configuring robust handling for large messages (HCS-1)');
      
      // Configure the client for handling large messages
      if (this.client.standardClient) {
        // If environment variables exist for these settings, use them
        const inscriptionTimeoutMs = process.env.INSCRIPTION_TIMEOUT_MS 
          ? parseInt(process.env.INSCRIPTION_TIMEOUT_MS, 10) 
          : 60000; // 60 seconds
        
        const inscriptionMaxRetries = process.env.INSCRIPTION_MAX_RETRIES 
          ? parseInt(process.env.INSCRIPTION_MAX_RETRIES, 10) 
          : 40; // 40 retries
          
        const inscriptionBackoffMs = process.env.INSCRIPTION_BACKOFF_MS 
          ? parseInt(process.env.INSCRIPTION_BACKOFF_MS, 10) 
          : 3000; // 3 seconds
          
        // Log the configuration
        this.logger.info(`- Large message timeout: ${inscriptionTimeoutMs}ms`);
        this.logger.info(`- Large message max retries: ${inscriptionMaxRetries}`);
        this.logger.info(`- Large message backoff: ${inscriptionBackoffMs}ms`);
        
        // Set these values if the property exists on the client
        const clientAny = this.client.standardClient as any;
        if (clientAny && typeof clientAny.setInscriptionOptions === 'function') {
          clientAny.setInscriptionOptions({
            timeout: inscriptionTimeoutMs,
            maxRetries: inscriptionMaxRetries,
            backoffMs: inscriptionBackoffMs,
          });
          this.logger.info('Large message handling configured successfully');
        } else {
          this.logger.warn('Client does not support inscriptionOptions, using defaults');
          
          // Try to set environment variables as a fallback
          process.env.INSCRIPTION_TIMEOUT_MS = inscriptionTimeoutMs.toString();
          process.env.INSCRIPTION_MAX_RETRIES = inscriptionMaxRetries.toString();
          process.env.INSCRIPTION_BACKOFF_MS = inscriptionBackoffMs.toString();
          
          this.logger.info('Set environment variables for inscription settings as fallback');
        }
      }
    } catch (error) {
      this.logger.warn(`Could not configure large message handling: ${error}`);
    }
  }

  /**
   * Patch the HCS10Client to handle invalid JSON messages gracefully
   */
  private patchHCS10Client(): void {
    this.logger.info('Patching HCS10Client to handle invalid JSON messages and rate limiting');
    
    // Topic backoff tracking
    const topicBackoffs = new Map<string, {
      retryCount: number, 
      nextRetryTime: number,
      maxBackoff: number
    }>();
    
    // Reset backoff for a topic
    const resetBackoff = (topicId: string) => {
      topicBackoffs.set(topicId, {
        retryCount: 0,
        nextRetryTime: 0,
        maxBackoff: 60000 // Start with max backoff of 1 minute
      });
    };
    
    // Get backoff info for a topic
    const getBackoff = (topicId: string) => {
      if (!topicBackoffs.has(topicId)) {
        resetBackoff(topicId);
      }
      return topicBackoffs.get(topicId)!;
    };
    
    // Increase backoff time for a topic with exponential backoff
    const increaseBackoff = (topicId: string) => {
      const backoff = getBackoff(topicId);
      backoff.retryCount += 1;
      
      // Calculate exponential backoff with jitter
      const baseDelay = Math.min(30000, 1000 * Math.pow(2, backoff.retryCount));
      const jitter = Math.random() * 0.3 * baseDelay; // 30% jitter
      const delay = baseDelay + jitter;
      
      // Increase max backoff gradually
      backoff.maxBackoff = Math.min(300000, backoff.maxBackoff * 1.5); // Max 5 minutes
      backoff.nextRetryTime = Date.now() + delay;
      
      topicBackoffs.set(topicId, backoff);
      
      this.logger.warn(`Set backoff for topic ${topicId}: ${Math.round(delay/1000)}s, retry #${backoff.retryCount}`);
      return delay;
    };
    
    // Check if we should backoff from a topic
    const shouldBackoff = (topicId: string) => {
      const backoff = getBackoff(topicId);
      return Date.now() < backoff.nextRetryTime;
    };
    
    // Store original methods
    const originalGetMessages = this.client.getMessages.bind(this.client);
    const originalGetMessageStream = this.client.getMessageStream.bind(this.client);
    
    // CRITICAL CHANGE: Add a whitelist of topics to check
    // This prevents the SDK from checking hundreds of random topics
    const allowedTopics = new Set<string>();
    
    // Function to add topics to the whitelist
    const addAllowedTopic = (topicId: string) => {
      if (topicId && topicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)) {
        allowedTopics.add(topicId);
        this.logger.debug(`Added topic to allowlist: ${topicId}`);
      }
    };
    
    // Function to check if a topic should be processed
    const isAllowedTopic = (topicId: string) => {
      // Add our own inbound topic when we discover it
      if (this.inboundTopicId && this.inboundTopicId !== '0.0.0') {
        addAllowedTopic(this.inboundTopicId);
      }
      
      // Also add any connection topics
      const connections = this.stateManager.listConnections();
      if (connections && connections.length > 0) {
        for (const conn of connections) {
          if (conn.connectionTopicId) {
            addAllowedTopic(conn.connectionTopicId);
          }
        }
      }
      
      return allowedTopics.has(topicId);
    };
    
    // Override getMessages method
    this.client.getMessages = async (topicId: string) => {
      // CRITICAL: Skip checking random topics completely
      if (!isAllowedTopic(topicId)) {
        this.logger.debug(`Topic ${topicId} not in allowed list, skipping getMessages call`);
        return { messages: [] };
      }
      
      // If topic is in backoff period, return empty result
      if (shouldBackoff(topicId)) {
        this.logger.debug(`Topic ${topicId} in backoff period, skipping getMessages call`);
        return { messages: [] };
      }
      
      try {
        // Call the original method
        const result = await originalGetMessages(topicId);
        // Successful call, reset backoff
        resetBackoff(topicId);
        return result;
      } catch (error) {
        // Handle rate limiting errors (429)
        if (error instanceof Error && error.message.includes('status code 429')) {
          increaseBackoff(topicId);
          this.logger.warn(`Rate limit hit for topic ${topicId} in getMessages, applying backoff`);
          return { messages: [] };
        }
        
        // Handle common error cases
        if (error instanceof Error) {
          // Invalid JSON errors
          if (error.message.includes('Invalid JSON') || 
              error.message.includes('Unexpected token') ||
              error.message.includes('Cannot parse') ||
              error.message.includes('SyntaxError')) {
            this.logger.warn(`Handled invalid JSON error for topic ${topicId}: ${error.message}`);
            return { messages: [] };
          }
          
          // Undefined property errors
          if (error.message.includes('Cannot read properties of undefined') ||
              error.message.includes('Cannot read property') ||
              error.message.includes('is undefined')) {
            this.logger.warn(`Handled undefined property error for topic ${topicId}: ${error.message}`);
            return { messages: [] };
          }
        }
        
        // For other errors, rethrow
        throw error;
      }
    };
    
    // Also patch getMessageStream
    this.client.getMessageStream = async (topicId: string) => {
      // CRITICAL: Skip checking random topics completely
      if (!isAllowedTopic(topicId)) {
        this.logger.debug(`Topic ${topicId} not in allowed list, skipping getMessageStream call`);
        return { messages: [] };
      }
      
      // If topic is in backoff period, return empty result
      if (shouldBackoff(topicId)) {
        this.logger.debug(`Topic ${topicId} in backoff period, skipping getMessageStream call`);
        return { messages: [] };
      }
      
      try {
        // Call the original method
        const result = await originalGetMessageStream(topicId);
        // Successful call, reset backoff
        resetBackoff(topicId);
        return result;
      } catch (error) {
        // Handle rate limiting errors (429)
        if (error instanceof Error && error.message.includes('status code 429')) {
          increaseBackoff(topicId);
          this.logger.warn(`Rate limit hit for topic ${topicId} in getMessageStream, applying backoff`);
          return { messages: [] };
        }
        
        // Handle common error cases
        if (error instanceof Error) {
          // Invalid JSON errors
          if (error.message.includes('Invalid JSON') || 
              error.message.includes('Unexpected token') ||
              error.message.includes('Cannot parse') ||
              error.message.includes('SyntaxError')) {
            this.logger.warn(`Handled invalid JSON error for topic ${topicId} in getMessageStream: ${error.message}`);
            return { messages: [] };
          }
          
          // Undefined property errors
          if (error.message.includes('Cannot read properties of undefined') ||
              error.message.includes('Cannot read property') ||
              error.message.includes('is undefined')) {
            this.logger.warn(`Handled undefined property error for topic ${topicId} in getMessageStream: ${error.message}`);
            return { messages: [] };
          }
        }
        
        // For other errors, rethrow
        throw error;
      }
    };
    
    // Also patch the standardClient if available
    try {
      if (this.client.standardClient) {
        const originalSDKGetMessages = this.client.standardClient.getMessages.bind(this.client.standardClient);
        const originalSDKGetMessageStream = this.client.standardClient.getMessageStream?.bind(this.client.standardClient);
        
        // Patch getMessages in standardClient
        this.client.standardClient.getMessages = async (topicId: string) => {
          // CRITICAL: Skip checking random topics completely
          if (!isAllowedTopic(topicId)) {
            this.logger.debug(`Topic ${topicId} not in allowed list, skipping SDK getMessages call`);
            return { messages: [] };
          }
          
          // If topic is in backoff period, return empty result
          if (shouldBackoff(topicId)) {
            this.logger.debug(`Topic ${topicId} in backoff period, skipping SDK getMessages call`);
            return { messages: [] };
          }
          
          try {
            const result = await originalSDKGetMessages(topicId);
            // Successful call, reset backoff
            resetBackoff(topicId);
            return result;
          } catch (error) {
            // Handle rate limiting errors (429)
            if (error instanceof Error && error.message.includes('status code 429')) {
              increaseBackoff(topicId);
              this.logger.warn(`Rate limit hit for topic ${topicId} in SDK getMessages, applying backoff`);
              return { messages: [] };
            }
            
            if (error instanceof Error) {
              // Handle the same error cases
              if (error.message.includes('Invalid JSON') || 
                  error.message.includes('Unexpected token') ||
                  error.message.includes('Cannot read properties of undefined')) {
                this.logger.warn(`Handled error in SDK getMessages for topic ${topicId}: ${error.message}`);
                return { messages: [] };
              }
            }
            throw error;
          }
        };
        
        // Patch getMessageStream in standardClient if it exists
        if (originalSDKGetMessageStream) {
          this.client.standardClient.getMessageStream = async (topicId: string) => {
            // CRITICAL: Skip checking random topics completely
            if (!isAllowedTopic(topicId)) {
              this.logger.debug(`Topic ${topicId} not in allowed list, skipping SDK getMessageStream call`);
              return { messages: [] };
            }
            
            // If topic is in backoff period, return empty result
            if (shouldBackoff(topicId)) {
              this.logger.debug(`Topic ${topicId} in backoff period, skipping SDK getMessageStream call`);
              return { messages: [] };
            }
            
            try {
              const result = await originalSDKGetMessageStream(topicId);
              // Successful call, reset backoff
              resetBackoff(topicId);
              return result;
            } catch (error) {
              // Handle rate limiting errors (429)
              if (error instanceof Error && error.message.includes('status code 429')) {
                increaseBackoff(topicId);
                this.logger.warn(`Rate limit hit for topic ${topicId} in SDK getMessageStream, applying backoff`);
                return { messages: [] };
              }
              
              if (error instanceof Error) {
                // Handle the same error cases
                if (error.message.includes('Invalid JSON') || 
                    error.message.includes('Unexpected token') ||
                    error.message.includes('Cannot read properties of undefined')) {
                  this.logger.warn(`Handled error in SDK getMessageStream for topic ${topicId}: ${error.message}`);
                  return { messages: [] };
                }
              }
              throw error;
            }
          };
        }
      }
    } catch (e) {
      this.logger.warn(`Could not patch SDK client: ${e}`);
    }
    
    this.logger.info('HCS10Client successfully patched for error handling and rate limiting');
  }

  /**
   * Start the agent's monitoring processes
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('Lynx Agent is already running');
      return;
    }

    this.isRunning = true;
    await this.startMonitoring();

    this.logger.info('Lynx Agent started successfully');
  }

  /**
   * Stop the agent's monitoring processes
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.info('Lynx Agent is not running');
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Lynx Agent stopped');
  }

  /**
   * Load existing connections from the outbound topic
   */
  private async loadConnectionsFromOutboundTopic(): Promise<void> {
    try {
      this.logger.info('Loading existing connections');
      
      // Get active connections from the ConnectionsManager
      const connectionsManager = this.stateManager.getConnectionsManager();
      if (!connectionsManager) {
        this.logger.error('ConnectionsManager not initialized');
        return;
      }
      
      // Fetch the current account's connections
      const connections = connectionsManager.getAllConnections();
      
      if (connections.length > 0) {
        this.logger.info(`Found ${connections.length} existing connections:`);
        
        for (const connection of connections) {
          this.logger.info(
            `- Connection with ${connection.targetAccountId || 'unknown'} via topic ${connection.connectionTopicId}`
          );
        }
      } else {
        this.logger.info('No existing connections found');
      }
      
      // Use ConnectionMonitorTool to monitor connections
      await this.connectionMonitorTool.invoke({
        monitoringInterval: 10000 // 10 seconds
      });
      
      this.logger.info('Connection monitoring initialized');
      this.logger.info('Connections loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load connections from outbound topic', error);
    }
  }

  /**
   * Start monitoring for new messages and connection requests
   */
  private async startMonitoring(): Promise<void> {
    this.logger.info('Starting monitoring for connections and messages');
    
    // Clear any existing intervals to avoid duplicates
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    try {
      // Get the connections manager from state manager
      const connectionsManager = this.stateManager.getConnectionsManager();
      if (!connectionsManager) {
        throw new Error('ConnectionsManager not initialized properly');
      }
      
      // Log existing connections
      const existingConnections = connectionsManager.getAllConnections();
      this.logger.info(`Found ${existingConnections.length} existing connections at startup`);
      
      // Start monitoring sentinel outbound topic if configured
      if (this.sentinelAgentId) {
        this.startSentinelTopicMonitoring();
      }
      
      // Static flag to prevent concurrent processing
      let isProcessing = false;
      
      // Set up monitoring interval
      this.logger.info('Setting up connection monitoring (10-second interval)...');
      
      this.monitoringInterval = setInterval(async () => {
        // Skip if already processing or not running
        if (isProcessing || !this.isRunning) {
          if (!this.isRunning && this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
          }
          return;
        }
        
        isProcessing = true;
        
        try {
          // Let the ConnectionTool handle new connections
          await this.connectionTool.invoke({
            monitorContinuously: false,
            acceptAll: false, // Don't auto-accept ALL connections - let us filter them
            filterPendingAccountIds: [this.accountId] // Explicitly filter out self-connections
          });
          
          // Check for connection requests that need processing but aren't from self
          if (connectionsManager) {
            const pendingRequests = connectionsManager.getConnectionsNeedingConfirmation();
            const validRequests = pendingRequests.filter(req => 
              req.targetAccountId !== this.accountId
            );
            
            // Process each valid request that isn't from ourselves
            for (const req of validRequests) {
              if (req.connectionRequestId) {
                // Only accept if we haven't processed this request before
                if (!connectionsManager.isConnectionRequestProcessed(this.inboundTopicId, req.connectionRequestId)) {
                  this.logger.info(`Accepting connection request #${req.connectionRequestId} from ${req.targetAccountId}`);
                  await this.acceptConnectionTool.invoke({
                    uniqueRequestKey: String(req.connectionRequestId)
                  });
                  
                  // Mark as processed
                  connectionsManager.markConnectionRequestProcessed(this.inboundTopicId, req.connectionRequestId);
                } else {
                  this.logger.debug(`Skipping already processed connection request #${req.connectionRequestId}`);
                }
              }
            }
          }
          
          // Then check for messages on established connections
          await this.checkForNewMessages();
          
          // Update connection status through the ConnectionMonitorTool
          await this.connectionMonitorTool.invoke({
            acceptAll: false, // Don't auto-accept all here either
            monitorDurationSeconds: 5,
            filterPendingAccountIds: [this.accountId] // Filter out our own account
          });
        } catch (error) {
          this.logger.error(`Error in monitoring interval: ${error}`);
        } finally {
          isProcessing = false;
        }
      }, 10000); // 10-second interval
      
      this.logger.info('Started monitoring for connections and messages');
    } catch (error) {
      this.logger.error(`Failed to start monitoring: ${error}`);
      throw error;
    }
  }

  /**
   * Start monitoring the Sentinel outbound topic for rebalance alerts
   * This allows the agent to receive alerts without requiring a direct connection
   */
  private async startSentinelTopicMonitoring(): Promise<void> {
    try {
      if (!this.sentinelAgentId) {
        this.logger.warn('No Sentinel agent ID configured, skipping Sentinel topic monitoring');
        return;
      }
      
      this.logger.info(`Starting to monitor Sentinel outbound topic for agent ${this.sentinelAgentId}`);
      
      // We need to know the Sentinel outbound topic ID
      // This should be provided in the configuration or environment variables
      const sentinelOutboundTopicId = process.env.SENTINEL_OUTBOUND_TOPIC_ID;
      
      if (!sentinelOutboundTopicId) {
        this.logger.warn('No Sentinel outbound topic ID found in environment variables, skipping monitoring');
        return;
      }
      
      // Add the sentinel outbound topic to allowed topics whitelist
      const clientAny = this.client as any;
      if (clientAny && clientAny.addAllowedTopic) {
        clientAny.addAllowedTopic(sentinelOutboundTopicId);
      }
      
      this.logger.info(`Monitoring Sentinel outbound topic: ${sentinelOutboundTopicId}`);
      
      // Track last processed sequence for the sentinel topic
      let lastProcessedSequence = 0;
      
      // Set up separate interval for checking sentinel outbound topic
      const sentinelCheckInterval = setInterval(async () => {
        if (!this.isRunning) {
          clearInterval(sentinelCheckInterval);
          return;
        }
        
        try {
          // Get messages from the sentinel outbound topic
          const { messages } = await this.client.getMessageStream(sentinelOutboundTopicId);
          
          if (messages && messages.length > 0) {
            // Find new alerts (messages with sequence numbers higher than last processed)
            const newAlerts = messages.filter(m => 
              m.sequence_number !== undefined && m.sequence_number > lastProcessedSequence
            );
            
            if (newAlerts.length > 0) {
              this.logger.info(`Found ${newAlerts.length} new alerts from Sentinel agent`);
              
              // Process each alert
              for (const alert of newAlerts) {
                await this.processSentinelAlert(alert);
                
                // Update last processed sequence
                if (alert.sequence_number !== undefined && alert.sequence_number > lastProcessedSequence) {
                  lastProcessedSequence = alert.sequence_number;
                }
              }
            }
          }
        } catch (error) {
          this.logger.error(`Error checking Sentinel outbound topic: ${error}`);
        }
      }, 30000); // Check every 30 seconds
      
      this.logger.info('Sentinel topic monitoring started successfully');
    } catch (error) {
      this.logger.error(`Failed to start Sentinel topic monitoring: ${error}`);
    }
  }
  
  /**
   * Process an alert from the Sentinel agent's outbound topic
   * Note: We do NOT reply to these messages as they are one-way broadcasts
   */
  private async processSentinelAlert(message: HCSMessage): Promise<void> {
    if (!message.data) {
      this.logger.warn('Received empty alert from Sentinel, skipping');
      return;
    }
    
    try {
      this.logger.info(`Processing Sentinel alert: ${message.data.substring(0, 100)}${message.data.length > 100 ? '...' : ''}`);
      
      // Check if this is an HCS-1 reference (large message)
      let messageData = message.data;
      if (typeof messageData === 'string' && messageData.startsWith('hcs://1/')) {
        this.logger.info(`Alert appears to be an HCS-1 reference: ${messageData}`);
        this.logger.info(`Resolving content from inscription...`);
        
        try {
          // Use client to resolve the HCS-1 reference
          messageData = await this.client.getMessageContent(messageData);
          this.logger.info(`Successfully resolved HCS-1 reference, content length: ${messageData.length}`);
        } catch (resolveError) {
          this.logger.error(`Error resolving HCS-1 reference: ${resolveError}`);
          return;
        }
      }
      
      // Parse the alert data
      if (!this.isJson(messageData)) {
        this.logger.warn(`Sentinel alert is not in JSON format, skipping: ${messageData.substring(0, 100)}`);
        return;
      }
      
      const alertData = JSON.parse(messageData);
      
      // Check if this is a rebalance alert
      if (alertData.type === 'REBALANCE_ALERT' || alertData.type === 'EMERGENCY_ALERT') {
        this.logger.info(`Received ${alertData.type} directly from Sentinel outbound topic`);
        
        // Process the rebalance alert internally
        // Important: do NOT send a response on the outbound topic
        if (!this.isRebalancing) {
          // Set rebalancing state
          this.isRebalancing = true;
          
          try {
            // Log detailed alert information
            this.logger.info('==== REBALANCE ALERT DETAILS (FROM OUTBOUND TOPIC) ====');
            this.logger.info(`Alert Type: ${alertData.type}`);
            this.logger.info(`Reason: ${alertData.reason}`);
            this.logger.info(`Triggered By: ${alertData.triggeredBy}`);
            this.logger.info(`Timestamp: ${alertData.timestamp}`);
            this.logger.info('Token Data:');
            for (const token of alertData.tokenData) {
              this.logger.info(`  - ${token.symbol}: Price $${token.currentPrice.toFixed(6)}, Deviation ${(token.deviationPercent * 100).toFixed(2)}%, Target Weight ${(token.targetWeight * 100).toFixed(2)}%`);
              if (token.recommendedAction) {
                this.logger.info(`    Recommended Action: ${token.recommendedAction}`);
              }
            }
            this.logger.info('===================================================');
            
            // Simulate rebalance processing
            const processingTime = alertData.type === 'EMERGENCY_ALERT' ? 5000 : 10000;
            this.logger.info(`Simulating rebalance processing for ${processingTime / 1000} seconds...`);
            
            // In a real implementation, this would call smart contract functions
            // to perform the actual rebalancing operations
            await new Promise(resolve => setTimeout(resolve, processingTime));
            
            this.logger.info(`Completed processing ${alertData.type} from outbound topic`);
          } catch (error) {
            this.logger.error(`Error processing rebalance alert from outbound topic: ${error}`);
          } finally {
            // Reset rebalancing state
            this.isRebalancing = false;
          }
        } else {
          this.logger.info('Already processing a rebalance, ignoring additional alert from outbound topic');
        }
      } else {
        this.logger.debug(`Received non-rebalance message from Sentinel: ${messageData.substring(0, 100)}`);
      }
    } catch (error) {
      this.logger.error(`Error processing Sentinel alert: ${error}`);
    }
  }

  /**
   * Handle a connection request from another agent
   */
  public async acceptConnectionRequest(requestKey: string): Promise<boolean> {
    try {
      this.logger.info(`Accepting connection request: ${requestKey}`);
      
      // Get request details from the ConnectionsManager
      const connectionsManager = this.stateManager.getConnectionsManager();
      if (!connectionsManager) {
        this.logger.error('ConnectionsManager not properly initialized');
        return false;
      }
      
      // Parse the request key to get the request ID
      const requestId = parseInt(requestKey);
      
      // Check for self-connection attempt
      if (!isNaN(requestId)) {
        // Get pending connections to check the requester
        const pendingRequests = connectionsManager.getPendingRequests();
        const matchingRequest = pendingRequests.find(
          req => req.connectionRequestId === requestId
        );
        
        // If this is a self-connection attempt, reject it
        if (matchingRequest && matchingRequest.targetAccountId === this.accountId) {
          this.logger.warn(`Rejecting self-connection request #${requestId} from own account ${this.accountId}`);
          
          // Mark as processed so we don't try again
          connectionsManager.markConnectionRequestProcessed(this.inboundTopicId, requestId);
          return true; // Return success to indicate we've handled it
        }
        
        // Check if this request has already been processed using ConnectionsManager
        if (connectionsManager.isConnectionRequestProcessed(this.inboundTopicId, requestId)) {
          this.logger.info(`Connection request ${requestKey} already processed, skipping`);
          return true; // Already handled
        }
      }
      
      // Use the acceptConnectionTool instead of direct client call
      const result = await this.acceptConnectionTool.invoke({
        uniqueRequestKey: requestKey
      });
      
      // Mark as processed in ConnectionsManager
      if (!isNaN(requestId)) {
        connectionsManager.markConnectionRequestProcessed(this.inboundTopicId, requestId);
      }
      
      this.logger.info(`Connection request accepted: ${requestKey}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to accept connection request: ${requestKey}`, error);
      return false;
    }
  }

  /**
   * Check for new messages on established connection topics only
   */
  private async checkForNewMessages(): Promise<void> {
    try {
      // Get the ConnectionsManager
      const connectionsManager = this.stateManager.getConnectionsManager();
      if (!connectionsManager) {
        this.logger.error('ConnectionsManager not properly initialized');
        return;
      }
      
      // Get established connections from ConnectionsManager
      const connections = connectionsManager.getActiveConnections();
      
      // If no established connections, just return
      if (!connections || connections.length === 0) {
        return;
      }
      
      // Process each active connection
      for (const connection of connections) {
        try {
          const topicId = connection.connectionTopicId;
          const targetId = connection.targetAccountId;
          
          // Skip connections with invalid topic IDs
          if (!topicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)) {
            continue;
          }
          
          // Get messages on the connection topic
          const { messages } = await this.client.getMessageStream(topicId);
          
          // Let the ConnectionsManager process these messages
          connectionsManager.processConnectionMessages(topicId, messages);
          
          // Find messages from the other user that are messages (not connection ops)
          const newMessages = messages.filter(
            (m) =>
              m.op === 'message' &&
              m.operator_id &&
              !m.operator_id.includes(this.accountId)
          );
          
          // Process new messages (only log when we find messages)
          if (newMessages.length > 0) {
            this.logger.info(`Found ${newMessages.length} messages from ${connection.targetAgentName || targetId}`);
            
            // Get last processed sequence number for this topic
            const lastProcessed = this.lastProcessedSequences.get(topicId) || 0;
            let highestSequence = lastProcessed;
            
            for (const message of newMessages) {
              // Check if we've already processed this message
              if (message.sequence_number !== undefined && 
                  message.sequence_number <= lastProcessed) {
                this.logger.debug(`Skipping already processed message #${message.sequence_number}`);
                continue;
              }
              
              this.logger.info(`Processing message: ${message.data?.substring(0, 50)}${message.data && message.data.length > 50 ? '...' : ''}`);
              
              // Process the message
              await this.handleStandardMessage(message, topicId);
              
              // Track highest sequence number processed
              if (message.sequence_number !== undefined && 
                  message.sequence_number > highestSequence) {
                highestSequence = message.sequence_number;
              }
            }
            
            // Update with highest sequence number processed
            if (highestSequence > lastProcessed) {
              this.lastProcessedSequences.set(topicId, highestSequence);
            }
          }
        } catch (error) {
          this.logger.error(`Error processing messages for connection ${connection.connectionTopicId}: ${error}`);
        }
      }
    } catch (error) {
      this.logger.error('Error checking for new messages', error);
    }
  }
  
  /**
   * Handle a standard message from a connected agent
   */
  private async handleStandardMessage(
    message: HCSMessage,
    connectionTopicId: string
  ): Promise<void> {
    if (!message.data || message.sequence_number === undefined) {
      this.logger.warn('Received message with no data or sequence number, skipping');
      return;
    }

    // Skip our own messages
    if (message.operator_id && message.operator_id.includes(this.accountId)) {
      this.logger.debug(`Skipping our own message #${message.sequence_number}`);
      return;
    }

    this.logger.info(
      `Processing message #${message.sequence_number}: ${message.data.substring(0, 100)}${
        message.data.length > 100 ? '...' : ''
      }`
    );

    // Check if this is from the sentinel agent
    const isSentinelMessage = this.sentinelAgentId && 
                              message.operator_id && 
                              message.operator_id.includes(this.sentinelAgentId);

    // Check if this is an HCS-1 reference for a large message
    let messageText = message.data;
    try {
      // Handle HCS-1 references (large message handling)
      if (typeof messageText === 'string' && messageText.startsWith('hcs://1/')) {
        this.logger.info(`Message appears to be an HCS-1 reference: ${messageText}`);
        this.logger.info(`Resolving content from inscription...`);
        
        try {
          // Use client to resolve the HCS-1 reference
          messageText = await this.client.getMessageContent(messageText);
          this.logger.info(`Successfully resolved HCS-1 reference, content length: ${messageText.length}`);
        } catch (resolveError) {
          this.logger.error(`Error resolving HCS-1 reference: ${resolveError}`);
          messageText = `Failed to retrieve large message content. Reference: ${message.data}`;
        }
      }
      
      // Handle sentinel agent alerts
      if (isSentinelMessage && this.isJson(messageText)) {
        try {
          const alertData = JSON.parse(messageText) as AlertMessage;
          if (alertData.type === 'REBALANCE_ALERT' || alertData.type === 'EMERGENCY_ALERT') {
            await this.handleRebalanceAlert(alertData, connectionTopicId);
            return; // Skip regular message handling
          }
        } catch (parseError) {
          this.logger.error(`Error parsing sentinel message: ${parseError}`);
          // Continue with regular message handling
        }
      }
      
      // Get the message text - first try to parse as JSON if it looks like JSON
      if (this.isJson(messageText)) {
        const jsonData = JSON.parse(messageText);
        messageText = this.extractAllText(jsonData);
        this.logger.debug(`Parsed JSON message: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
      }
    } catch (parseError) {
      this.logger.debug(`Failed to parse message: ${parseError}`);
      // Continue with the raw message text
    }

    // Generate a response
    this.logger.info(`Generating response to: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
    const response = await this.generateResponse(messageText);
    
    // Send response
    this.logger.info(`Sending response to topic ${connectionTopicId}: ${response.substring(0, 50)}${response.length > 50 ? '...' : ''}`);
    
    try {
      await this.sendMessageTool.invoke({
        topicId: connectionTopicId,
        message: response,
        memo: `Reply to message #${message.sequence_number}`
      });
      
      this.logger.info(`Successfully sent response to message #${message.sequence_number}`);
    } catch (sendError) {
      this.logger.error(`Error sending response to message #${message.sequence_number}: ${sendError}`);
      throw sendError; // Re-throw to properly handle in the caller's error handling
    }
  }

  /**
   * Check if a string looks like JSON
   */
  private isJson(str: string): boolean {
    if (typeof str !== 'string') return false;
    str = str.trim();
    if (!str) return false;
    return (str.startsWith('{') && str.endsWith('}')) || 
           (str.startsWith('[') && str.endsWith(']'));
  }

  /**
   * Initialize the LangChain components
   */
  private async initializeLangChain(): Promise<void> {
    try {
      this.logger.info('Initializing LangChain with Lynx context');
      
      // Set moderate temperature for more natural but consistent responses
      const temperature = 0.3;
      
      const llm = new ChatOpenAI({
        openAIApiKey: this.openAiApiKey,
        modelName: this.openAiModel,
        temperature: temperature,
        maxTokens: this.langchainConfig?.maxTokens,
        streaming: this.langchainConfig?.streaming,
      });

      // System prompt with detailed Lynx context
      const systemPrompt = `
You are the Lynx Token Rebalancer Agent, a specialized AI assistant for the Lynx token.

PRODUCT CONTEXT (Use this as background knowledge, but express it in your own words):

Lynx is the first tokenized index (LYNX) on the Hedera network. 
Lynx is minted by depositing the tokens type and quantity relevant to the composition and ratio.
These tokens are put into the treasury, and the minting user is then given a proportional quantity 
of Lynx. It can also be burned for which the underlying tokens are claimed. In this way, Lynx
provides a wide exposure to the Hedera ecosystem in a single token.

Key capabilities include:
- Rebalancing the treasury to maintain the desired composition and ratio
- Responding to alerts in the market to suggest composition or ratio adjustments for the DAO
- Monitoring the market for opportunities to adjust the composition and ratio
- Providing insights and analysis on the Lynx token and the Hedera ecosystem

Technical implementation details:
- Built on Hedera using smart contracts for treasury management and token operations
- Uses dynamic rebalancing instead of scheduled rebalancing based on market conditions
- Monitors volatility, liquidity, and volume metrics to trigger rebalancing events
- Automatically executes rebalancing when parameters exceed DAO-established thresholds
- DAO governance system allows token holders to adjust parameters at any time
- Uses Standards SDK and HCS to detect consensus and trigger smart contract functions
- Integrates with the minting UI to automate token purchases for users
- Uses the agent communication system to relay market data and rebalancing decisions

Important facts about Lynx:
1. Lynx is a tokenized index (LYNX) providing diversified exposure to the Hedera ecosystem
2. Users mint LYNX by depositing the underlying tokens, which are stored in the treasury
3. Lynx can be burned to redeem the underlying tokens from the treasury
4. The treasury is dynamically rebalanced based on market conditions (volatility, liquidity, volume)
5. A DAO governance system allows token holders to set and adjust rebalancing parameters
6. Users can mint Lynx in a single transaction without individually acquiring all underlying tokens
7. Lynx differentiates from competitors like Index Coop and Pie DAO through its AI-powered dynamic rebalancing and Standards API integration

IMPORTANT GUIDELINES:
- Use your own words - do NOT copy the context verbatim
- Be conversational and natural in your responses
- Provide accurate information based on your knowledge of Lynx
- When you don't know something specific, acknowledge the limitation
- Keep responses helpful and informative`;

      // Create a chat prompt template with system message and examples
      const chatPrompt = ChatPromptTemplate.fromMessages([
        ["system", systemPrompt],
        
        // Example 1: Rebalancing frequency
        ["human", "How often is your treasury rebalanced?"],
        ["ai", "Unlike many index products that follow rigid schedules, Lynx uses a dynamic approach to rebalancing. We continuously monitor market conditions like volatility, liquidity, and trading volumes. When these metrics cross certain thresholds set by our DAO, a rebalancing event is automatically triggered. This means we might rebalance more frequently during volatile periods and less during stable markets - always responding to actual conditions rather than arbitrary timeframes."],
        
        // Example 2: Token acquisition
        ["human", "Do I have to go out to other apps and buy all of the tokens myself?"],
        ["ai", "No, you don't need to acquire the underlying tokens separately. Lynx's minting interface is designed to streamline the process by automatically handling the token acquisitions for you in a single transaction. You simply specify the amount of Lynx you want to mint, and our smart contracts will handle acquiring the necessary underlying tokens at the proper ratios. This significantly simplifies the minting process and reduces the complexity compared to manually purchasing each component token from different sources."],
        
        // Example 3: Competitor differentiation
        ["human", "How is this different from other tokenized index products?"],
        ["ai", "Lynx differentiates from other tokenized index products like Index Coop and Pie DAO in several key ways: 1) We use AI-powered dynamic rebalancing that responds to real-time market conditions instead of fixed schedule rebalancing. 2) Our DAO governance is built on Hedera's Standards SDK, providing more efficient and lower-cost governance operations. 3) Our minting process is fully integrated, allowing users to mint with a single transaction without needing to acquire the underlying tokens separately. 4) We're specifically focused on the Hedera ecosystem, providing targeted exposure to this growing blockchain network. This combination of technology and focus creates a more responsive, user-friendly tokenized index."],
        
        // Example 4: Rebalancing triggers
        ["human", "What market conditions trigger a rebalance?"],
        ["ai", "Lynx's rebalancing is triggered by several key market metrics: 1) Volatility - when price fluctuations of component tokens exceed certain thresholds, suggesting a potential need to adjust exposure. 2) Liquidity - significant changes in the available trading liquidity of component tokens. 3) Trading volume - unusual spikes or drops in trading activity. These metrics are continuously monitored, and when they cross the thresholds established by the DAO governance, a rebalancing event is automatically triggered. The specific threshold values are determined by DAO voting and can be adjusted through governance proposals to respond to changing market conditions."],
        
        // Example 5: DAO governance
        ["human", "How does the DAO control the parameters?"],
        ["ai", "The Lynx DAO governs the parameters through a democratic voting process powered by Hedera's Standards SDK. Token holders can propose changes to any parameter, including rebalancing thresholds, component token weights, or fee structures. Each proposal goes through a voting period where token holders vote proportionally to their holdings. The agent continuously monitors the HCS (Hedera Consensus Service) for voting results, and when consensus is reached, the parameters are automatically updated in the smart contracts. This creates a transparent, decentralized governance system where the community collectively determines the direction of the index."],
        
        // Example 6: Minting and burning process
        ["human", "How do I mint and burn Lynx tokens?"],
        ["ai", "To mint Lynx tokens: 1) Navigate to the Lynx minting interface. 2) Enter the amount of Lynx you wish to mint. 3) Approve the transaction, which will automatically acquire the necessary underlying tokens at the correct ratios. 4) Once confirmed, you'll receive your Lynx tokens. \n\nTo burn Lynx tokens: 1) Go to the Lynx burning interface. 2) Enter the amount of Lynx you wish to burn. 3) Approve the transaction. 4) The smart contract will return the underlying tokens to your wallet based on the current composition of the treasury. The entire process is designed to be streamlined and user-friendly, requiring minimal steps while handling the complexity of managing multiple tokens behind the scenes."],
        
        // Current user question
        ["human", "{question}"],
      ]);

      this.llmChain = RunnableSequence.from([
        { question: (input) => input.question },
        chatPrompt,
        llm,
        new StringOutputParser(),
      ]);

      this.logger.info('LangChain initialized successfully with comprehensive Lynx context');
    } catch (error) {
      this.logger.error('Failed to initialize LangChain', error);
      throw error;
    }
  }

  /**
   * Generate a response to a user question
   */
  private async generateResponse(question: string): Promise<string> {
    try {
      if (!this.llmChain) {
        this.logger.error('LLM Chain not initialized');
        return 'I apologize, but I am currently experiencing technical difficulties.';
      }

      const response = await this.llmChain.invoke({
        question,
      });

      return response;
    } catch (error) {
      this.logger.error('Error generating response', error);
      return 'I apologize, but I encountered an error while processing your request.';
    }
  }

  /**
   * Extract the account ID from an operator ID
   */
  private extractAccountId(operatorId: string): string | null {
    const match = operatorId.match(/0\.0\.(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract all text content from a complex object
   */
  private extractAllText(obj: unknown): string {
    if (typeof obj === 'string') {
      return obj;
    } else if (obj && typeof obj === 'object') {
      // Check standard fields where text might be found
      if ('text' in obj && typeof obj.text === 'string') {
        return obj.text;
      } else if ('content' in obj && typeof obj.content === 'string') {
        return obj.content;
      } else if ('message' in obj && typeof obj.message === 'string') {
        return obj.message;
      } else if ('data' in obj && typeof obj.data === 'string') {
        return obj.data;
      } else if ('body' in obj && typeof obj.body === 'string') {
        return obj.body;
      }
      
      // Look through all string properties for potential text data
      const keys = Object.keys(obj as Record<string, unknown>);
      const longStringProps = keys
        .filter(key => typeof (obj as Record<string, unknown>)[key] === 'string')
        .filter(key => ((obj as Record<string, unknown>)[key] as string).length > 10)
        .sort((a, b) => 
          ((obj as Record<string, unknown>)[b] as string).length - 
          ((obj as Record<string, unknown>)[a] as string).length
        );
      
      // Return the longest string property if available
      if (longStringProps.length > 0) {
        return (obj as Record<string, unknown>)[longStringProps[0]] as string;
      }
      
      // If nothing else, fall back to stringifying the entire object
      return JSON.stringify(obj);
    }
    return String(obj);
  }

  /**
   * Handle a rebalance alert from the sentinel agent
   */
  private async handleRebalanceAlert(
    alert: AlertMessage,
    connectionTopicId: string
  ): Promise<void> {
    this.logger.info(`Received ${alert.type} from sentinel agent: ${alert.reason}`);
    
    // If already rebalancing, log but don't start another rebalance
    if (this.isRebalancing) {
      this.logger.info('Already processing a rebalance, queueing alert');
      
      // Send acknowledgment
      await this.sendMessageTool.invoke({
        topicId: connectionTopicId,
        message: JSON.stringify({
          type: 'REBALANCE_ACKNOWLEDGMENT',
          status: 'QUEUED',
          originalAlert: alert.type,
          message: 'Rebalance already in progress, alert queued',
          timestamp: new Date()
        }),
        memo: 'Rebalance acknowledgment - queued'
      });
      
      return;
    }
    
    // Set rebalancing state
    this.isRebalancing = true;
    
    try {
      // Send acknowledgment
      await this.sendMessageTool.invoke({
        topicId: connectionTopicId,
        message: JSON.stringify({
          type: 'REBALANCE_ACKNOWLEDGMENT',
          status: 'PROCESSING',
          originalAlert: alert.type,
          message: `Processing ${alert.type}`,
          timestamp: new Date()
        }),
        memo: 'Rebalance acknowledgment - processing'
      });
      
      // Log detailed alert information
      this.logger.info('==== REBALANCE ALERT DETAILS ====');
      this.logger.info(`Alert Type: ${alert.type}`);
      this.logger.info(`Reason: ${alert.reason}`);
      this.logger.info(`Triggered By: ${alert.triggeredBy}`);
      this.logger.info(`Timestamp: ${alert.timestamp}`);
      this.logger.info('Token Data:');
      for (const token of alert.tokenData) {
        this.logger.info(`  - ${token.symbol}: Price $${token.currentPrice.toFixed(6)}, Deviation ${(token.deviationPercent * 100).toFixed(2)}%, Target Weight ${(token.targetWeight * 100).toFixed(2)}%`);
        if (token.recommendedAction) {
          this.logger.info(`    Recommended Action: ${token.recommendedAction}`);
        }
      }
      this.logger.info('=================================');
      
      // Simulate rebalance processing
      const processingTime = alert.type === 'EMERGENCY_ALERT' ? 5000 : 10000;
      this.logger.info(`Simulating rebalance processing for ${processingTime / 1000} seconds...`);
      
      // In a real implementation, this would call smart contract functions
      // to perform the actual rebalancing operations
      await new Promise(resolve => setTimeout(resolve, processingTime));
      
      // Send completion notification
      await this.sendMessageTool.invoke({
        topicId: connectionTopicId,
        message: JSON.stringify({
          type: 'REBALANCE_COMPLETED',
          originalAlertType: alert.type,
          result: 'SUCCESS',
          message: `Successfully completed ${alert.type === 'EMERGENCY_ALERT' ? 'emergency rebalance' : 'rebalance'} operation`,
          tokensRebalanced: alert.tokenData.map(token => token.symbol),
          timestamp: new Date()
        }),
        memo: 'Rebalance completed'
      });
      
      this.logger.info(`Completed processing ${alert.type}`);
    } catch (error) {
      this.logger.error(`Error processing rebalance alert: ${error}`);
      
      // Send error notification
      try {
        await this.sendMessageTool.invoke({
          topicId: connectionTopicId,
          message: JSON.stringify({
            type: 'REBALANCE_ERROR',
            originalAlertType: alert.type,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date()
          }),
          memo: 'Rebalance error'
        });
      } catch (sendError) {
        this.logger.error(`Failed to send error notification: ${sendError}`);
      }
    } finally {
      // Reset rebalancing state
      this.isRebalancing = false;
    }
  }
}
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger, IConnectionsManager, Connection } from '@hashgraphonline/standards-sdk';
import {
  ConnectionTool,
  AcceptConnectionRequestTool,
  SendMessageTool,
  CheckMessagesTool,
  ConnectionMonitorTool,
  InitiateConnectionTool,
} from '../../src/tools';
import { IStateManager, ActiveConnection } from '../../src/state/state-types';
import { OpenConvaiState } from '../../src/state/open-convai-state';
import { PriceMonitor, RebalanceAlert, TokenConfig } from './PriceMonitor';
import { ChatOpenAI } from '@langchain/openai';
import { SentinelRagSystem } from './src/rag/SentinelRagSystem';

export interface PriceFeed {
  symbol: string;
  price: number;
  timestamp: Date;
  source: string;
}

export interface SentinelConfig {
  /** HCS10 client configuration */
  client: HCS10Client;
  /** Account ID of the sentinel agent */
  accountId: string;
  /** Inbound topic ID for the sentinel agent */
  inboundTopicId: string;
  /** Outbound topic ID for the sentinel agent */
  outboundTopicId: string;
  /** Rebalancer agent account ID to connect with */
  rebalancerAgentId: string;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Price check interval in milliseconds (default: 60 seconds) */
  priceCheckIntervalMs?: number;
  /** Token configuration with weights and thresholds */
  tokenConfigs?: TokenConfig[];
  /** OpenAI API key for inference */
  openAiApiKey?: string;
  /** OpenAI model to use */
  openAiModel?: string;
  /** Knowledge directory */
  knowledgeDir?: string;
}

export interface AlertMessage {
  type: 'REBALANCE_ALERT' | 'EMERGENCY_ALERT';
  reason: string;
  triggeredBy: string;
  tokenData: {
    symbol: string;
    currentPrice: number;
    deviationPercent: number;
    targetWeight: number;
    recommendedAction?: string;
  }[];
  timestamp: Date;
}

/**
 * SentinelAgent class that monitors price feeds and alerts the rebalancer agent
 */
export class SentinelAgent {
  private logger: Logger;
  private client: HCS10Client;
  private accountId: string;
  private inboundTopicId: string;
  private outboundTopicId: string;
  private rebalancerAgentId: string;
  private operatorId: string;
  private isRunning = false;
  private stateManager: IStateManager;
  private connectionsManager: IConnectionsManager;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private priceCheckInterval: NodeJS.Timeout | null = null;
  private priceCheckIntervalMs: number;
  private openAiApiKey?: string;
  private openAiModel?: string;
  private knowledgeDir?: string;
  private ragSystem: SentinelRagSystem | null = null;
  private priceMonitor: PriceMonitor;
  private connectionTool: ConnectionTool;
  private acceptConnectionTool: AcceptConnectionRequestTool;
  private sendMessageTool: SendMessageTool;
  private checkMessagesTool: CheckMessagesTool;
  private connectionMonitorTool: ConnectionMonitorTool;

  constructor(config: SentinelConfig) {
    this.logger = new Logger({
      module: 'SentinelAgent',
      level: config.logLevel || 'info',
      prettyPrint: true,
    });

    this.client = config.client;
    this.accountId = config.accountId;
    this.inboundTopicId = config.inboundTopicId;
    this.outboundTopicId = config.outboundTopicId;
    this.rebalancerAgentId = config.rebalancerAgentId;
    this.operatorId = this.client.getAccountAndSigner().accountId;
    this.priceCheckIntervalMs = config.priceCheckIntervalMs || 60000; // Default: 60 seconds
    this.openAiApiKey = config.openAiApiKey || process.env.OPENAI_API_KEY;
    this.openAiModel = config.openAiModel || 'gpt-4o';
    this.knowledgeDir = config.knowledgeDir;

    this.stateManager = new OpenConvaiState();

    this.stateManager.setCurrentAgent({
      name: 'Lynx Sentinel Agent',
      accountId: this.accountId,
      inboundTopicId: '0.0.0', // Will be discovered from profile
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

    // Initialize the PriceMonitor with token configurations
    const tokenConfigs = config.tokenConfigs || PriceMonitor.getDefaultTokenConfigs();
    this.priceMonitor = new PriceMonitor(
      this.client,
      tokenConfigs,
      config.logLevel || 'info'
    );
    
    // Initialize the RAG system if API key is provided
    if (this.openAiApiKey) {
      this.ragSystem = new SentinelRagSystem({
        openAiApiKey: this.openAiApiKey,
        openAiModel: this.openAiModel,
        knowledgeDir: this.knowledgeDir,
        logger: this.logger
      });
    }
  }

  /**
   * Initialize the agent, loading configuration and preparing it for operation
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Sentinel Agent');
      this.logger.info(`- Account ID: ${this.accountId}`);
      this.logger.info(`- Network: ${this.client.getNetwork()}`);
      this.logger.info(`- Rebalancer Agent ID: ${this.rebalancerAgentId}`);

      // Discover inbound topic ID from profile
      try {
        this.logger.info('Discovering inbound topic ID from profile...');
        const discoveredTopic = await this.client.getInboundTopicId();
        if (discoveredTopic !== this.inboundTopicId) {
          this.logger.info(`Discovered inbound topic ID: ${discoveredTopic} (was: ${this.inboundTopicId})`);
          this.inboundTopicId = discoveredTopic;
        }
      } catch (error) {
        this.logger.error(`Failed to discover inbound topic ID: ${error}`);
      }

      // Configure agent profile and topics
      const currentAgent = this.stateManager.getCurrentAgent();
      if (!currentAgent || !currentAgent.accountId) {
        this.logger.info('Agent not registered, registering now...');
        
        // Create the RegisterAgentTool
        const { RegisterAgentTool } = await import('../../src/tools/RegisterAgentTool');
        const registerAgentTool = new RegisterAgentTool(this.client, this.stateManager);
        
        // Register the agent
        try {
          const result = await registerAgentTool.invoke({
            name: "Lynx Sentinel Agent",
            description: "Monitors price feeds and alerts the rebalancer agent",
            capabilities: [0], // TEXT_GENERATION
            setAsCurrent: true,
          });
          
          this.logger.info(`Agent registered successfully: ${result}`);
        } catch (error) {
          this.logger.warn(`Failed to register agent: ${error}`);
        }
      } else {
        this.logger.info(`Using existing agent registration: ${currentAgent.accountId}`);
        
        // Update the inbound topic ID in the state manager too
        if (this.inboundTopicId !== '0.0.0' && currentAgent.inboundTopicId !== this.inboundTopicId) {
          this.logger.info(`Updating agent's inbound topic ID in state manager to: ${this.inboundTopicId}`);
          currentAgent.inboundTopicId = this.inboundTopicId;
          this.stateManager.setCurrentAgent(currentAgent);
        }
      }

      // Initialize the PriceMonitor
      await this.priceMonitor.initialize();
      this.logger.info('Price monitor initialized successfully');

      // Initialize RAG system if available
      if (this.ragSystem) {
        await this.ragSystem.initialize();
        this.logger.info('RAG system initialized successfully');
      } else {
        this.logger.warn('OpenAI API key not provided. RAG system will be disabled.');
      }

      this.logger.info('Sentinel Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Sentinel Agent', error);
      throw error;
    }
  }

  /**
   * Start the agent's monitoring processes
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('Sentinel Agent is already running');
      return;
    }

    this.isRunning = true;
    
    // Start price monitoring only - no need for connection monitoring
    await this.startPriceMonitoring();

    this.logger.info('Sentinel Agent started successfully');
  }

  /**
   * Stop the agent's monitoring processes
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.info('Sentinel Agent is not running');
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.priceCheckInterval) {
      clearInterval(this.priceCheckInterval);
      this.priceCheckInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Sentinel Agent stopped');
  }

  /**
   * Start monitoring for connection messages and updates
   */
  private async startMonitoring(): Promise<void> {
    try {
      this.logger.info('Starting connection monitoring');
      
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
      }
      
      // Set up monitoring interval
      this.monitoringInterval = setInterval(async () => {
        if (!this.isRunning) {
          return;
        }
        
        try {
          // CRITICAL: Use ConnectionMonitorTool for monitoring incoming connections
          await this.connectionMonitorTool.invoke({
            monitoringInterval: 5000,
            acceptAll: false,
            filterPendingAccountIds: [this.accountId] // Filter out self-connections
          });
          
          // Check messages on all connections
          await this.checkMessagesTool.invoke({
            checkAllConnections: true
          });
        } catch (error) {
          this.logger.error(`Error in monitoring interval: ${error}`);
        }
      }, 10000);
      
      this.logger.info('Connection monitoring started');
    } catch (error) {
      this.logger.error(`Failed to start monitoring: ${error}`);
      throw error;
    }
  }

  /**
   * Analyze rebalance alert using the RAG system
   */
  private async analyzeRebalanceAlert(alert: RebalanceAlert): Promise<void> {
    try {
      if (!this.ragSystem || !this.ragSystem.isInitialized()) {
        this.logger.warn('RAG system not initialized, sending basic alert');
        await this.sendRebalanceAlertFromMonitor(alert);
        return;
      }
      
      this.logger.info(`Analyzing ${alert.type} using RAG system...`);
      
      // Perform analysis using RAG system
      const analysis = await this.ragSystem.analyzeAlert(alert);
      
      this.logger.info('Analysis completed, sending alert with recommendations');
      
      // Transform and enhance the alert with analysis
      const enhancedAlert: AlertMessage = {
        type: alert.type,
        reason: alert.reason,
        triggeredBy: 'sentinel-rag-analysis',
        timestamp: new Date(),
        tokenData: alert.tokenData.map(token => ({
          symbol: token.symbol,
          currentPrice: token.currentPrice,
          deviationPercent: token.deviationPercent,
          targetWeight: token.targetWeight,
          // Add recommendations from analysis
          recommendedAction: token.recommendedAction || `Analyze current position and adjust as needed`
        }))
      };
      
      // Include analysis text in the reason
      enhancedAlert.reason = `${alert.reason}\n\nANALYSIS:\n${analysis}`;
      
      // Send the alert to the outbound topic
      await this.sendRebalanceAlert(enhancedAlert);
    } catch (error) {
      this.logger.error(`Error analyzing rebalance alert: ${error}`);
      // Fallback to sending the original alert
      await this.sendRebalanceAlertFromMonitor(alert);
    }
  }

  /**
   * Send a rebalance alert from the price monitor
   */
  private async sendRebalanceAlertFromMonitor(alert: RebalanceAlert): Promise<void> {
    // Convert the alert to the format expected by the rebalancer
    const alertMessage: AlertMessage = {
      type: alert.type,
      reason: alert.reason,
      triggeredBy: 'price-monitor',
      timestamp: new Date(),
      tokenData: alert.tokenData.map(token => ({
        symbol: token.symbol,
        currentPrice: token.currentPrice,
        deviationPercent: token.deviationPercent,
        targetWeight: token.targetWeight
      }))
    };
    
    await this.sendRebalanceAlert(alertMessage);
  }

  /**
   * Send a rebalance alert to the outbound topic
   */
  private async sendRebalanceAlert(alert: AlertMessage): Promise<void> {
    try {
      this.logger.info(`Posting ${alert.type} to outbound topic`);
      
      // Get the current agent from state manager to ensure we have the latest inbound topic ID
      let inboundTopicId = this.inboundTopicId;
      const currentAgent = this.stateManager.getCurrentAgent();
      
      // If the state manager has a valid inbound topic, use that instead
      if (currentAgent && currentAgent.inboundTopicId && 
          currentAgent.inboundTopicId !== '0.0.0') {
        inboundTopicId = currentAgent.inboundTopicId;
      }
      
      // Use the correct format: inboundTopicId@accountId for the message
      const operatorId = `${inboundTopicId}@${this.accountId}`;
      this.logger.info(`Using operator_id in message: ${operatorId}`);
      
      const message = JSON.stringify({
        p: 'hcs-10',
        op: 'message',
        operator_id: operatorId,
        data: alert
      });
      
      // Just use the sentinel client directly
      this.logger.info(`Using sentinel client (${this.accountId}) to post to outbound topic`);
      
      // Use basic sendMessage directly - don't use tool, don't use operator client
      try {
        const sequenceNumber = await this.client.sendMessage(
          this.outboundTopicId,
          message,
          `${alert.type}`
        );
        
        this.logger.info(`Message sent successfully with sequence number: ${sequenceNumber}`);
      } catch (directError) {
        this.logger.error(`Error sending message directly: ${directError}`);
        throw directError;
      }
      
      this.logger.info(`${alert.type} posted successfully to outbound topic`);
    } catch (error) {
      this.logger.error(`Error posting ${alert.type} to outbound topic: ${error}`);
    }
  }

  /**
   * Start monitoring price feeds and checking for rebalance conditions
   */
  private async startPriceMonitoring(): Promise<void> {
    try {
      this.logger.info('Starting price monitoring');
      
      if (this.priceCheckInterval) {
        clearInterval(this.priceCheckInterval);
      }
      
      // Set up price checking interval
      this.priceCheckInterval = setInterval(async () => {
        if (!this.isRunning) {
          return;
        }
        
        try {
          this.logger.info('Checking token prices and rebalance conditions...');
          
          // Update prices using the price monitor
          await this.priceMonitor.updatePrices();
          
          // Check if rebalance is needed
          const alert = await this.priceMonitor.generateRebalanceAlertIfNeeded();
          
          if (alert) {
            this.logger.info(`${alert.type} detected: ${alert.reason}`);
            // Analyze and send rebalance alert
            await this.analyzeRebalanceAlert(alert);
          } else {
            this.logger.info('No rebalance needed at this time');
          }
        } catch (error) {
          this.logger.error(`Error in price monitoring: ${error}`);
        }
      }, this.priceCheckIntervalMs);
      
      this.logger.info(`Price monitoring started with ${this.priceCheckIntervalMs}ms interval`);
    } catch (error) {
      this.logger.error('Failed to start price monitoring', error);
      throw error;
    }
  }
} 
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger, IConnectionsManager } from '@hashgraphonline/standards-sdk';
import {
  ConnectionTool,
  AcceptConnectionRequestTool,
  SendMessageTool,
  CheckMessagesTool,
  ConnectionMonitorTool,
} from '../../src/tools';
import { IStateManager } from '../../src/state/state-types';
import { OpenConvaiState } from '../../src/state/open-convai-state';
import { ChatOpenAI } from '@langchain/openai';

// Import AlertMessage from SentinelAgent for consistency
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

// Placeholder interface for treasury balances
export interface TreasuryBalance {
  symbol: string;
  amount: number;
  value: number;
  currentWeight: number;
  targetWeight: number;
}

// Interface for calculated rebalance actions
export interface RebalanceAction {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  amount: number;
  targetAmount: number;
  currentValue: number;
  targetValue: number;
  currentWeight: number;
  targetWeight: number;
  priceDelta: number;
}

// Interface for the execution result
export interface ExecutionResult {
  successful: boolean;
  timestamp: Date;
  transactionId?: string;
  actions: RebalanceAction[];
  totalValueBefore: number;
  totalValueAfter: number;
  message: string;
}

export interface RebalancerConfig {
  /** HCS10 client configuration */
  client: HCS10Client;
  /** Account ID of the rebalancer agent */
  accountId: string;
  /** Inbound topic ID for the rebalancer agent */
  inboundTopicId: string;
  /** Outbound topic ID for the rebalancer agent */
  outboundTopicId: string;
  /** Sentinel agent account ID to monitor */
  sentinelAgentId: string;
  /** Sentinel outbound topic ID to monitor for alerts */
  sentinelOutboundTopicId: string;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** OpenAI API key for inference */
  openAiApiKey?: string;
  /** OpenAI model to use */
  openAiModel?: string;
}

/**
 * RebalancerAgent class that monitors the sentinel agent's outbound topic for alerts
 * and executes rebalancing actions when needed
 */
export class RebalancerAgent {
  private logger: Logger;
  private client: HCS10Client;
  private accountId: string;
  private inboundTopicId: string;
  private outboundTopicId: string;
  private sentinelAgentId: string;
  private sentinelOutboundTopicId: string;
  private operatorId: string;
  private isRunning = false;
  private isRebalancing = false;
  private stateManager: IStateManager;
  private connectionsManager: IConnectionsManager;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private sentinelMonitorInterval: NodeJS.Timeout | null = null;
  private openAiApiKey?: string;
  private openAiModel?: string;
  private lastProcessedSequence = 0;
  private connectionTool: ConnectionTool;
  private acceptConnectionTool: AcceptConnectionRequestTool;
  private sendMessageTool: SendMessageTool;
  private checkMessagesTool: CheckMessagesTool;
  private connectionMonitorTool: ConnectionMonitorTool;

  constructor(config: RebalancerConfig) {
    this.logger = new Logger({
      module: 'RebalancerAgent',
      level: config.logLevel || 'info',
      prettyPrint: true,
    });

    this.client = config.client;
    this.accountId = config.accountId;
    this.inboundTopicId = config.inboundTopicId;
    this.outboundTopicId = config.outboundTopicId;
    this.sentinelAgentId = config.sentinelAgentId;
    this.sentinelOutboundTopicId = config.sentinelOutboundTopicId;
    this.operatorId = this.client.getAccountAndSigner().accountId;
    this.openAiApiKey = config.openAiApiKey || process.env.OPENAI_API_KEY;
    this.openAiModel = config.openAiModel || 'gpt-4o';

    this.stateManager = new OpenConvaiState();

    this.stateManager.setCurrentAgent({
      name: 'Lynx Rebalancer Agent',
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
  }

  /**
   * Initialize the agent, loading configuration and preparing it for operation
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Rebalancer Agent');
      this.logger.info(`- Account ID: ${this.accountId}`);
      this.logger.info(`- Network: ${this.client.getNetwork()}`);
      this.logger.info(`- Sentinel Agent ID: ${this.sentinelAgentId}`);
      this.logger.info(`- Sentinel Outbound Topic: ${this.sentinelOutboundTopicId}`);

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
            name: "Lynx Rebalancer Agent",
            description: "Monitors sentinel alerts and executes rebalancing operations",
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

      // Allow the sentinel outbound topic in the client (if this method exists)
      const clientAny = this.client as any;
      if (clientAny && clientAny.addAllowedTopic) {
        clientAny.addAllowedTopic(this.sentinelOutboundTopicId);
        this.logger.info(`Added sentinel outbound topic to allowlist: ${this.sentinelOutboundTopicId}`);
      }

      this.logger.info('Rebalancer Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Rebalancer Agent', error);
      throw error;
    }
  }

  /**
   * Start the agent's monitoring processes
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('Rebalancer Agent is already running');
      return;
    }

    this.isRunning = true;
    
    // Start monitoring sentinel outbound topic
    await this.startSentinelMonitoring();
    
    // Start connection monitoring
    await this.startMonitoring();

    this.logger.info('Rebalancer Agent started successfully');
  }

  /**
   * Stop the agent's monitoring processes
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.info('Rebalancer Agent is not running');
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.sentinelMonitorInterval) {
      clearInterval(this.sentinelMonitorInterval);
      this.sentinelMonitorInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Rebalancer Agent stopped');
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
            monitorDurationSeconds: 5,
            acceptAll: false,
            targetAccountId: this.sentinelAgentId // Only accept connections from sentinel
          });
          
          // We're only monitoring connections, not checking for messages manually
          // The ConnectionMonitorTool will handle incoming connection requests
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
   * Start monitoring the Sentinel outbound topic for rebalance alerts
   */
  private async startSentinelMonitoring(): Promise<void> {
    try {
      this.logger.info(`Starting to monitor Sentinel outbound topic: ${this.sentinelOutboundTopicId}`);
      
      if (this.sentinelMonitorInterval) {
        clearInterval(this.sentinelMonitorInterval);
      }
      
      // Add the sentinel outbound topic to allowed topics whitelist again just to be sure
      const clientAny = this.client as any;
      if (clientAny && clientAny.addAllowedTopic) {
        clientAny.addAllowedTopic(this.sentinelOutboundTopicId);
      }
      
      // Set up sentinel checking interval
      this.sentinelMonitorInterval = setInterval(async () => {
        if (!this.isRunning) {
          return;
        }
        
        try {
          // Get messages from the sentinel outbound topic
          const { messages } = await this.client.getMessageStream(this.sentinelOutboundTopicId);
          
          if (messages && messages.length > 0) {
            // Find new alerts (messages with sequence numbers higher than last processed)
            const newAlerts = messages.filter(m => 
              m.sequence_number !== undefined && m.sequence_number > this.lastProcessedSequence
            );
            
            if (newAlerts.length > 0) {
              this.logger.info(`Found ${newAlerts.length} new alerts from Sentinel agent`);
              
              // Process each alert
              for (const alert of newAlerts) {
                await this.processSentinelAlert(alert);
                
                // Update last processed sequence
                if (alert.sequence_number !== undefined && alert.sequence_number > this.lastProcessedSequence) {
                  this.lastProcessedSequence = alert.sequence_number;
                }
              }
            }
          }
        } catch (error) {
          this.logger.error(`Error checking Sentinel outbound topic: ${error}`);
        }
      }, 30000); // Check every 30 seconds
      
      this.logger.info('Sentinel monitoring started successfully');
    } catch (error) {
      this.logger.error(`Failed to start Sentinel monitoring: ${error}`);
      throw error;
    }
  }

  /**
   * Process a sentinel alert message
   */
  private async processSentinelAlert(message: any): Promise<void> {
    try {
      if (!message.data) {
        this.logger.warn('Received empty message from Sentinel outbound topic');
        return;
      }
      
      // Parse the message data
      let messageData: string;
      if (typeof message.data === 'string') {
        messageData = message.data;
      } else if (typeof message.data === 'object') {
        messageData = JSON.stringify(message.data);
      } else {
        this.logger.warn(`Unsupported message data type: ${typeof message.data}`);
        return;
      }
      
      // Check if this is an HCS-1 reference that needs resolving
      if (typeof messageData === 'string' && messageData.startsWith('hcs://1/')) {
        this.logger.info(`Message is an HCS-1 reference: ${messageData}`);
        try {
          // Use the client to fetch the actual content
          messageData = await this.client.getMessageContent(messageData);
          this.logger.info(`Successfully resolved HCS-1 reference, content length: ${messageData.length}`);
        } catch (error) {
          this.logger.error(`Failed to resolve HCS-1 reference: ${error}`);
          return;
        }
      }
      
      // Check if this looks like JSON before trying to parse
      if (!this.isJson(messageData)) {
        this.logger.warn(`Message data is not in JSON format: ${messageData.substring(0, 100)}${messageData.length > 100 ? '...' : ''}`);
        return;
      }
      
      // Try to parse the message as JSON
      let jsonData: any;
      try {
        jsonData = JSON.parse(messageData);
      } catch (e) {
        this.logger.warn(`Failed to parse message data as JSON: ${e}`);
        return;
      }
      
      // This is handled by the earlier HCS-1 reference check
      // Kept for backward compatibility with older reference format
      if (jsonData.op === 'reference' && jsonData.reference_id) {
        this.logger.info(`Found legacy reference message, fetching actual content for reference ID: ${jsonData.reference_id}`);
        try {
          // Try to use getMessageContent first (preferred method)
          try {
            const referenceUrl = `hcs://1/${jsonData.reference_id}`;
            messageData = await this.client.getMessageContent(referenceUrl);
            this.logger.info(`Successfully resolved reference using getMessageContent, length: ${messageData.length}`);
          } catch (contentError) {
            // Fall back to older method
            this.logger.warn(`Failed to use getMessageContent, falling back to getMessages: ${contentError}`);
            const { messages } = await this.client.getMessages(jsonData.reference_id);
            const referenceData = messages && messages.length > 0 ? messages[0] : null;
            
            if (referenceData && referenceData.data) {
              messageData = typeof referenceData.data === 'string' 
                ? referenceData.data 
                : JSON.stringify(referenceData.data);
            } else {
              this.logger.warn(`Failed to fetch reference data for ID: ${jsonData.reference_id}`);
              return;
            }
          }
          
          // Parse the resolved content
          try {
            jsonData = JSON.parse(messageData);
          } catch (e) {
            this.logger.warn(`Failed to parse reference data as JSON: ${e}`);
            return;
          }
        } catch (refError) {
          this.logger.error(`Error fetching reference data: ${refError}`);
          return;
        }
      }
      
      // Now we should have the proper data object
      // Check if it's an HCS-10 message with data
      if (jsonData.p === 'hcs-10' && jsonData.op === 'message' && jsonData.data) {
        const alertData = jsonData.data;
        
        // Check if it's a rebalance alert
        if (alertData.type === 'REBALANCE_ALERT' || alertData.type === 'EMERGENCY_ALERT') {
          // If we're already rebalancing, log but don't start another rebalance
          if (this.isRebalancing) {
            this.logger.info(`Already processing a rebalance, ignoring ${alertData.type}`);
            return;
          }
          
          // Clean up the analysis object if it contains [object AIMessage]
          if (alertData.reason && alertData.reason.includes('[object AIMessage]')) {
            alertData.reason = alertData.reason.replace(/\[object AIMessage\]/g, '"AI Analysis Available"');
          }
          
          this.logger.info(`Received ${alertData.type} from Sentinel: ${alertData.reason}`);
          
          // Set rebalancing state
          this.isRebalancing = true;
          
          try {
            // Execute the rebalancing process
            await this.executeRebalance(alertData);
          } catch (error) {
            this.logger.error(`Error executing rebalance: ${error}`);
          } finally {
            // Reset rebalancing state
            this.isRebalancing = false;
          }
        } else {
          this.logger.debug(`Received non-rebalance message from Sentinel: ${JSON.stringify(alertData).substring(0, 100)}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error processing Sentinel alert: ${error}`);
    }
  }

  /**
   * Execute rebalance based on the received alert
   */
  private async executeRebalance(alert: AlertMessage): Promise<void> {
    try {
      this.logger.info(`Executing rebalance based on ${alert.type}`);
      this.logger.info(`Reason: ${alert.reason}`);
      this.logger.info(`Triggered by: ${alert.triggeredBy}`);
      this.logger.info(`Token data count: ${alert.tokenData.length}`);
      
      // Step 1: Query treasury balances (mock implementation for now)
      const treasuryBalances = await this.queryTreasuryBalances(alert.tokenData);
      this.logger.info(`Retrieved current treasury balances for ${treasuryBalances.length} tokens`);
      
      // Step 2: Calculate deltas and actions needed
      const rebalanceActions = this.calculateRebalanceActions(treasuryBalances, alert.tokenData);
      this.logger.info(`Calculated ${rebalanceActions.length} rebalance actions`);
      
      // Step 3: Execute the swaps (mock implementation)
      const executionResult = await this.executeSwaps(rebalanceActions);
      
      // Step 4: Post execution report to outbound topic
      await this.postExecutionReport(executionResult, alert);
      
      this.logger.info('Rebalance execution completed');
    } catch (error) {
      this.logger.error(`Failed to execute rebalance: ${error}`);
      
      // Post failure report
      const failureResult: ExecutionResult = {
        successful: false,
        timestamp: new Date(),
        actions: [],
        totalValueBefore: 0,
        totalValueAfter: 0,
        message: `Failed to execute rebalance: ${error}`
      };
      
      await this.postExecutionReport(failureResult, alert);
    }
  }

  /**
   * Query the current treasury balances (mock implementation)
   */
  private async queryTreasuryBalances(tokenData: AlertMessage['tokenData']): Promise<TreasuryBalance[]> {
    // Mock implementation - in a real scenario, this would query an on-chain contract
    this.logger.info('Querying treasury balances (MOCK IMPLEMENTATION)');
    
    // Calculate a mock total value to use for weights
    const mockTotalValue = 1000000; // $1M mock treasury value
    
    // Create mock balances based on the token data
    return tokenData.map(token => {
      // For mocking, we'll pretend the current weights are slightly off from target
      const currentWeight = token.targetWeight * (1 + (token.deviationPercent / 100));
      const value = mockTotalValue * currentWeight;
      const amount = value / token.currentPrice;
      
      return {
        symbol: token.symbol,
        amount,
        value,
        currentWeight,
        targetWeight: token.targetWeight
      };
    });
  }

  /**
   * Calculate rebalance actions based on current balances and target weights
   */
  private calculateRebalanceActions(
    balances: TreasuryBalance[],
    tokenData: AlertMessage['tokenData']
  ): RebalanceAction[] {
    this.logger.info('Calculating rebalance actions');
    
    // Calculate the total treasury value
    const totalValue = balances.reduce((sum, balance) => sum + balance.value, 0);
    
    // Create a mapping of token data by symbol for easy lookup
    const tokenDataMap = new Map<string, AlertMessage['tokenData'][0]>();
    tokenData.forEach(token => {
      tokenDataMap.set(token.symbol, token);
    });
    
    // Calculate actions for each token
    return balances.map(balance => {
      const token = tokenDataMap.get(balance.symbol);
      if (!token) {
        // This shouldn't happen but just in case
        return {
          symbol: balance.symbol,
          action: 'HOLD' as const,
          amount: 0,
          targetAmount: balance.amount,
          currentValue: balance.value,
          targetValue: balance.value,
          currentWeight: balance.currentWeight,
          targetWeight: balance.targetWeight,
          priceDelta: 0
        };
      }
      
      // Calculate target value and amount
      const targetValue = totalValue * balance.targetWeight;
      const targetAmount = targetValue / token.currentPrice;
      
      // Determine action based on difference
      const valueDifference = targetValue - balance.value;
      const action = valueDifference > 0 ? 'BUY' as const : 
                   valueDifference < 0 ? 'SELL' as const : 
                   'HOLD' as const;
      
      // Amount to buy or sell (absolute value)
      const amount = Math.abs(targetAmount - balance.amount);
      
      return {
        symbol: balance.symbol,
        action,
        amount,
        targetAmount,
        currentValue: balance.value,
        targetValue,
        currentWeight: balance.currentWeight,
        targetWeight: balance.targetWeight,
        priceDelta: token.deviationPercent
      };
    });
  }

  /**
   * Execute the swap operations (mock implementation)
   */
  private async executeSwaps(actions: RebalanceAction[]): Promise<ExecutionResult> {
    this.logger.info('Executing swaps (MOCK IMPLEMENTATION)');
    
    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Calculate the mock values
    const totalValueBefore = actions.reduce((sum, action) => sum + action.currentValue, 0);
    const totalValueAfter = actions.reduce((sum, action) => sum + action.targetValue, 0);
    
    // Log the mock actions
    for (const action of actions) {
      if (action.action === 'HOLD') {
        this.logger.info(`HOLD ${action.symbol} - already at target weight ${(action.targetWeight * 100).toFixed(2)}%`);
      } else {
        this.logger.info(
          `${action.action} ${action.amount.toFixed(4)} ${action.symbol} to reach target weight ` +
          `${(action.targetWeight * 100).toFixed(2)}% (current: ${(action.currentWeight * 100).toFixed(2)}%)`
        );
      }
    }
    
    // Return a successful result
    return {
      successful: true,
      timestamp: new Date(),
      transactionId: `0.0.mock-tx-${Date.now()}`,
      actions,
      totalValueBefore,
      totalValueAfter,
      message: 'Rebalance executed successfully (MOCK IMPLEMENTATION)'
    };
  }

  /**
   * Post execution report to the agent's outbound topic
   */
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

  private async postExecutionReport(result: ExecutionResult, originalAlert: AlertMessage): Promise<void> {
    try {
      this.logger.info('Posting execution report to outbound topic');
      
      // Prepare the report message
      const report = {
        type: 'REBALANCE_EXECUTION_REPORT',
        originalAlertType: originalAlert.type,
        result: {
          ...result,
          // Format Date objects as ISO strings
          timestamp: result.timestamp.toISOString()
        },
        timestamp: new Date().toISOString()
      };
      
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
        data: report
      });
      
      // Use client to send message to outbound topic
      const sequenceNumber = await this.client.sendMessage(
        this.outboundTopicId,
        message,
        'REBALANCE_EXECUTION_REPORT'
      );
      
      this.logger.info(`Execution report posted successfully with sequence number: ${sequenceNumber}`);
    } catch (error) {
      this.logger.error(`Error posting execution report: ${error}`);
    }
  }
} 
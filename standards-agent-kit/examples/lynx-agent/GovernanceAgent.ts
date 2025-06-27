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
import { GovernanceMessageHandler } from './GovernanceMessageHandler';
import {
  type GovernanceParameters,
  type ParameterVote,
  type VoteResultMessage,
  type ParamOption,
  GovernanceParametersFullSchema,
} from './governance-schema';
import { 
  ContractExecuteTransaction, 
  ContractFunctionParameters,
  ContractId,
  AccountId,
  PrivateKey
} from '@hashgraph/sdk';

// Re-export types for backwards compatibility, but these are now defined in governance-schema.ts
export type { GovernanceParameters, ParameterVote, VoteResultMessage, ParamOption };

// Token metadata interface for test tokens
export interface TokenMetadata {
  symbol: string;
  name: string;
  tokenId: string;
  decimals: number;
  contractAddress?: string;
  isTestToken: boolean;
  description?: string;
}

// Legacy parameter option interface for backward compatibility
interface LegacyParamOption<T extends string | number | boolean> {
  value: T;
  options: T[];
  lastChanged: Date;
  minQuorum: number;
  description: string;
  constraints?: {
    min?: number;
    max?: number;
    pattern?: string;
    dependencies?: string[];
  };
}

// Governance parameters structure - now using schema types but keeping the simplified version for backwards compatibility
export interface LegacyGovernanceParameters {
  // Rebalancing parameters
  rebalancing: {
    frequencyHours: LegacyParamOption<number>;
    thresholds: {
      normal: LegacyParamOption<number>;
      emergency: LegacyParamOption<number>;
    };
    cooldownPeriods: {
      normal: LegacyParamOption<number>;
      emergency: LegacyParamOption<number>;
    };
  };
  
  // Treasury parameters
  treasury: {
    weights: Record<string, LegacyParamOption<number>>;
    maxSlippage: Record<string, LegacyParamOption<number>>;
    maxSwapSize: Record<string, LegacyParamOption<number>>;
  };
  
  // Fee parameters
  fees: {
    mintingFee: LegacyParamOption<number>;
    burningFee: LegacyParamOption<number>;
    operationalFee: LegacyParamOption<number>;
  };
  
  // Governance parameters
  governance: {
    quorumPercentage: LegacyParamOption<number>;
    votingPeriodHours: LegacyParamOption<number>;
    proposalThreshold: LegacyParamOption<number>;
  };
}

export interface GovernanceConfig {
  /** HCS10 client configuration */
  client: HCS10Client;
  /** Account ID of the governance agent */
  accountId: string;
  /** Inbound topic ID for the governance agent */
  inboundTopicId: string;
  /** Outbound topic ID for the governance agent */
  outboundTopicId: string;
  /** Rebalancer agent agent ID to connect with */
  rebalancerAgentId: string;
  /** Contract ID for the governance contract (e.g., "0.0.6216949") */
  governanceContractId?: string;
  /** Test token metadata for validation and display */
  testTokens?: TokenMetadata[];
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** OpenAI API key for inference */
  openAiApiKey?: string;
  /** OpenAI model to use */
  openAiModel?: string;
}

/**
 * GovernanceAgent class that observes governance votes, maintains parameter states,
 * and executes parameter changes when quorum is reached
 */
export class GovernanceAgent {
  private logger: Logger;
  private client: HCS10Client;
  private accountId: string;
  private inboundTopicId: string;
  private outboundTopicId: string;
  private rebalancerAgentId: string;
  private governanceContractId?: string;
  private operatorId: string;
  private isRunning = false;
  private stateManager: IStateManager;
  private connectionsManager: IConnectionsManager;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private governanceInterval: NodeJS.Timeout | null = null;
  private openAiApiKey?: string;
  private openAiModel?: string;
  private params: LegacyGovernanceParameters;
  private votes: Map<string, ParameterVote[]> = new Map();
  private votingPeriods: Map<string, Date> = new Map();
  private lastProcessedSequence = 0;
  private connectionTool: ConnectionTool;
  private acceptConnectionTool: AcceptConnectionRequestTool;
  private sendMessageTool: SendMessageTool;
  private checkMessagesTool: CheckMessagesTool;
  private connectionMonitorTool: ConnectionMonitorTool;
  private governanceMessageHandler: GovernanceMessageHandler;
  private hasPublishedInitialSnapshot = false;
  private lastSnapshotTimestamp: Date | null = null;
  private parameterChangeHistory: Array<{
    parameterPath: string;
    oldValue: any;
    newValue: any;
    timestamp: Date;
    txId?: string;
  }> = [];
  
  // Token metadata registry for test tokens
  private tokenRegistry: Map<string, TokenMetadata> = new Map();

  constructor(config: GovernanceConfig) {
    this.logger = new Logger({
      module: 'GovernanceAgent',
      level: config.logLevel || 'info',
      prettyPrint: true,
    });

    this.client = config.client;
    this.accountId = config.accountId;
    this.inboundTopicId = config.inboundTopicId;
    this.outboundTopicId = config.outboundTopicId;
    this.rebalancerAgentId = config.rebalancerAgentId;
    this.governanceContractId = config.governanceContractId;
    this.operatorId = this.client.getAccountAndSigner().accountId;
    this.openAiApiKey = config.openAiApiKey || process.env.OPENAI_API_KEY;
    this.openAiModel = config.openAiModel || 'gpt-4o';

    this.stateManager = new OpenConvaiState();

    this.stateManager.setCurrentAgent({
      name: 'Lynx Governance Agent',
      accountId: this.accountId,
      inboundTopicId: '0.0.0', // Will be discovered from profile
      outboundTopicId: this.outboundTopicId,
      profileTopicId: '',
      privateKey: (
        this.client.getAccountAndSigner().signer || ''
      ).toString(),
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

    // Initialize the governance message handler
    this.governanceMessageHandler = new GovernanceMessageHandler({
      client: this.client,
      accountId: this.accountId,
      inboundTopicId: this.inboundTopicId,
      outboundTopicId: this.outboundTopicId,
      logLevel: config.logLevel || 'info',
      stateValidation: true,
    });

    // Initialize with default parameters
    this.params = this.getDefaultParameters();
    
    // Initialize token registry with test token metadata
    this.initializeTokenRegistry();
    
    // Configure test tokens if provided
    if (config.testTokens && config.testTokens.length > 0) {
      this.configureTestTokens(config.testTokens);
    }
  }

  /**
   * Initialize the agent, loading configuration and preparing it for operation
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Governance Agent');
      this.logger.info(`- Account ID: ${this.accountId}`);
      this.logger.info(`- Network: ${this.client.getNetwork()}`);
      this.logger.info(`- Inbound Topic: ${this.inboundTopicId}`);
      this.logger.info(`- Outbound Topic: ${this.outboundTopicId}`);
      this.logger.info(`- Rebalancer Agent ID: ${this.rebalancerAgentId}`);
      
      if (this.governanceContractId) {
        this.logger.info(`- Governance Contract ID: ${this.governanceContractId}`);
      } else {
        this.logger.warn('No governance contract ID provided. Contract interactions will be disabled.');
      }

      // Contract integration is now handled through Hedera contract execution
      if (this.governanceContractId) {
        this.logger.info(`- Using Hedera contract execution for parameter updates`);
      } else {
        this.logger.warn('No governance contract ID provided. Contract interactions will be disabled.');
      }

      // Skip profile discovery - use explicit configuration
      this.logger.info('Using explicit topic configuration (skipping profile discovery)');

      // Set up minimal state manager configuration
      this.stateManager.setCurrentAgent({
        name: 'Lynx Governance Agent',
        accountId: this.accountId,
        inboundTopicId: this.inboundTopicId,
        outboundTopicId: this.outboundTopicId,
        profileTopicId: '',
        privateKey: (
          this.client.getAccountAndSigner().signer || ''
        ).toString(),
      });

      // Load current parameters
      await this.loadParameters();

      this.logger.info('Governance Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Governance Agent', error);
      throw error;
    }
  }

  /**
   * Start the agent's monitoring processes
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('Governance Agent is already running');
      return;
    }

    this.isRunning = true;
    
    // Start governance parameter monitoring
    await this.startGovernanceMonitoring();
    
    // Start connection monitoring
    await this.startConnectionMonitoring();

    // Check if we need to publish initial snapshot
    await this.checkAndPublishInitialSnapshot();

    this.logger.info('Governance Agent started successfully');
  }

  /**
   * Stop the agent's monitoring processes
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.info('Governance Agent is not running');
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.governanceInterval) {
      clearInterval(this.governanceInterval);
      this.governanceInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Governance Agent stopped');
  }

  /**
   * Initialize default governance parameters
   */
  private getDefaultParameters(): LegacyGovernanceParameters {
    const createOption = <T extends string | number | boolean>(value: T, options: T[], description: string, minQuorum = 15): LegacyParamOption<T> => ({
      value,
      options,
      lastChanged: new Date(),
      minQuorum,
      description
    });

    return {
      rebalancing: {
        frequencyHours: createOption(
          12, 
          [4, 6, 12, 24, 48], 
          "How often to check token prices (hours)"
        ),
        thresholds: {
          normal: createOption(
            10, 
            [5, 7, 10, 15], 
            "Deviation percentage that triggers normal rebalance"
          ),
          emergency: createOption(
            15, 
            [10, 15, 20, 25], 
            "Deviation percentage that triggers emergency rebalance",
            25
          )
        },
        cooldownPeriods: {
          normal: createOption(
            168, 
            [24, 48, 72, 168], 
            "Hours to wait between normal rebalances"
          ),
          emergency: createOption(
            0, 
            [0, 6, 12, 24], 
            "Hours to wait between emergency rebalances",
            20
          )
        }
      },
      
      treasury: {
        weights: {
          HBAR: createOption(50, [30, 40, 50, 60], "HBAR ratio (per LYNX token)", 20),
          WBTC: createOption(4, [2, 4, 6, 8], "WBTC ratio (per LYNX token)", 20),
          SAUCE: createOption(30, [20, 30, 40, 50], "SAUCE ratio (per LYNX token)", 15),
          USDC: createOption(30, [20, 30, 40, 50], "USDC ratio (per LYNX token)", 15),
          JAM: createOption(30, [20, 30, 40, 50], "JAM ratio (per LYNX token)", 15),
          HEADSTART: createOption(20, [10, 20, 30, 40], "HEADSTART ratio (per LYNX token)", 15)
        },
        maxSlippage: {
          HBAR: createOption(1.0, [0.1, 0.5, 1.0, 2.0], "HBAR max slippage percentage", 15),
          WBTC: createOption(1.5, [0.5, 1.0, 1.5, 2.0], "WBTC max slippage percentage", 15),
          SAUCE: createOption(2.0, [1.0, 2.0, 3.0, 5.0], "SAUCE max slippage percentage", 15),
          USDC: createOption(0.5, [0.1, 0.5, 1.0, 2.0], "USDC max slippage percentage", 15),
          JAM: createOption(3.0, [1.0, 2.0, 3.0, 5.0], "JAM max slippage percentage", 15),
          HEADSTART: createOption(3.0, [1.0, 2.0, 3.0, 5.0], "HEADSTART max slippage percentage", 15)
        },
        maxSwapSize: {
          HBAR: createOption(1000000, [100000, 500000, 1000000, 2000000], "HBAR max swap size (in USD)", 20),
          WBTC: createOption(50000, [10000, 25000, 50000, 100000], "WBTC max swap size (in USD)", 20),
          SAUCE: createOption(250000, [50000, 100000, 250000, 500000], "SAUCE max swap size (in USD)", 20),
          USDC: createOption(500000, [100000, 250000, 500000, 1000000], "USDC max swap size (in USD)", 20),
          JAM: createOption(100000, [25000, 50000, 100000, 250000], "JAM max swap size (in USD)", 20),
          HEADSTART: createOption(100000, [25000, 50000, 100000, 250000], "HEADSTART max swap size (in USD)", 20)
        }
      },
      
      fees: {
        mintingFee: createOption(
          0.2, 
          [0.1, 0.2, 0.3, 0.5], 
          "Fee charged when minting Lynx tokens (percentage)",
          25
        ),
        burningFee: createOption(
          0.2, 
          [0.1, 0.2, 0.3, 0.5], 
          "Fee charged when burning Lynx tokens (percentage)",
          25
        ),
        operationalFee: createOption(
          0.1, 
          [0.05, 0.1, 0.2, 0.3], 
          "Annual operational fee (percentage)",
          25
        )
      },
      
      governance: {
        quorumPercentage: createOption(
          15, 
          [10, 15, 20, 25, 30], 
          "Default percentage of total supply needed for valid vote",
          30
        ),
        votingPeriodHours: createOption(
          72, 
          [48, 72, 96, 168], 
          "Hours that a parameter vote remains open",
          20
        ),
        proposalThreshold: createOption(
          1000, 
          [500, 1000, 2500, 5000], 
          "Minimum LYNX tokens needed to propose a parameter change",
          20
        )
      }
    };
  }

  /**
   * Load parameters from storage or contract
   */
  private async loadParameters(): Promise<void> {
    // This would be implemented to load from database or contract
    // For now, we're just using the default parameters
    this.logger.info('Loading governance parameters (using defaults for now)');
  }

  /**
   * Save parameters to storage and/or contract
   */
  private async saveParameters(): Promise<void> {
    // This would be implemented to save to database and/or contract
    this.logger.info('Saving governance parameters');
    
    // In a real implementation, this would persist to storage
    // and potentially update the contract
  }

  /**
   * Check if a parameter path refers to token composition/weights
   */
  private isTokenCompositionParameter(parameterPath: string): boolean {
    return parameterPath.startsWith('treasury.weights');
  }

  /**
   * Execute Hedera contract update for token ratio changes using the updateRatios function
   */
  private async executeVaultContractUpdate(parameterPath: string, newValue: any): Promise<string | undefined> {
    try {
      this.logger.info(`🔥 STARTING CONTRACT EXECUTION for ${parameterPath} = ${newValue}`);
      
      if (!this.governanceContractId) {
        this.logger.warn('❌ No governance contract ID configured, skipping contract update');
        return undefined;
      }

      // For now, we only handle token weight changes
      if (!this.isTokenCompositionParameter(parameterPath)) {
        this.logger.info(`❌ Parameter ${parameterPath} is not a token composition parameter, skipping contract update`);
        return undefined;
      }

      this.logger.info(`✅ Contract ID configured: ${this.governanceContractId}`);
      this.logger.info(`✅ Parameter is token composition parameter: ${parameterPath}`);

      // Get current token weights and map them to contract parameters
      const currentWeights = this.getCurrentTokenWeights();
      this.logger.info(`📊 Current token weights:`, currentWeights);
      
      const ratioParams = this.mapTokenWeightsToContractRatios(currentWeights);
      this.logger.info(`📊 Mapped contract ratios:`, ratioParams);
      
      this.logger.info(`🚀 Executing Hedera contract updateRatios with contract ID: ${this.governanceContractId}`);
      
      // Create contract function parameters
      const functionParams = new ContractFunctionParameters()
        .addUint256(Math.floor(ratioParams.hbarRatio))
        .addUint256(Math.floor(ratioParams.wbtcRatio))
        .addUint256(Math.floor(ratioParams.sauceRatio))
        .addUint256(Math.floor(ratioParams.usdcRatio))
        .addUint256(Math.floor(ratioParams.jamRatio))
        .addUint256(Math.floor(ratioParams.headstartRatio));

      this.logger.info(`📋 Function parameters created with values: [${Math.floor(ratioParams.hbarRatio)}, ${Math.floor(ratioParams.wbtcRatio)}, ${Math.floor(ratioParams.sauceRatio)}, ${Math.floor(ratioParams.usdcRatio)}, ${Math.floor(ratioParams.jamRatio)}, ${Math.floor(ratioParams.headstartRatio)}]`);

      // Execute the contract transaction
      const contractExecuteTransaction = new ContractExecuteTransaction()
        .setContractId(ContractId.fromString(this.governanceContractId))
        .setFunction("updateRatios", functionParams)
        .setGas(300000); // Set appropriate gas limit

      this.logger.info(`📝 Contract transaction created with function: updateRatios, gas: 300000`);

      // Get the Hedera client from HCS10Client
      this.logger.info(`🔗 Getting Hedera client from HCS10Client...`);
      const hederaClient = this.client.standardClient.getClient();
      if (!hederaClient) {
        throw new Error('❌ Unable to access Hedera client from HCS10Client');
      }
      this.logger.info(`✅ Hedera client obtained successfully`);

      // Execute the transaction
      this.logger.info(`🎯 Executing contract transaction...`);
      const txResponse = await contractExecuteTransaction.execute(hederaClient);
      this.logger.info(`✅ Contract transaction executed, getting receipt...`);
      
      const receipt = await txResponse.getReceipt(hederaClient);
      this.logger.info(`✅ Receipt obtained, status: ${receipt.status}`);
      
      const txId = txResponse.transactionId?.toString();
      this.logger.info(`🎉 Contract updateRatios executed successfully. Transaction ID: ${txId}`);
      
      return txId;
    } catch (error) {
      this.logger.error(`💥 FAILED to execute Hedera contract update: ${error}`);
      this.logger.error(`💥 Error details:`, error);
      throw error;
    }
  }

  /**
   * Get current token weights from governance parameters
   */
  private getCurrentTokenWeights(): Record<string, number> {
    const weights: Record<string, number> = {};
    
    // Extract weights from treasury.weights parameters
    for (const [token, paramOption] of Object.entries(this.params.treasury.weights)) {
      weights[token] = paramOption.value;
    }
    
    return weights;
  }

  /**
   * Map current token weights to contract ratio parameters (1-100 range)
   * Update token mappings based on the new contract interface
   */
  private mapTokenWeightsToContractRatios(weights: Record<string, number>): {
    hbarRatio: number;
    wbtcRatio: number;
    sauceRatio: number;
    usdcRatio: number;
    jamRatio: number;
    headstartRatio: number;
  } {
    // Token mapping from governance parameters to contract ratios
    const tokenMapping: Record<string, keyof ReturnType<typeof this.mapTokenWeightsToContractRatios>> = {
      'HBAR': 'hbarRatio',
      'WBTC': 'wbtcRatio',
      'SAUCERSWAP': 'sauceRatio', // Map SAUCERSWAP to sauceRatio
      'SAUCE': 'sauceRatio',       // Also accept SAUCE directly (preferred)
      'USDC': 'usdcRatio',
      'JAM': 'jamRatio',
      'HEADSTART': 'headstartRatio',
    };

    // Initialize with current governance parameter values (not defaults)
    const ratios = {
      hbarRatio: weights['HBAR'] || this.params.treasury.weights.HBAR?.value || 50,
      wbtcRatio: weights['WBTC'] || this.params.treasury.weights.WBTC?.value || 4,
      sauceRatio: weights['SAUCE'] || weights['SAUCERSWAP'] || this.params.treasury.weights.SAUCE?.value || 30,
      usdcRatio: weights['USDC'] || this.params.treasury.weights.USDC?.value || 30,
      jamRatio: weights['JAM'] || this.params.treasury.weights.JAM?.value || 30,
      headstartRatio: weights['HEADSTART'] || this.params.treasury.weights.HEADSTART?.value || 20,
    };

    // Ensure all values are integers within contract limits (1-100)
    Object.keys(ratios).forEach(key => {
      const typedKey = key as keyof typeof ratios;
      ratios[typedKey] = Math.max(1, Math.min(100, Math.floor(ratios[typedKey])));
    });

    this.logger.info('Contract ratio mapping:', ratios);
    return ratios;
  }

  /**
   * Start monitoring for connection messages and updates
   */
  private async startConnectionMonitoring(): Promise<void> {
    try {
      this.logger.info('Starting connection monitoring');
      
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
      }
      
      // Set up monitoring interval - but make it more robust
      this.monitoringInterval = setInterval(async () => {
        if (!this.isRunning) {
          return;
        }
        
        try {
          // Skip connection monitoring for now - focus on governance functionality
          // This was causing profile lookup failures
          this.logger.debug('Connection monitoring tick (simplified)');
        } catch (error) {
          this.logger.error(`Error in monitoring interval: ${error}`);
        }
      }, 30000); // Check every 30 seconds, less frequent
      
      this.logger.info('Connection monitoring started (simplified mode)');
    } catch (error) {
      this.logger.error(`Failed to start monitoring: ${error}`);
      throw error;
    }
  }

  /**
   * Start monitoring the governance topic for parameter votes
   */
  private async startGovernanceMonitoring(): Promise<void> {
    try {
      this.logger.info(`Starting to monitor governance inbound topic: ${this.inboundTopicId}`);
      
      if (this.governanceInterval) {
        clearInterval(this.governanceInterval);
      }
      
      // Set up governance checking interval
      this.governanceInterval = setInterval(async () => {
        if (!this.isRunning) {
          return;
        }
        
        try {
          // Check for new parameter votes on inbound topic
          await this.checkParameterVotes();
          
          // Process any pending votes that may have reached quorum
          await this.processPendingVotes();
        } catch (error) {
          this.logger.error(`Error in governance monitoring: ${error}`);
        }
      }, 60000); // Check every minute
      
      this.logger.info('Governance monitoring started successfully');
    } catch (error) {
      this.logger.error(`Failed to start governance monitoring: ${error}`);
      throw error;
    }
  }

  /**
   * Check for new parameter votes on the inbound topic
   */
  private async checkParameterVotes(): Promise<void> {
    try {
      this.logger.info(`Checking for new parameter votes on topic ${this.inboundTopicId}`);
      
      // Use the working Mirror Node API approach (like our successful test script)
      const network = this.client.getNetwork();
      const mirrorUrl = network === 'mainnet' 
        ? 'https://mainnet-public.mirrornode.hedera.com'
        : 'https://testnet.mirrornode.hedera.com';
      
      const response = await fetch(`${mirrorUrl}/api/v1/topics/${this.inboundTopicId}/messages`);
      
      if (!response.ok) {
        throw new Error(`Mirror node request failed: ${response.status} ${response.statusText}`);
      }
      
      const mirrorData = await response.json();
      const rawMessages = mirrorData.messages || [];
      
      this.logger.info(`Retrieved ${rawMessages.length} total messages from mirror node`);
      
      if (rawMessages.length === 0) {
        this.logger.info('No messages found on topic');
        return;
      }
      
      // Process messages (decode base64 data like in our test script)
      const processedMessages = rawMessages.map((m: any) => {
        let data: string | undefined;
        if (m.message) {
          try {
            // Decode base64 message data
            data = Buffer.from(m.message, 'base64').toString('utf-8');
          } catch (e) {
            this.logger.warn(`Failed to decode message ${m.sequence_number}: ${e}`);
            data = undefined;
          }
        }
        
        return {
          sequence_number: m.sequence_number,
          data: data,
          created: m.consensus_timestamp,
          timestamp: new Date(m.consensus_timestamp).getTime(),
        };
      });
      
      // Sort by sequence number for consistent processing
      const sortedMessages = processedMessages
        .filter((m: any) => m.sequence_number !== undefined)
        .sort((a: any, b: any) => (a.sequence_number || 0) - (b.sequence_number || 0));
      
      // Log all message sequence numbers for debugging
      const allSequences = sortedMessages.map((m: any) => m.sequence_number).filter((s: any) => s !== undefined);
      this.logger.info(`All message sequences: [${allSequences.join(', ')}], lastProcessed: ${this.lastProcessedSequence}`);
      
      // Find new votes (messages with sequence numbers higher than last processed)
      const newMessages = sortedMessages.filter((m: any) => 
        m.sequence_number !== undefined && 
        m.sequence_number > this.lastProcessedSequence
      );
      
      if (newMessages.length === 0) {
        this.logger.info(`No new messages (all ${rawMessages.length} messages have sequence <= ${this.lastProcessedSequence})`);
        return;
      }
      
      this.logger.info(`Found ${newMessages.length} new messages on governance topic`);
      
      // Process each message that might contain votes
      for (const message of newMessages) {
        this.logger.info(`Processing message with sequence ${message.sequence_number}, data: ${message.data ? String(message.data).substring(0, 100) : 'undefined'}...`);
        await this.processGovernanceMessage(message);
        
        // Update last processed sequence
        if (message.sequence_number !== undefined && 
            message.sequence_number > this.lastProcessedSequence) {
          this.lastProcessedSequence = message.sequence_number;
          this.logger.info(`Updated lastProcessedSequence to ${this.lastProcessedSequence}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error checking parameter votes: ${error}`);
    }
  }

  /**
   * Process a message that might contain parameter votes
   */
  private async processGovernanceMessage(message: any): Promise<void> {
    try {
      if (!message.data) {
        this.logger.info('Message has no data, skipping');
        return;
      }
      
      // Parse the message data
      let messageData: string;
      if (typeof message.data === 'string') {
        messageData = message.data;
        this.logger.info(`Message data is string, length: ${messageData.length}`);
      } else if (typeof message.data === 'object') {
        messageData = JSON.stringify(message.data);
        this.logger.info(`Message data is object, converted to JSON string, length: ${messageData.length}`);
      } else {
        this.logger.info(`Message data type ${typeof message.data} not supported, skipping`);
        return;
      }
      
      // Check if this is an HCS-1 reference that needs resolving
      if (typeof messageData === 'string' && messageData.startsWith('hcs://1/')) {
        this.logger.info(`Message contains HCS-1 reference: ${messageData}, resolving...`);
        try {
          // Use the client to fetch the actual content
          messageData = await this.client.getMessageContent(messageData);
          this.logger.info(`HCS-1 reference resolved, content length: ${messageData.length}`);
        } catch (error) {
          this.logger.error(`Failed to resolve HCS-1 reference: ${error}`);
          return;
        }
      }
      
      // Check if this looks like JSON before trying to parse
      if (!this.isJson(messageData)) {
        this.logger.info(`Message data does not look like JSON: ${messageData.substring(0, 100)}...`);
        return;
      }
      
      this.logger.info(`Message data looks like JSON, attempting to parse...`);
      
      // Parse the JSON message
      try {
        const jsonData = JSON.parse(messageData);
        this.logger.info(`Successfully parsed JSON, checking for HCS-10 wrapper...`);
        
        // Check if this is an HCS-10 wrapped message
        let actualVoteData = jsonData;
        if (jsonData.p === 'hcs-10' && jsonData.op === 'message' && jsonData.data) {
          this.logger.info(`Found HCS-10 wrapper, extracting data field...`);
          try {
            // The data field contains the actual vote as a JSON string
            actualVoteData = JSON.parse(jsonData.data);
            this.logger.info(`Successfully extracted vote data from HCS-10 wrapper`);
          } catch (e) {
            this.logger.warn(`Failed to parse HCS-10 data field: ${e}`);
            return;
          }
        }
        
        this.logger.info(`Processing vote data, type: ${actualVoteData.type || 'undefined'}`);
        
        // Handle different message types
        if (actualVoteData.type === 'PARAMETER_VOTE') {
          this.logger.info(`Found PARAMETER_VOTE message for parameter: ${actualVoteData.parameterPath}`);
          await this.recordVote(actualVoteData);
        } else if (actualVoteData.type === 'MULTI_RATIO_VOTE') {
          this.logger.info(`Found MULTI_RATIO_VOTE message with ${actualVoteData.ratioChanges?.length || 0} ratio changes`);
          await this.recordMultiRatioVote(actualVoteData);
        } else {
          this.logger.info(`Message type '${actualVoteData.type}' is not PARAMETER_VOTE or MULTI_RATIO_VOTE, skipping`);
        }
      } catch (e) {
        this.logger.warn(`Failed to parse message data as JSON: ${e}`);
      }
    } catch (error) {
      this.logger.error(`Error processing governance message: ${error}`);
    }
  }

  /**
   * Record a vote for a parameter change
   */
  private async recordVote(voteData: any): Promise<void> {
    try {
      // Validate the vote data
      if (!voteData.parameterPath || 
          voteData.newValue === undefined ||
          !voteData.voterAccountId ||
          !voteData.votingPower) {
        this.logger.warn('Invalid vote data received');
        return;
      }

      // Additional validation for token-related parameters
      if (voteData.parameterPath.startsWith('treasury.weights.')) {
        const tokenSymbol = voteData.parameterPath.split('.')[2];
        if (!this.validateTokenExists(tokenSymbol)) {
          this.logger.warn(`Vote rejected: Token ${tokenSymbol} not found in registry`);
          return;
        }
        
        const tokenMetadata = this.getTokenMetadata(tokenSymbol);
        this.logger.info(`Processing vote for ${tokenMetadata?.name || tokenSymbol} (${tokenMetadata?.tokenId || 'unknown'})`);
      }
      
      const vote: ParameterVote = {
        parameterPath: voteData.parameterPath,
        newValue: voteData.newValue,
        voterAccountId: voteData.voterAccountId,
        votingPower: voteData.votingPower,
        timestamp: voteData.timestamp ? new Date(voteData.timestamp) : new Date(),
        txId: voteData.txId,
        reason: voteData.reason
      };
      
      // Use shared logic for recording individual votes
      await this.recordIndividualVote(vote);
    } catch (error) {
      this.logger.error(`Error recording vote: ${error}`);
    }
  }

  /**
   * Record multiple ratio votes from a single MULTI_RATIO_VOTE message
   */
  private async recordMultiRatioVote(voteData: any): Promise<void> {
    try {
      // Validate the multi-ratio vote data
      if (!voteData.ratioChanges || 
          !Array.isArray(voteData.ratioChanges) ||
          !voteData.voterAccountId ||
          !voteData.votingPower) {
        this.logger.warn('Invalid multi-ratio vote data received');
        return;
      }

      this.logger.info(`Processing multi-ratio vote from ${voteData.voterAccountId} with ${voteData.ratioChanges.length} ratio changes`);

      // Process each ratio change as a separate parameter vote
      for (const ratioChange of voteData.ratioChanges) {
        if (!ratioChange.token || ratioChange.newRatio === undefined) {
          this.logger.warn(`Invalid ratio change in multi-vote: ${JSON.stringify(ratioChange)}`);
          continue;
        }

        // Validate token exists in registry
        if (!this.validateTokenExists(ratioChange.token)) {
          this.logger.warn(`Vote rejected: Token ${ratioChange.token} not found in registry`);
          continue;
        }

        // Convert to treasury.weights parameter path
        const parameterPath = `treasury.weights.${ratioChange.token.toUpperCase()}`;
        
        const tokenMetadata = this.getTokenMetadata(ratioChange.token);
        this.logger.info(`Processing ratio change for ${tokenMetadata?.name || ratioChange.token} (${tokenMetadata?.tokenId || 'unknown'}): ${ratioChange.newRatio}`);

        // Create individual parameter vote
        const individualVote: ParameterVote = {
          parameterPath,
          newValue: ratioChange.newRatio,
          voterAccountId: voteData.voterAccountId,
          votingPower: voteData.votingPower,
          timestamp: voteData.timestamp ? new Date(voteData.timestamp) : new Date(),
          txId: voteData.txId,
          reason: voteData.reason || `Multi-ratio vote: ${ratioChange.token} = ${ratioChange.newRatio}`
        };

        // Record this individual vote using the existing logic
        await this.recordIndividualVote(individualVote);
      }

      this.logger.info(`Completed processing multi-ratio vote with ${voteData.ratioChanges.length} ratio changes`);
    } catch (error) {
      this.logger.error(`Error recording multi-ratio vote: ${error}`);
    }
  }

  /**
   * Record an individual vote (shared logic between recordVote and recordMultiRatioVote)
   */
  private async recordIndividualVote(vote: ParameterVote): Promise<void> {
    try {
      this.logger.info(`📝 RECORDING INDIVIDUAL VOTE for ${vote.parameterPath}`);
      this.logger.info(`   Voter: ${vote.voterAccountId}`);
      this.logger.info(`   New Value: ${vote.newValue}`);
      this.logger.info(`   Voting Power: ${vote.votingPower}`);
      
      const isNewVotingSession = !this.votes.has(vote.parameterPath);
      
      // Record the vote
      if (isNewVotingSession) {
        this.votes.set(vote.parameterPath, []);
        
        // Set the voting period end time
        const votingPeriodHours = this.params.governance.votingPeriodHours.value;
        const endTime = new Date();
        endTime.setHours(endTime.getHours() + votingPeriodHours);
        this.votingPeriods.set(vote.parameterPath, endTime);
        
        this.logger.info(`🆕 Started new voting period for ${vote.parameterPath}, ending at ${endTime}`);
      } else {
        this.logger.info(`📊 Adding to existing voting session for ${vote.parameterPath}`);
      }
      
      // Get existing votes for this parameter
      const paramVotes = this.votes.get(vote.parameterPath)!;
      
      // Check if this voter has already voted on this parameter
      const existingVoteIndex = paramVotes.findIndex(v => v.voterAccountId === vote.voterAccountId);
      
      if (existingVoteIndex >= 0) {
        // Update existing vote
        paramVotes[existingVoteIndex] = vote;
        this.logger.info(`🔄 Updated vote from ${vote.voterAccountId} for ${vote.parameterPath}`);
      } else {
        // Add new vote
        paramVotes.push(vote);
        this.logger.info(`✅ Recorded new vote from ${vote.voterAccountId} for ${vote.parameterPath}`);
      }
      
      this.logger.info(`📊 Total votes for ${vote.parameterPath}: ${paramVotes.length}`);
      
      // Check if the vote has reached quorum immediately
      const quorumReached = await this.checkQuorum(vote.parameterPath);
      
      this.logger.info(`📋 Individual vote processing complete for ${vote.parameterPath}. Current votes: ${paramVotes.length}, Quorum reached: ${quorumReached}`);
    } catch (error) {
      this.logger.error(`💥 Error recording individual vote: ${error}`);
    }
  }

  /**
   * Check if a parameter vote has reached quorum
   */
  private async checkQuorum(parameterPath: string): Promise<boolean> {
    try {
      this.logger.info(`🗳️  CHECKING QUORUM for ${parameterPath}`);
      
      // Get the votes for this parameter
      const votes = this.votes.get(parameterPath);
      if (!votes || votes.length === 0) {
        this.logger.info(`❌ No votes found for ${parameterPath}`);
        return false;
      }
      
      this.logger.info(`📊 Found ${votes.length} votes for ${parameterPath}`);
      
      // Calculate total voting power
      const totalVotingPower = votes.reduce((sum, vote) => sum + vote.votingPower, 0);
      
      // Get the appropriate quorum threshold
      // This would typically be based on total supply of governance tokens
      // For demonstration, we'll use a fixed value of 100,000 LYNX tokens
      const totalSupply = 100000;
      
      // Determine required quorum percentage
      // In a real implementation, this would depend on the parameter path
      const quorumPercentage = this.getRequiredQuorumForParameter(parameterPath);
      
      // Calculate required voting power
      const requiredVotingPower = (totalSupply * quorumPercentage) / 100;
      
      this.logger.info(`📊 Vote tally for ${parameterPath}:`);
      this.logger.info(`   Total voting power: ${totalVotingPower}`);
      this.logger.info(`   Required voting power: ${requiredVotingPower}`);
      this.logger.info(`   Quorum percentage: ${quorumPercentage}%`);
      this.logger.info(`   Total supply: ${totalSupply}`);
      
      // Check if quorum reached
      const quorumReached = totalVotingPower >= requiredVotingPower;
      
      if (quorumReached) {
        this.logger.info(`🎉 QUORUM REACHED for ${parameterPath}: ${totalVotingPower} >= ${requiredVotingPower}`);
        this.logger.info(`🚀 Proceeding to finalize vote...`);
        await this.finalizeVote(parameterPath);
        return true;
      } else {
        this.logger.info(`⏳ Quorum not yet reached for ${parameterPath}: ${totalVotingPower} < ${requiredVotingPower}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`💥 Error checking quorum: ${error}`);
      return false;
    }
  }

  /**
   * Get the required quorum percentage for a specific parameter
   */
  private getRequiredQuorumForParameter(parameterPath: string): number {
    // Parse the parameter path to find the specific parameter
    const pathParts = parameterPath.split('.');
    
    let currentObj: any = this.params;
    for (let i = 0; i < pathParts.length; i++) {
      if (!currentObj[pathParts[i]]) {
        break;
      }
      currentObj = currentObj[pathParts[i]];
    }
    
    // If we found a parameter object with minQuorum, use it
    if (currentObj && typeof currentObj.minQuorum === 'number') {
      return currentObj.minQuorum;
    }
    
    // Otherwise, use the default quorum
    return this.params.governance.quorumPercentage.value;
  }

  /**
   * Finalize a vote and update the parameter if approved
   */
  private async finalizeVote(parameterPath: string): Promise<void> {
    try {
      // Get the votes for this parameter
      const votes = this.votes.get(parameterPath);
      if (!votes || votes.length === 0) {
        return;
      }
      
      // Calculate total voting power
      const totalVotingPower = votes.reduce((sum, vote) => sum + vote.votingPower, 0);
      
      // Get the new value (all votes should be for the same new value)
      const newValue = votes[0].newValue;
      
      // Get the current value
      const currentValue = this.getParameterValue(parameterPath);
      
      // Get required quorum
      const quorumPercentage = this.getRequiredQuorumForParameter(parameterPath);
      const totalSupply = 100000; // Mock total supply
      const requiredVotingPower = (totalSupply * quorumPercentage) / 100;
      
      // Check if quorum reached
      if (totalVotingPower >= requiredVotingPower) {
        // Execute vault contract call if this is a token composition change
        let txId: string | undefined;
        if (this.isTokenCompositionParameter(parameterPath)) {
          try {
            txId = await this.executeVaultContractUpdate(parameterPath, newValue);
            this.logger.info(`Vault contract updated successfully. Transaction ID: ${txId}`);
          } catch (error) {
            this.logger.error(`Failed to execute vault contract update: ${error}`);
            // Continue with governance update even if vault contract fails
          }
        }
        
        // Update the parameter
        this.updateParameter(parameterPath, newValue, txId);
        
        // Create result message
        const resultMessage: VoteResultMessage = {
          type: 'PARAMETER_UPDATE',
          parameterPath,
          oldValue: currentValue,
          newValue,
          votesInFavor: votes.length,
          totalVotingPower,
          quorumPercentage,
          quorumReached: true,
          effectiveTimestamp: new Date(),
          executionStatus: 'executed',
        };
        
        // Post to outbound topic
        await this.postVoteResult(resultMessage);
        
        // Notify relevant agents if necessary
        await this.notifyAgentsOfParameterChange(parameterPath, newValue);
        
        // IMPORTANT: Publish snapshot after successful parameter change
        await this.publishGovernanceSnapshot('PARAMETER_CHANGE', `Parameter ${parameterPath} updated to ${newValue}`);
        this.lastSnapshotTimestamp = new Date();
        
        this.logger.info(`Parameter ${parameterPath} updated to ${newValue} - snapshot published`);
      } else {
        // Create failed vote result message
        const resultMessage: VoteResultMessage = {
          type: 'VOTE_FAILED',
          parameterPath,
          oldValue: currentValue,
          votesInFavor: votes.length,
          totalVotingPower,
          quorumPercentage,
          quorumReached: false,
          effectiveTimestamp: new Date(),
          executionStatus: 'failed',
        };
        
        // Post failed result to outbound topic
        await this.postVoteResult(resultMessage);
        
        // ALSO publish snapshot after failed votes to show the voting period ended
        await this.publishGovernanceSnapshot('VOTE_CONCLUDED', `Vote for ${parameterPath} concluded without reaching quorum`);
        
        this.logger.info(`Vote for ${parameterPath} did not reach quorum: ${totalVotingPower} / ${requiredVotingPower} - snapshot published`);
      }
    } catch (error) {
      this.logger.error(`Error finalizing vote: ${error}`);
    }
  }

  /**
   * Get the current value of a parameter
   */
  private getParameterValue(parameterPath: string): any {
    const pathParts = parameterPath.split('.');
    
    let currentObj: any = this.params;
    for (let i = 0; i < pathParts.length; i++) {
      if (!currentObj[pathParts[i]]) {
        return undefined;
      }
      currentObj = currentObj[pathParts[i]];
    }
    
    // If the last item is a ParamOption, return its value
    if (currentObj && typeof currentObj.value !== 'undefined') {
      return currentObj.value;
    }
    
    return currentObj;
  }

  /**
   * Update a parameter with a new value and record the change
   */
  private updateParameter(parameterPath: string, newValue: any, txId?: string): void {
    const pathParts = parameterPath.split('.');
    
    let currentObj: any = this.params;
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (!currentObj[pathParts[i]]) {
        return;
      }
      currentObj = currentObj[pathParts[i]];
    }
    
    const lastKey = pathParts[pathParts.length - 1];
    
    // Get the old value before updating
    let oldValue: any;
    if (currentObj[lastKey] && typeof currentObj[lastKey].value !== 'undefined') {
      oldValue = currentObj[lastKey].value;
    } else {
      oldValue = currentObj[lastKey];
    }
    
    // If the object is a ParamOption, update its value
    if (currentObj[lastKey] && typeof currentObj[lastKey].value !== 'undefined') {
      currentObj[lastKey].value = newValue;
      currentObj[lastKey].lastChanged = new Date();
    } else {
      // Otherwise, set the property directly
      currentObj[lastKey] = newValue;
    }
    
    // Record the parameter change in history
    this.parameterChangeHistory.push({
      parameterPath,
      oldValue,
      newValue,
      timestamp: new Date(),
      txId,
    });
    
    // Keep only the last 50 changes to prevent memory bloat
    if (this.parameterChangeHistory.length > 50) {
      this.parameterChangeHistory = this.parameterChangeHistory.slice(-50);
    }
    
    // Save the updated parameters
    this.saveParameters();
  }

  /**
   * Post a vote result to the outbound topic
   */
  private async postVoteResult(result: VoteResultMessage): Promise<void> {
    try {
      this.logger.info('Posting vote result to outbound topic');
      
      // Create the result message directly
      const resultMessage = {
        p: 'hcs-10',
        op: 'vote_result',
        operator_id: `${this.inboundTopicId}@${this.accountId}`,
        data: result,
        m: `Vote result: ${result.parameterPath}`,
      };
      
      // Send directly to outbound topic
      const sequenceNumber = await this.client.sendMessage(
        this.outboundTopicId,
        JSON.stringify(resultMessage),
        `Vote result: ${result.parameterPath}`
      );
      
      this.logger.info(`Vote result posted successfully (sequence: ${sequenceNumber})`);
    } catch (error) {
      this.logger.error(`Error posting vote result: ${error}`);
      // Don't throw - result posting shouldn't break the agent
    }
  }

  /**
   * Publish the current parameter state as a snapshot to the outbound topic
   * @deprecated Use publishGovernanceSnapshot instead
   */
  public async publishCurrentStateSnapshot(): Promise<void> {
    await this.publishGovernanceSnapshot('MANUAL', 'Manual state snapshot request');
  }

  /**
   * Check if initial snapshot needs to be published and publish it
   */
  private async checkAndPublishInitialSnapshot(): Promise<void> {
    try {
      if (this.hasPublishedInitialSnapshot) {
        this.logger.info('Initial snapshot already published, skipping');
        return;
      }

      // Check if there's already a snapshot on the outbound topic
      const hasExistingSnapshot = await this.checkForExistingSnapshot();
      
      if (hasExistingSnapshot) {
        this.logger.info('Found existing snapshot on outbound topic, marking as published');
        this.hasPublishedInitialSnapshot = true;
        return;
      }

      // Publish initial snapshot with default values
      this.logger.info('Publishing initial governance state snapshot with default parameters');
      await this.publishGovernanceSnapshot('INITIAL_STATE', 'Initial governance parameters snapshot');
      
      this.hasPublishedInitialSnapshot = true;
      this.lastSnapshotTimestamp = new Date();
      
      this.logger.info('Initial governance snapshot published successfully');
    } catch (error) {
      this.logger.error(`Error checking/publishing initial snapshot: ${error}`);
    }
  }

  /**
   * Check if there's already a governance snapshot on the outbound topic
   */
  private async checkForExistingSnapshot(): Promise<boolean> {
    try {
      const { messages } = await this.client.getMessageStream(this.outboundTopicId);
      
      if (!messages || messages.length === 0) {
        return false;
      }

      // Look for any governance snapshot messages
      const hasSnapshot = messages.some(message => {
        try {
          if (!message.data) return false;
          
          let messageData = message.data;
          if (typeof messageData === 'object') {
            messageData = JSON.stringify(messageData);
          }
          
          const parsed = JSON.parse(messageData);
          return parsed.op === 'state_snapshot' && parsed.data?.parameters;
        } catch {
          return false;
        }
      });

      return hasSnapshot;
    } catch (error) {
      this.logger.error(`Error checking for existing snapshot: ${error}`);
      return false;
    }
  }

  /**
   * Publish governance snapshot - now only called after actual events
   */
  private async publishGovernanceSnapshot(eventType: string, memo?: string): Promise<void> {
    try {
      this.logger.info(`Publishing governance snapshot for event: ${eventType}`);
      
      // Convert our legacy parameters to the full governance schema format
      const fullParameters = this.convertToFullGovernanceParameters();
      
      // Get active votes
      const activeVotes = Array.from(this.votes.entries()).map(([paramPath, votes]) => {
        const votingEndTime = this.votingPeriods.get(paramPath) || new Date();
        const totalVotes = votes.reduce((sum, vote) => sum + vote.votingPower, 0);
        const requiredQuorum = this.getRequiredQuorumForParameter(paramPath);
        const totalSupply = 100000; // Mock total supply
        const requiredVotes = (totalSupply * requiredQuorum) / 100;
        
        return {
          parameterPath: paramPath,
          proposedValue: votes[0]?.newValue || null,
          votingEnds: votingEndTime,
          currentVotes: totalVotes,
          requiredVotes,
        };
      });
      
      // Get recent changes from our history
      const recentChanges = this.parameterChangeHistory.slice(-10); // Last 10 changes
      
      // Create the snapshot message directly instead of using governance message handler
      const snapshotMessage = {
        p: 'hcs-10',
        op: 'state_snapshot',
        operator_id: `${this.inboundTopicId}@${this.accountId}`,
        data: {
          eventType,
          timestamp: new Date().toISOString(),
          parameters: fullParameters,
          activeVotes,
          recentChanges,
        },
        m: memo || `Governance snapshot: ${eventType}`,
      };
      
      // Send directly to outbound topic using basic sendMessage
      const sequenceNumber = await this.client.sendMessage(
        this.outboundTopicId,
        JSON.stringify(snapshotMessage),
        memo || `Governance snapshot: ${eventType}`
      );
      
      this.logger.info(`Governance snapshot published successfully for event: ${eventType} (sequence: ${sequenceNumber})`);
    } catch (error) {
      this.logger.error(`Error publishing governance snapshot: ${error}`);
      // Don't throw - snapshot publishing shouldn't break the agent
    }
  }

  /**
   * Check if a scheduled snapshot is needed (monthly or configurable frequency)
   */
  private shouldPublishScheduledSnapshot(): boolean {
    if (!this.lastSnapshotTimestamp) {
      return true; // No snapshot yet
    }

    // Get the snapshot frequency from governance parameters (default to monthly)
    const snapshotFrequencyDays = 30; // Could be made configurable via governance params
    const snapshotFrequencyMs = snapshotFrequencyDays * 24 * 60 * 60 * 1000;
    
    const timeSinceLastSnapshot = Date.now() - this.lastSnapshotTimestamp.getTime();
    return timeSinceLastSnapshot >= snapshotFrequencyMs;
  }

  /**
   * Process any pending votes that have finished their voting period
   */
  private async processPendingVotes(): Promise<void> {
    try {
      const now = new Date();
      
      // Check all pending parameter paths
      // Convert Map entries to array to avoid TypeScript iterator issues
      const votingEntries = Array.from(this.votingPeriods.entries());
      
      for (const [paramPath, endTime] of votingEntries) {
        // Skip parameters still in voting period
        if (endTime > now) {
          continue;
        }
        
        // Voting period has ended, process the result
        this.logger.info(`Voting period ended for ${paramPath}`);
        await this.finalizeVote(paramPath);
        
        // Remove from maps
        this.votes.delete(paramPath);
        this.votingPeriods.delete(paramPath);
      }

      // Check if we need a scheduled snapshot (monthly)
      if (this.shouldPublishScheduledSnapshot() && this.parameterChangeHistory.length === 0) {
        this.logger.info('Publishing scheduled heartbeat snapshot');
        await this.publishGovernanceSnapshot('SCHEDULED_HEARTBEAT', 'Monthly governance state heartbeat');
        this.lastSnapshotTimestamp = new Date();
      }
    } catch (error) {
      this.logger.error(`Error processing pending votes: ${error}`);
    }
  }

  /**
   * Remove the wasteful timer-based snapshot publishing
   */
  private async startStateSnapshotPublishing(): Promise<void> {
    // This method is now empty - snapshots are event-driven only
    this.logger.info('State snapshot publishing configured as event-driven:');
    this.logger.info('  • On startup (initial snapshot if needed)');
    this.logger.info('  • After successful parameter changes');
    this.logger.info('  • After vote conclusions (success or failure)');
    this.logger.info('  • Monthly heartbeat (only if no other activity)');
  }

  /**
   * Convert legacy governance parameters to full governance schema format
   */
  private convertToFullGovernanceParameters(): GovernanceParameters {
    const now = new Date();
    
    // Helper to convert legacy ParamOption to schema ParamOption
    const convertParamOption = (legacyParam: any) => ({
      value: legacyParam.value,
      options: legacyParam.options,
      lastChanged: legacyParam.lastChanged || now,
      minQuorum: legacyParam.minQuorum || 15,
      description: legacyParam.description || '',
      constraints: legacyParam.constraints,
    });

    return {
      rebalancing: {
        frequencyHours: convertParamOption(this.params.rebalancing.frequencyHours),
        thresholds: {
          normal: convertParamOption(this.params.rebalancing.thresholds.normal),
          emergency: convertParamOption(this.params.rebalancing.thresholds.emergency),
        },
        cooldownPeriods: {
          normal: convertParamOption(this.params.rebalancing.cooldownPeriods.normal),
          emergency: convertParamOption(this.params.rebalancing.cooldownPeriods.emergency),
        },
        methods: {
          gradual: {
            value: true,
            options: [true, false],
            lastChanged: now,
            minQuorum: 15,
            description: 'Enable gradual rebalancing approach',
          },
          maxSlippageTolerance: {
            value: 2.0,
            options: [0.5, 1.0, 2.0, 3.0],
            lastChanged: now,
            minQuorum: 20,
            description: 'Maximum allowed slippage during rebalancing',
          },
        },
      },
      treasury: {
        weights: Object.fromEntries(
          Object.entries(this.params.treasury.weights).map(([token, param]) => [
            token,
            convertParamOption(param)
          ])
        ),
        maxSlippage: Object.fromEntries(
          Object.entries(this.params.treasury.maxSlippage).map(([token, param]) => [
            token,
            convertParamOption(param)
          ])
        ),
        maxSwapSize: Object.fromEntries(
          Object.entries(this.params.treasury.maxSwapSize).map(([token, param]) => [
            token,
            convertParamOption(param)
          ])
        ),
        sectors: {
          definitions: {
            'Core Hedera': {
              tokens: ['HBAR'],
              maxWeight: {
                value: 50,
                options: [40, 45, 50, 55],
                lastChanged: now,
                minQuorum: 25,
                description: 'Maximum weight for Core Hedera sector',
              },
              minWeight: {
                value: 20,
                options: [15, 20, 25],
                lastChanged: now,
                minQuorum: 25,
                description: 'Minimum weight for Core Hedera sector',
              },
            },
            'DeFi & DEX': {
              tokens: ['SAUCERSWAP', 'HELI'],
              maxWeight: {
                value: 40,
                options: [30, 35, 40, 45],
                lastChanged: now,
                minQuorum: 20,
                description: 'Maximum weight for DeFi & DEX sector',
              },
              minWeight: {
                value: 10,
                options: [5, 10, 15],
                lastChanged: now,
                minQuorum: 20,
                description: 'Minimum weight for DeFi & DEX sector',
              },
            },
            'Enterprise & Utility': {
              tokens: ['HTS', 'HSUITE', 'HASHPACK'],
              maxWeight: {
                value: 30,
                options: [20, 25, 30, 35],
                lastChanged: now,
                minQuorum: 20,
                description: 'Maximum weight for Enterprise sector',
              },
              minWeight: {
                value: 5,
                options: [0, 5, 10],
                lastChanged: now,
                minQuorum: 20,
                description: 'Minimum weight for Enterprise sector',
              },
            },
          },
        },
      },
      fees: {
        mintingFee: convertParamOption(this.params.fees.mintingFee),
        burningFee: convertParamOption(this.params.fees.burningFee),
        operationalFee: convertParamOption(this.params.fees.operationalFee),
        rewardsAllocation: {
          value: 100,
          options: [80, 90, 100],
          lastChanged: now,
          minQuorum: 20,
          description: 'Percentage of fees allocated to token holders',
        },
      },
      governance: {
        quorumPercentage: convertParamOption(this.params.governance.quorumPercentage),
        votingPeriodHours: convertParamOption(this.params.governance.votingPeriodHours),
        proposalThreshold: convertParamOption(this.params.governance.proposalThreshold),
        stakingLockPeriod: {
          value: 168,
          options: [72, 168, 336, 720],
          lastChanged: now,
          minQuorum: 25,
          description: 'Hours staked LYNX must be held before withdrawal',
        },
        emergencyOverride: {
          enabled: {
            value: true,
            options: [true, false],
            lastChanged: now,
            minQuorum: 40,
            description: 'Whether emergency override is enabled',
          },
          threshold: {
            value: 25,
            options: [20, 25, 30, 35],
            lastChanged: now,
            minQuorum: 40,
            description: 'Emergency quorum threshold percentage',
          },
          timeLimit: {
            value: 24,
            options: [6, 12, 24, 48],
            lastChanged: now,
            minQuorum: 40,
            description: 'Time limit for emergency actions (hours)',
          },
        },
      },
      metadata: {
        version: '1.0.0',
        lastUpdated: now,
        totalSupply: 100000,
        contractAddress: this.governanceContractId,
      },
    };
  }

  /**
   * Notify relevant agents of parameter changes
   */
  private async notifyAgentsOfParameterChange(parameterPath: string, newValue: any): Promise<void> {
    try {
      // Determine which agent(s) to notify based on parameter path
      if (parameterPath.startsWith('rebalancing')) {
        await this.notifyRebalancerAgent(parameterPath, newValue);
      }
      
      // Other parameter types could notify other agents as needed
    } catch (error) {
      this.logger.error(`Error notifying agents of parameter change: ${error}`);
    }
  }

  /**
   * Notify the rebalancer agent of parameter changes
   */
  private async notifyRebalancerAgent(parameterPath: string, newValue: any): Promise<void> {
    try {
      this.logger.info(`Notifying rebalancer agent of parameter change: ${parameterPath}`);
      
      // For now, just log the notification - actual implementation would require
      // proper connection setup or direct topic messaging
      this.logger.info(`Would notify rebalancer ${this.rebalancerAgentId}: ${parameterPath} = ${newValue}`);
      
      // TODO: Implement direct topic messaging or proper connection management
      // when the rebalancer agent integration is ready
      
    } catch (error) {
      this.logger.error(`Error notifying rebalancer agent: ${error}`);
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

  // Initialize token registry with test token metadata
  private initializeTokenRegistry(): void {
    // HBAR (Native testnet token)
    this.tokenRegistry.set('HBAR', {
      symbol: 'HBAR',
      name: 'HBAR (Testnet)',
      tokenId: 'HBAR', // Native token
      decimals: 8,
      isTestToken: true
    });

    // SAUCE (Existing testnet token - we didn't create this one)
    this.tokenRegistry.set('SAUCE', {
      symbol: 'SAUCE',
      name: 'SaucerSwap Token (Testnet)',
      tokenId: '0.0.1183558',
      decimals: 6,
      isTestToken: true
    });

    // Also map SAUCERSWAP to SAUCE for backward compatibility
    this.tokenRegistry.set('SAUCERSWAP', {
      symbol: 'SAUCERSWAP',
      name: 'SaucerSwap Token (Testnet)',
      tokenId: '0.0.1183558',
      decimals: 6,
      isTestToken: true
    });

    // WBTC (Test token we created)
    this.tokenRegistry.set('WBTC', {
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin (Test)',
      tokenId: '0.0.6212930',
      decimals: 8,
      isTestToken: true
    });

    // USDC (Test token we created)
    this.tokenRegistry.set('USDC', {
      symbol: 'USDC',
      name: 'USD Coin (Test)',
      tokenId: '0.0.6212931',
      decimals: 6,
      isTestToken: true
    });

    // JAM (Test token we created)
    this.tokenRegistry.set('JAM', {
      symbol: 'JAM',
      name: 'Jam Token (Test)',
      tokenId: '0.0.6212932',
      decimals: 8,
      isTestToken: true
    });

    // HEADSTART (Test token we created)
    this.tokenRegistry.set('HEADSTART', {
      symbol: 'HEADSTART',
      name: 'HeadStarter (Test)',
      tokenId: '0.0.6212933',
      decimals: 8,
      isTestToken: true
    });

    // LYNX (Main token - target for minting)
    this.tokenRegistry.set('LYNX', {
      symbol: 'LYNX',
      name: 'Lynx Index Token',
      tokenId: '0.0.6200902',
      decimals: 8,
      isTestToken: true // Since we're on testnet
    });
  }

  /**
   * Update token metadata in the registry
   * Call this method to configure your actual test token addresses and decimals
   */
  public updateTokenMetadata(symbol: string, metadata: TokenMetadata): void {
    this.tokenRegistry.set(symbol.toUpperCase(), metadata);
    this.logger.info(`Updated token metadata for ${symbol}:`, metadata);
  }

  /**
   * Get token metadata by symbol
   */
  public getTokenMetadata(symbol: string): TokenMetadata | undefined {
    return this.tokenRegistry.get(symbol.toUpperCase());
  }

  /**
   * Validate that a token exists in the registry
   */
  public validateTokenExists(symbol: string): boolean {
    return this.tokenRegistry.has(symbol.toUpperCase());
  }

  /**
   * List all registered tokens
   */
  public listRegisteredTokens(): TokenMetadata[] {
    return Array.from(this.tokenRegistry.values());
  }

  /**
   * Configure test token metadata in bulk
   */
  public configureTestTokens(tokens: TokenMetadata[]): void {
    tokens.forEach(token => {
      this.updateTokenMetadata(token.symbol, token);
    });
    this.logger.info(`Configured ${tokens.length} test tokens in registry`);
  }
} 
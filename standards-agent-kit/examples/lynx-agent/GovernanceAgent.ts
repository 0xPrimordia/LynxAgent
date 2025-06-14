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
import { ethers } from 'ethers';

// Re-export types for backwards compatibility, but these are now defined in governance-schema.ts
export type { GovernanceParameters, ParameterVote, VoteResultMessage, ParamOption };

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
  /** Contract ID for the governance contract */
  governanceContractId?: string;
  /** Vault contract address for executing parameter changes */
  vaultContractAddress?: string;
  /** Private key for the governance agent to interact with vault contract */
  agentPrivateKey?: string;
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
  private vaultContractAddress?: string;
  private agentPrivateKey?: string;
  private ethersProvider?: ethers.JsonRpcProvider;
  private ethersWallet?: ethers.Wallet;
  private vaultContract?: ethers.Contract;

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
    this.vaultContractAddress = config.vaultContractAddress;
    this.agentPrivateKey = config.agentPrivateKey;
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

      // Initialize vault contract if configuration is provided
      if (this.vaultContractAddress && this.agentPrivateKey) {
        this.logger.info(`- Vault Contract Address: ${this.vaultContractAddress}`);
        await this.initializeVaultContract();
      } else {
        this.logger.warn('Vault contract address or agent private key not provided. Vault operations will be disabled.');
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
        ).toStringRaw(),
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
          HBAR: createOption(30, [20, 25, 30, 35, 40], "HBAR weight percentage", 20),
          HSUITE: createOption(15, [10, 15, 20], "HSUITE weight percentage", 15),
          SAUCERSWAP: createOption(15, [10, 15, 20], "SAUCERSWAP weight percentage", 15),
          HTS: createOption(10, [5, 10, 15], "HTS weight percentage", 15),
          HELI: createOption(10, [5, 10, 15], "HELI weight percentage", 15),
          KARATE: createOption(10, [5, 10, 15], "KARATE weight percentage", 15),
          HASHPACK: createOption(10, [5, 10, 15], "HASHPACK weight percentage", 15)
        },
        maxSlippage: {
          HBAR: createOption(1.0, [0.1, 0.5, 1.0, 2.0], "HBAR max slippage percentage", 15),
          HSUITE: createOption(2.0, [1.0, 2.0, 3.0, 5.0], "HSUITE max slippage percentage", 15),
          SAUCERSWAP: createOption(2.0, [1.0, 2.0, 3.0, 5.0], "SAUCERSWAP max slippage percentage", 15),
          HTS: createOption(3.0, [1.0, 2.0, 3.0, 5.0], "HTS max slippage percentage", 15),
          HELI: createOption(3.0, [1.0, 2.0, 3.0, 5.0], "HELI max slippage percentage", 15),
          KARATE: createOption(3.0, [1.0, 2.0, 3.0, 5.0], "KARATE max slippage percentage", 15),
          HASHPACK: createOption(3.0, [1.0, 2.0, 3.0, 5.0], "HASHPACK max slippage percentage", 15)
        },
        maxSwapSize: {
          HBAR: createOption(1000000, [100000, 500000, 1000000, 2000000], "HBAR max swap size (in USD)", 20),
          HSUITE: createOption(250000, [50000, 100000, 250000, 500000], "HSUITE max swap size (in USD)", 20),
          SAUCERSWAP: createOption(250000, [50000, 100000, 250000, 500000], "SAUCERSWAP max swap size (in USD)", 20),
          HTS: createOption(100000, [25000, 50000, 100000, 250000], "HTS max swap size (in USD)", 20),
          HELI: createOption(100000, [25000, 50000, 100000, 250000], "HELI max swap size (in USD)", 20),
          KARATE: createOption(100000, [25000, 50000, 100000, 250000], "KARATE max swap size (in USD)", 20),
          HASHPACK: createOption(100000, [25000, 50000, 100000, 250000], "HASHPACK max swap size (in USD)", 20)
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
   * Initialize the vault contract connection for executing parameter changes
   */
  private async initializeVaultContract(): Promise<void> {
    try {
      if (!this.vaultContractAddress || !this.agentPrivateKey) {
        throw new Error('Vault contract address and agent private key are required');
      }

      // Initialize Ethereum provider (using Hashio testnet)
      this.ethersProvider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
      
      // Initialize wallet with the agent's private key
      this.ethersWallet = new ethers.Wallet(this.agentPrivateKey, this.ethersProvider);
      
      // Vault contract ABI (minimal interface for setComposition)
      const VAULT_ABI = [
        {
          "inputs": [{"internalType": "struct IndexVault.Asset[]", "name": "_composition", "type": "tuple[]", "components": [{"name": "token", "type": "address"}, {"name": "weight", "type": "uint16"}]}],
          "name": "setComposition",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        }
      ];
      
      // Initialize vault contract instance
      this.vaultContract = new ethers.Contract(this.vaultContractAddress, VAULT_ABI, this.ethersWallet);
      
      this.logger.info('Vault contract initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize vault contract: ${error}`);
      throw error;
    }
  }

  /**
   * Check if a parameter path refers to token composition/weights
   */
  private isTokenCompositionParameter(parameterPath: string): boolean {
    return parameterPath.startsWith('treasury.weights');
  }

  /**
   * Execute vault contract update for token composition changes
   */
  private async executeVaultContractUpdate(parameterPath: string, newValue: any): Promise<string | undefined> {
    try {
      if (!this.vaultContract) {
        throw new Error('Vault contract not initialized');
      }

      // For now, we only handle token weight changes
      if (!this.isTokenCompositionParameter(parameterPath)) {
        this.logger.debug(`Parameter ${parameterPath} is not a token composition parameter, skipping vault contract update`);
        return undefined;
      }

      // Get current token weights
      const currentWeights = this.getCurrentTokenWeights();
      
      // Create the composition array for the vault contract
      const composition = this.createCompositionArray(currentWeights);
      
      this.logger.info(`Executing vault contract setComposition with ${composition.length} tokens`);
      
      // Execute the contract call
      const tx = await this.vaultContract.setComposition(composition);
      await tx.wait(); // Wait for transaction confirmation

      this.logger.info(`Vault contract updated successfully. Transaction hash: ${tx.hash}`);
      return tx.hash;
    } catch (error) {
      this.logger.error(`Failed to execute vault contract update: ${error}`);
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
   * Create composition array for vault contract from token weights
   */
  private createCompositionArray(weights: Record<string, number>): Array<{token: string, weight: number}> {
    // Token address mapping (you'll need to provide the actual token addresses)
    const TOKEN_ADDRESSES: Record<string, string> = {
      'HBAR': '0x0000000000000000000000000000000000000000', // WHBAR address
      'HSUITE': '0x0000000000000000000000000000000000000001', // Replace with actual address
      'SAUCERSWAP': '0x0000000000000000000000000000000000000002', // Replace with actual address
      'HTS': '0x0000000000000000000000000000000000000003', // Replace with actual address
      'HELI': '0x0000000000000000000000000000000000000004', // Replace with actual address
      'KARATE': '0x0000000000000000000000000000000000000005', // Replace with actual address
      'HASHPACK': '0x0000000000000000000000000000000000000006', // Replace with actual address
    };

    const composition = [];
    
    for (const [token, weight] of Object.entries(weights)) {
      const tokenAddress = TOKEN_ADDRESSES[token];
      if (!tokenAddress) {
        this.logger.warn(`No address found for token ${token}, skipping`);
        continue;
      }
      
      // Convert percentage to basis points (e.g., 30% = 3000 basis points)
      const weightInBasisPoints = Math.round(weight * 100);
      
      composition.push({
        token: tokenAddress,
        weight: weightInBasisPoints
      });
    }
    
    return composition;
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
        this.logger.info(`Successfully parsed JSON, type: ${jsonData.type || 'undefined'}`);
        
        // Handle different message types
        if (jsonData.type === 'PARAMETER_VOTE') {
          this.logger.info(`Found PARAMETER_VOTE message for parameter: ${jsonData.parameterPath}`);
          await this.recordVote(jsonData);
        } else {
          this.logger.info(`Message type '${jsonData.type}' is not PARAMETER_VOTE, skipping`);
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
      
      const vote: ParameterVote = {
        parameterPath: voteData.parameterPath,
        newValue: voteData.newValue,
        voterAccountId: voteData.voterAccountId,
        votingPower: voteData.votingPower,
        timestamp: voteData.timestamp ? new Date(voteData.timestamp) : new Date(),
        txId: voteData.txId,
        reason: voteData.reason
      };
      
      const isNewVotingSession = !this.votes.has(vote.parameterPath);
      
      // Record the vote
      if (isNewVotingSession) {
        this.votes.set(vote.parameterPath, []);
        
        // Set the voting period end time
        const votingPeriodHours = this.params.governance.votingPeriodHours.value;
        const endTime = new Date();
        endTime.setHours(endTime.getHours() + votingPeriodHours);
        this.votingPeriods.set(vote.parameterPath, endTime);
        
        this.logger.info(`Started new voting period for ${vote.parameterPath}, ending at ${endTime}`);
      }
      
      // Get existing votes for this parameter
      const paramVotes = this.votes.get(vote.parameterPath)!;
      
      // Check if this voter has already voted on this parameter
      const existingVoteIndex = paramVotes.findIndex(v => v.voterAccountId === vote.voterAccountId);
      
      if (existingVoteIndex >= 0) {
        // Update existing vote
        paramVotes[existingVoteIndex] = vote;
        this.logger.info(`Updated vote from ${vote.voterAccountId} for ${vote.parameterPath}`);
      } else {
        // Add new vote
        paramVotes.push(vote);
        this.logger.info(`Recorded new vote from ${vote.voterAccountId} for ${vote.parameterPath}`);
      }
      
      // Check if the vote has reached quorum immediately
      const quorumReached = await this.checkQuorum(vote.parameterPath);
      
      // Note: No more automatic snapshots here - only after quorum events
      this.logger.info(`Vote recorded. Current votes: ${paramVotes.length}, Quorum reached: ${quorumReached}`);
    } catch (error) {
      this.logger.error(`Error recording vote: ${error}`);
    }
  }

  /**
   * Check if a parameter vote has reached quorum
   */
  private async checkQuorum(parameterPath: string): Promise<boolean> {
    try {
      // Get the votes for this parameter
      const votes = this.votes.get(parameterPath);
      if (!votes || votes.length === 0) {
        return false;
      }
      
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
      
      // Check if quorum reached
      const quorumReached = totalVotingPower >= requiredVotingPower;
      
      if (quorumReached) {
        this.logger.info(`Quorum reached for ${parameterPath}: ${totalVotingPower} / ${requiredVotingPower}`);
        await this.finalizeVote(parameterPath);
        return true;
      } else {
        this.logger.info(`Quorum not yet reached for ${parameterPath}: ${totalVotingPower} / ${requiredVotingPower}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error checking quorum: ${error}`);
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
} 
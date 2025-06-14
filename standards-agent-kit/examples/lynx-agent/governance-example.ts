import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { GovernanceMessageHandler } from './GovernanceMessageHandler';
import {
  ParamOptionSchema,
  GovernanceParametersFullSchema,
  validateParameterChange,
  DEFAULT_CONSTRAINTS,
  type GovernanceParameters,
  type ParameterVote,
} from './governance-schema';

/**
 * Example demonstrating how to use the governance schema system
 * for a parameterized DAO with predefined "dials" for voting
 */
export class LynxDAOGovernanceExample {
  private messageHandler: GovernanceMessageHandler;
  private client: HCS10Client;

  constructor(client: HCS10Client, accountId: string, inboundTopicId: string, outboundTopicId: string) {
    this.client = client;
    this.messageHandler = new GovernanceMessageHandler({
      client,
      accountId,
      inboundTopicId,
      outboundTopicId,
      logLevel: 'info',
      stateValidation: true,
    });
  }

  /**
   * Initialize the DAO with predefined parameters that match the markdown spec
   */
  public initializeDAOParameters(): GovernanceParameters {
    const now = new Date();

    // Create parameter options with predefined choices (the "dials")
    const createParamOption = <T>(
      value: T,
      options: T[],
      description: string,
      minQuorum = 15,
      constraints?: any
    ) => ({
      value,
      options,
      lastChanged: now,
      minQuorum,
      description,
      constraints,
    });

    const parameters: GovernanceParameters = {
      // Rebalancing parameters
      rebalancing: {
        frequencyHours: createParamOption(
          12,
          [4, 6, 12, 24, 48],
          "How often to check token prices (hours)",
          15,
          DEFAULT_CONSTRAINTS.HOURS
        ),
        thresholds: {
          normal: createParamOption(
            10,
            [5, 7, 10, 15],
            "Deviation percentage that triggers normal rebalance",
            15,
            DEFAULT_CONSTRAINTS.PERCENTAGE
          ),
          emergency: createParamOption(
            15,
            [10, 15, 20, 25],
            "Deviation percentage that triggers emergency rebalance",
            25,
            DEFAULT_CONSTRAINTS.PERCENTAGE
          ),
        },
        cooldownPeriods: {
          normal: createParamOption(
            168,
            [24, 48, 72, 168],
            "Hours to wait between normal rebalances",
            15,
            DEFAULT_CONSTRAINTS.HOURS
          ),
          emergency: createParamOption(
            0,
            [0, 6, 12, 24],
            "Hours to wait between emergency rebalances",
            20,
            DEFAULT_CONSTRAINTS.HOURS
          ),
        },
        methods: {
          gradual: createParamOption(
            true,
            [true, false],
            "Enable gradual rebalancing approach",
            15
          ),
          maxSlippageTolerance: createParamOption(
            2.0,
            [0.5, 1.0, 2.0, 3.0],
            "Maximum allowed slippage during rebalancing",
            20,
            DEFAULT_CONSTRAINTS.PERCENTAGE
          ),
        },
      },

      // Treasury parameters with predefined token weights
      treasury: {
        weights: {
          HBAR: createParamOption(30, [20, 25, 30, 35, 40], "HBAR weight percentage", 20),
          HSUITE: createParamOption(15, [10, 15, 20], "HSUITE weight percentage", 15),
          SAUCERSWAP: createParamOption(15, [10, 15, 20], "SAUCERSWAP weight percentage", 15),
          HTS: createParamOption(10, [5, 10, 15], "HTS weight percentage", 15),
          HELI: createParamOption(10, [5, 10, 15], "HELI weight percentage", 15),
          KARATE: createParamOption(10, [5, 10, 15], "KARATE weight percentage", 15),
          HASHPACK: createParamOption(10, [5, 10, 15], "HASHPACK weight percentage", 15),
        },
        maxSlippage: {
          HBAR: createParamOption(1.0, [0.1, 0.5, 1.0, 2.0], "HBAR max slippage percentage", 15),
          HSUITE: createParamOption(2.0, [1.0, 2.0, 3.0, 5.0], "HSUITE max slippage percentage", 15),
          SAUCERSWAP: createParamOption(2.0, [1.0, 2.0, 3.0, 5.0], "SAUCERSWAP max slippage percentage", 15),
          HTS: createParamOption(3.0, [1.0, 2.0, 3.0, 5.0], "HTS max slippage percentage", 15),
          HELI: createParamOption(3.0, [1.0, 2.0, 3.0, 5.0], "HELI max slippage percentage", 15),
          KARATE: createParamOption(3.0, [1.0, 2.0, 3.0, 5.0], "KARATE max slippage percentage", 15),
          HASHPACK: createParamOption(3.0, [1.0, 2.0, 3.0, 5.0], "HASHPACK max slippage percentage", 15),
        },
        maxSwapSize: {
          HBAR: createParamOption(1000000, [100000, 500000, 1000000, 2000000], "HBAR max swap size (in USD)", 20),
          HSUITE: createParamOption(250000, [50000, 100000, 250000, 500000], "HSUITE max swap size (in USD)", 20),
          SAUCERSWAP: createParamOption(250000, [50000, 100000, 250000, 500000], "SAUCERSWAP max swap size (in USD)", 20),
          HTS: createParamOption(100000, [25000, 50000, 100000, 250000], "HTS max swap size (in USD)", 20),
          HELI: createParamOption(100000, [25000, 50000, 100000, 250000], "HELI max swap size (in USD)", 20),
          KARATE: createParamOption(100000, [25000, 50000, 100000, 250000], "KARATE max swap size (in USD)", 20),
          HASHPACK: createParamOption(100000, [25000, 50000, 100000, 250000], "HASHPACK max swap size (in USD)", 20),
        },
        sectors: {
          definitions: {
            'Core Hedera': {
              tokens: ['HBAR'],
              maxWeight: createParamOption(50, [40, 45, 50, 55], "Maximum weight for Core Hedera sector", 25),
              minWeight: createParamOption(20, [15, 20, 25], "Minimum weight for Core Hedera sector", 25),
            },
            'DeFi & DEX': {
              tokens: ['SAUCE', 'HELI'],
              maxWeight: createParamOption(40, [30, 35, 40, 45], "Maximum weight for DeFi & DEX sector", 20),
              minWeight: createParamOption(10, [5, 10, 15], "Minimum weight for DeFi & DEX sector", 20),
            },
            'Enterprise & Utility': {
              tokens: ['HTS', 'HSUITE', 'HASHPACK'],
              maxWeight: createParamOption(30, [20, 25, 30, 35], "Maximum weight for Enterprise sector", 20),
              minWeight: createParamOption(5, [0, 5, 10], "Minimum weight for Enterprise sector", 20),
            },
          },
        },
      },

      // Fee parameters
      fees: {
        mintingFee: createParamOption(
          0.2,
          [0.1, 0.2, 0.3, 0.5],
          "Fee charged when minting Lynx tokens (percentage)",
          25,
          DEFAULT_CONSTRAINTS.PERCENTAGE
        ),
        burningFee: createParamOption(
          0.2,
          [0.1, 0.2, 0.3, 0.5],
          "Fee charged when burning Lynx tokens (percentage)",
          25,
          DEFAULT_CONSTRAINTS.PERCENTAGE
        ),
        operationalFee: createParamOption(
          0.1,
          [0.05, 0.1, 0.2, 0.3],
          "Annual operational fee (percentage)",
          25,
          DEFAULT_CONSTRAINTS.PERCENTAGE
        ),
        rewardsAllocation: createParamOption(
          100,
          [80, 90, 100],
          "Percentage of fees allocated to token holders",
          20,
          DEFAULT_CONSTRAINTS.PERCENTAGE
        ),
      },

      // Governance parameters
      governance: {
        quorumPercentage: createParamOption(
          15,
          [10, 15, 20, 25, 30],
          "Default percentage of total supply needed for valid vote",
          30,
          DEFAULT_CONSTRAINTS.QUORUM
        ),
        votingPeriodHours: createParamOption(
          72,
          [48, 72, 96, 168],
          "Hours that a parameter vote remains open",
          20,
          DEFAULT_CONSTRAINTS.HOURS
        ),
        proposalThreshold: createParamOption(
          1000,
          [500, 1000, 2500, 5000],
          "Minimum LYNX tokens needed to propose a parameter change",
          20,
          { min: 100, max: 10000 }
        ),
        stakingLockPeriod: createParamOption(
          168,
          [72, 168, 336, 720],
          "Hours staked LYNX must be held before withdrawal",
          25,
          DEFAULT_CONSTRAINTS.HOURS
        ),
        emergencyOverride: {
          enabled: createParamOption(
            true,
            [true, false],
            "Whether emergency override is enabled",
            40
          ),
          threshold: createParamOption(
            25,
            [20, 25, 30, 35],
            "Emergency quorum threshold percentage",
            40,
            DEFAULT_CONSTRAINTS.QUORUM
          ),
          timeLimit: createParamOption(
            24,
            [6, 12, 24, 48],
            "Time limit for emergency actions (hours)",
            40,
            DEFAULT_CONSTRAINTS.HOURS
          ),
        },
      },

      // Metadata
      metadata: {
        version: '1.0.0',
        lastUpdated: now,
        totalSupply: 100000, // Mock total supply for quorum calculations
        contractAddress: '0.0.123456', // Example contract address
      },
    };

    // Validate the complete parameter structure
    try {
      GovernanceParametersFullSchema.parse(parameters);
      console.log('✅ DAO parameters validation successful');
    } catch (error) {
      console.error('❌ DAO parameters validation failed:', error);
      throw error;
    }

    // Set the initial state in the message handler
    this.messageHandler.setCurrentState(parameters);

    return parameters;
  }

  /**
   * Example: Process a member vote on a parameter "dial"
   */
  public async processParameterVote(
    voterAccountId: string,
    parameterPath: string,
    selectedValue: any,
    votingPower: number,
    reason?: string
  ): Promise<boolean> {
    console.log(`\n📊 Processing vote from ${voterAccountId}:`);
    console.log(`   Parameter: ${parameterPath}`);
    console.log(`   Selected Value: ${selectedValue}`);
    console.log(`   Voting Power: ${votingPower}`);

    // Create the vote message
    const vote = this.messageHandler.createVoteMessage(
      parameterPath,
      selectedValue,
      voterAccountId,
      votingPower,
      reason
    );

    // Validate the vote against current parameters
    const currentState = this.messageHandler.getCurrentState();
    if (currentState) {
      const validation = validateParameterChange(
        parameterPath,
        this.getParameterValue(currentState, parameterPath),
        selectedValue,
        currentState
      );

      if (!validation.isValid) {
        console.error('❌ Vote validation failed:', validation.errors);
        return false;
      }
    }

    // Create and send the governance vote message
    try {
      const sequenceNumber = await this.messageHandler.sendGovernanceMessage(
        'VOTE',
        vote,
        `Vote on ${parameterPath}`
      );

      console.log(`✅ Vote sent successfully. Sequence: ${sequenceNumber}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to send vote:', error);
      return false;
    }
  }

  /**
   * Example: Publish current parameter state to the network
   */
  public async publishCurrentState(): Promise<void> {
    const currentState = this.messageHandler.getCurrentState();
    if (!currentState) {
      throw new Error('No current state available');
    }

    // Example active votes (would come from actual vote tracking)
    const activeVotes = [
      {
        parameterPath: 'rebalancing.thresholds.normal',
        proposedValue: 15,
        votingEnds: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        currentVotes: 2500,
        requiredVotes: 15000, // 15% of 100,000 total supply
      },
    ];

    // Example recent changes
    const recentChanges = [
      {
        parameterPath: 'treasury.weights.HBAR',
        oldValue: 25,
        newValue: 30,
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        txId: '0.0.123456@1234567890.123456789',
      },
    ];

    try {
      const sequenceNumber = await this.messageHandler.publishStateSnapshot(
        currentState,
        activeVotes,
        recentChanges
      );

      console.log(`✅ State snapshot published. Sequence: ${sequenceNumber}`);
      console.log(`   State Hash: ${this.messageHandler.getStateHash()}`);
    } catch (error) {
      console.error('❌ Failed to publish state snapshot:', error);
      throw error;
    }
  }

  /**
   * Example: Process incoming governance messages
   */
  public async processIncomingMessage(messageData: string): Promise<void> {
    console.log('\n📨 Processing incoming governance message...');

    const result = await this.messageHandler.processMessage(messageData);

    if (result.isValid) {
      console.log(`✅ Message processed successfully: ${result.message?.op}`);
      if (result.processed) {
        console.log('   Message handling completed');
      }
    } else {
      console.error('❌ Message validation failed:');
      result.errors?.forEach(error => console.error(`   - ${error}`));
    }
  }

  /**
   * Example: Validate parameter constraints
   */
  public validateParameterConstraints(): void {
    console.log('\n🔍 Validating parameter constraints...');

    const state = this.messageHandler.getCurrentState();
    if (!state) {
      console.error('❌ No state available for validation');
      return;
    }

    // Check treasury weight constraints (should sum to 100%)
    const totalWeight = Object.values(state.treasury.weights)
      .reduce((sum, weight) => {
        const value = typeof weight.value === 'number' ? weight.value : 0;
        return sum + value;
      }, 0);

    if (Math.abs(totalWeight - 100) > 0.01) {
      console.warn(`⚠️  Treasury weights sum to ${totalWeight}% (should be 100%)`);
    } else {
      console.log('✅ Treasury weights sum correctly to 100%');
    }

    // Check sector constraints
    if (state.treasury.sectors) {
      for (const [sectorName, sector] of Object.entries(state.treasury.sectors.definitions)) {
        const sectorWeight = sector.tokens.reduce((sum, token) => {
          const tokenWeight = state.treasury.weights[token];
          const weight = tokenWeight && typeof tokenWeight.value === 'number' ? tokenWeight.value : 0;
          return sum + weight;
        }, 0);

        const minWeight = typeof sector.minWeight.value === 'number' ? sector.minWeight.value : 0;
        const maxWeight = typeof sector.maxWeight.value === 'number' ? sector.maxWeight.value : 100;

        if (sectorWeight < minWeight || sectorWeight > maxWeight) {
          console.warn(`⚠️  Sector ${sectorName} weight ${sectorWeight}% outside bounds [${minWeight}%, ${maxWeight}%]`);
        } else {
          console.log(`✅ Sector ${sectorName} weight ${sectorWeight}% within bounds`);
        }
      }
    }

    // Validate overall state schema
    const validation = this.messageHandler.validateCurrentState();
    if (validation.isValid) {
      console.log('✅ Overall state schema validation passed');
    } else {
      console.error('❌ State schema validation failed:');
      validation.errors?.forEach(error => console.error(`   - ${error}`));
    }
  }

  /**
   * Utility: Get parameter value by path
   */
  private getParameterValue(state: GovernanceParameters, parameterPath: string): any {
    const pathParts = parameterPath.split('.');
    let value: any = state;

    for (const part of pathParts) {
      if (!value[part]) return undefined;
      value = value[part];
    }

    return value?.value || value;
  }

  /**
   * Example: Display available parameter "dials" for voting
   */
  public displayAvailableParameters(): void {
    console.log('\n🎛️  Available Parameter Dials for Voting:');
    console.log('=====================================');

    const state = this.messageHandler.getCurrentState();
    if (!state) {
      console.log('No parameters loaded');
      return;
    }

    this.displayParameterSection('Rebalancing', state.rebalancing);
    this.displayParameterSection('Treasury Weights', state.treasury.weights);
    this.displayParameterSection('Treasury Slippage', state.treasury.maxSlippage);
    this.displayParameterSection('Fees', state.fees);
    this.displayParameterSection('Governance', state.governance);
  }

  private displayParameterSection(title: string, section: any, prefix = ''): void {
    console.log(`\n${title}:`);
    for (const [key, value] of Object.entries(section)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && 'value' in value) {
        const param = value as any;
        console.log(`  ${key}: ${param.value} (options: ${param.options.join(', ')})`);
        console.log(`    └─ ${param.description}`);
        console.log(`    └─ Quorum: ${param.minQuorum}%`);
      } else if (value && typeof value === 'object') {
        this.displayParameterSection(`${title} - ${key}`, value, path);
      }
    }
  }
}

// Example usage:
export async function runGovernanceExample() {
  console.log('🏛️  Lynx DAO Governance Schema Example');
  console.log('=====================================');

  // This would typically be initialized with real HCS10Client
  // const client = new HCS10Client({ ... });
  // const example = new LynxDAOGovernanceExample(
  //   client,
  //   '0.0.123456',
  //   '0.0.789101',
  //   '0.0.789102'
  // );

  // Initialize DAO parameters
  // const parameters = example.initializeDAOParameters();

  // Display available parameters for voting
  // example.displayAvailableParameters();

  // Simulate a member vote
  // await example.processParameterVote(
  //   '0.0.654321',
  //   'rebalancing.thresholds.normal',
  //   15,
  //   1000,
  //   'Increase threshold for better stability'
  // );

  // Validate constraints
  // example.validateParameterConstraints();

  // Publish current state
  // await example.publishCurrentState();

  console.log('\n✅ Example completed successfully!');
} 
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
  type ParameterStateSnapshot,
  GovernanceParametersFullSchema,
} from './governance-schema';

// Token data structure for market analysis
export interface TokenData {
  symbol: string;
  tokenId: string;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  priceUsd: number;
  sector: string;
  liquidityScore: number;
  eligible: boolean;
  lastUpdated: Date;
}

// Sector analysis structure
export interface SectorAnalysis {
  sectorName: string;
  totalMarketCap: number;
  averageLiquidity: number;
  tokens: TokenData[];
  recommendedWeight: number;
  currentWeight?: number;
  maxTokens: number;
  topToken?: TokenData;
}

// Parameter recommendation structure
export interface ParameterRecommendation {
  parameterPath: string;
  currentValue: any;
  recommendedValue: any;
  confidence: number; // 0-100
  reasoning: string;
  impact: 'low' | 'medium' | 'high';
  urgency: 'low' | 'medium' | 'high';
  dataSource: string[];
}

// Launch parameters structure
export interface LaunchParameters {
  recommendations: ParameterRecommendation[];
  sectorAnalysis: SectorAnalysis[];
  selectedTokens: TokenData[];
  estimatedTVL: number;
  riskAssessment: string;
  timestamp: Date;
}

// Educational tip structure
export interface EducationalTip {
  title: string;
  content: string;
  category: 'parameter' | 'strategy' | 'risk' | 'general';
  relevance: 'high' | 'medium' | 'low';
  relatedParameters?: string[];
}

export interface AdvisorConfig {
  /** HCS10 client configuration */
  client: HCS10Client;
  /** Account ID of the advisor agent */
  accountId: string;
  /** Inbound topic ID for the advisor agent */
  inboundTopicId: string;
  /** Outbound topic ID for the advisor agent */
  outboundTopicId: string;
  /** Governance agent topic for state monitoring */
  governanceTopicId?: string;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** OpenAI API key for AI analysis */
  openAiApiKey?: string;
  /** OpenAI model to use */
  openAiModel?: string;
  /** Update frequency in minutes */
  updateFrequency?: number;
}

/**
 * AdvisorAgent class that provides strategic intelligence, educational assistance,
 * and parameter recommendations for the Lynx DAO
 */
export class AdvisorAgent {
  private logger: Logger;
  private client: HCS10Client;
  private accountId: string;
  private inboundTopicId: string;
  private outboundTopicId: string;
  private governanceTopicId?: string;
  private operatorId: string;
  private isRunning = false;
  private stateManager: IStateManager;
  private connectionsManager: IConnectionsManager;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private analysisInterval: NodeJS.Timeout | null = null;
  private openAiApiKey?: string;
  private openAiModel?: string;
  private updateFrequency: number;
  private connectionTool: ConnectionTool;
  private acceptConnectionTool: AcceptConnectionRequestTool;
  private sendMessageTool: SendMessageTool;
  private checkMessagesTool: CheckMessagesTool;
  private connectionMonitorTool: ConnectionMonitorTool;
  private governanceMessageHandler: GovernanceMessageHandler;
  private aiClient?: ChatOpenAI;
  
  // Data caches
  private currentGovernanceState: GovernanceParameters | null = null;
  private tokenDataCache: Map<string, TokenData> = new Map();
  private lastAnalysisUpdate: Date | null = null;
  private sectorDefinitions: Map<string, string[]> = new Map();

  constructor(config: AdvisorConfig) {
    this.logger = new Logger({
      module: 'AdvisorAgent',
      level: config.logLevel || 'info',
      prettyPrint: true,
    });

    this.client = config.client;
    this.accountId = config.accountId;
    this.inboundTopicId = config.inboundTopicId;
    this.outboundTopicId = config.outboundTopicId;
    this.governanceTopicId = config.governanceTopicId;
    this.operatorId = this.client.getAccountAndSigner().accountId;
    this.openAiApiKey = config.openAiApiKey || process.env.OPENAI_API_KEY;
    this.openAiModel = config.openAiModel || 'gpt-4o';
    this.updateFrequency = config.updateFrequency || 60; // Default 60 minutes

    this.stateManager = new OpenConvaiState();

    this.stateManager.setCurrentAgent({
      name: 'Lynx Advisor Agent',
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

    // Initialize tools
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

    // Initialize governance message handler for state monitoring
    this.governanceMessageHandler = new GovernanceMessageHandler({
      client: this.client,
      accountId: this.accountId,
      inboundTopicId: this.inboundTopicId,
      outboundTopicId: this.outboundTopicId,
      logLevel: config.logLevel || 'info',
      stateValidation: true,
    });

    // Initialize AI client if API key is available
    if (this.openAiApiKey) {
      this.aiClient = new ChatOpenAI({
        openAIApiKey: this.openAiApiKey,
        modelName: this.openAiModel,
        temperature: 0.3, // Conservative for financial advice
      });
    }

    // Initialize sector definitions
    this.initializeSectorDefinitions();
  }

  /**
   * Initialize the agent, loading configuration and preparing it for operation
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Advisor Agent');
      this.logger.info(`- Account ID: ${this.accountId}`);
      this.logger.info(`- Network: ${this.client.getNetwork()}`);
      this.logger.info(`- Update Frequency: ${this.updateFrequency} minutes`);
      
      if (this.governanceTopicId) {
        this.logger.info(`- Governance Topic ID: ${this.governanceTopicId}`);
      } else {
        this.logger.warn('No governance topic ID provided. State monitoring will be limited.');
      }

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
        
        const { RegisterAgentTool } = await import('../../src/tools/RegisterAgentTool');
        const registerAgentTool = new RegisterAgentTool(this.client, this.stateManager);
        
        try {
          const result = await registerAgentTool.invoke({
            name: "Lynx Advisor Agent",
            description: "Provides strategic intelligence, educational assistance, and parameter recommendations for the Lynx DAO",
            capabilities: [0], // TEXT_GENERATION
            setAsCurrent: true,
          });
          
          this.logger.info(`Agent registered successfully: ${result}`);
        } catch (error) {
          this.logger.warn(`Failed to register agent: ${error}`);
        }
      } else {
        this.logger.info(`Using existing agent registration: ${currentAgent.accountId}`);
        
        if (this.inboundTopicId !== '0.0.0' && currentAgent.inboundTopicId !== this.inboundTopicId) {
          this.logger.info(`Updating agent's inbound topic ID in state manager to: ${this.inboundTopicId}`);
          currentAgent.inboundTopicId = this.inboundTopicId;
          this.stateManager.setCurrentAgent(currentAgent);
        }
      }

      this.logger.info('Advisor Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Advisor Agent', error);
      throw error;
    }
  }

  /**
   * Start the agent's monitoring and analysis processes
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('Advisor Agent is already running');
      return;
    }

    this.isRunning = true;
    
    // Start connection monitoring
    await this.startConnectionMonitoring();
    
    // Start governance state monitoring
    if (this.governanceTopicId) {
      await this.startGovernanceMonitoring();
    }

    // Start data analysis and recommendations
    await this.startAnalysisProcess();

    // Generate initial launch parameters recommendation
    await this.generateLaunchRecommendations();

    this.logger.info('Advisor Agent started successfully');
  }

  /**
   * Stop the agent's monitoring processes
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.info('Advisor Agent is not running');
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Advisor Agent stopped');
  }

  /**
   * Initialize predefined sector definitions
   */
  private initializeSectorDefinitions(): void {
    // Based on Lynx_DAO_Parameters.md - max 1 token per sector for launch
    this.sectorDefinitions.set('Core Hedera', ['HBAR']);
    this.sectorDefinitions.set('DeFi & DEX', ['SAUCE', 'HELI']);
    this.sectorDefinitions.set('Enterprise & Utility', ['HTS', 'HSUITE', 'HASHPACK', 'JAM', 'DOVU']);
    this.sectorDefinitions.set('Stablecoins', ['USDC', 'USDT', 'DAI']);
    this.sectorDefinitions.set('GameFi & NFT', ['ASH', 'HEADSTART']);
    this.sectorDefinitions.set('Smart Contract Platforms', ['wBTC']);
    
    this.logger.info('Sector definitions initialized with launch constraints (max 1 token per sector)');
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
      
      this.monitoringInterval = setInterval(async () => {
        if (!this.isRunning) {
          return;
        }
        
        try {
          await this.connectionMonitorTool.invoke({
            monitorDurationSeconds: 5,
            acceptAll: false,
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
   * Start monitoring governance state changes
   */
  private async startGovernanceMonitoring(): Promise<void> {
    try {
      this.logger.info(`Starting to monitor governance topic: ${this.governanceTopicId}`);
      
      // Check for governance state messages periodically
      setInterval(async () => {
        if (!this.isRunning || !this.governanceTopicId) {
          return;
        }
        
        try {
          await this.checkGovernanceStateUpdates();
        } catch (error) {
          this.logger.error(`Error in governance monitoring: ${error}`);
        }
      }, 5 * 60 * 1000); // Check every 5 minutes
      
      this.logger.info('Governance monitoring started successfully');
    } catch (error) {
      this.logger.error(`Failed to start governance monitoring: ${error}`);
      throw error;
    }
  }

  /**
   * Start the data analysis and recommendation process
   */
  private async startAnalysisProcess(): Promise<void> {
    try {
      this.logger.info('Starting analysis and recommendation process');
      
      // Initial analysis
      await this.performMarketAnalysis();
      
      // Set up periodic analysis
      this.analysisInterval = setInterval(async () => {
        if (!this.isRunning) {
          return;
        }
        
        try {
          await this.performMarketAnalysis();
          await this.evaluateCurrentParameters();
          await this.generateEducationalTips();
        } catch (error) {
          this.logger.error(`Error in analysis process: ${error}`);
        }
      }, this.updateFrequency * 60 * 1000); // Convert minutes to milliseconds
      
      this.logger.info(`Analysis process started (${this.updateFrequency} minute intervals)`);
    } catch (error) {
      this.logger.error(`Failed to start analysis process: ${error}`);
      throw error;
    }
  }

  /**
   * Generate launch parameter recommendations
   */
  public async generateLaunchRecommendations(): Promise<LaunchParameters> {
    try {
      this.logger.info('Generating launch parameter recommendations...');
      
      // Perform fresh market analysis
      await this.performMarketAnalysis();
      
      // Analyze each sector and select top token
      const sectorAnalyses: SectorAnalysis[] = [];
      const selectedTokens: TokenData[] = [];
      let estimatedTVL = 0;
      
      for (const [sectorName, tokenSymbols] of Array.from(this.sectorDefinitions.entries())) {
        const sectorAnalysis = await this.analyzeSector(sectorName, tokenSymbols);
        sectorAnalyses.push(sectorAnalysis);
        
        // Select top token from sector (max 1 for launch)
        if (sectorAnalysis.topToken && sectorAnalysis.topToken.eligible) {
          selectedTokens.push(sectorAnalysis.topToken);
          estimatedTVL += sectorAnalysis.topToken.marketCap * (sectorAnalysis.recommendedWeight / 100);
        }
      }
      
      // Generate parameter recommendations
      const recommendations = await this.generateParameterRecommendations(sectorAnalyses, selectedTokens);
      
      // Assess overall risk
      const riskAssessment = await this.assessPortfolioRisk(selectedTokens, sectorAnalyses);
      
      const launchParams: LaunchParameters = {
        recommendations,
        sectorAnalysis: sectorAnalyses,
        selectedTokens,
        estimatedTVL,
        riskAssessment,
        timestamp: new Date(),
      };
      
      // Publish recommendations
      await this.publishLaunchRecommendations(launchParams);
      
      this.logger.info(`Launch recommendations generated for ${selectedTokens.length} tokens across ${sectorAnalyses.length} sectors`);
      return launchParams;
    } catch (error) {
      this.logger.error(`Error generating launch recommendations: ${error}`);
      throw error;
    }
  }

  /**
   * Check for governance state updates from the governance topic
   */
  private async checkGovernanceStateUpdates(): Promise<void> {
    try {
      if (!this.governanceTopicId) return;
      
      const { messages } = await this.client.getMessageStream(this.governanceTopicId);
      
      if (!messages || messages.length === 0) {
        return;
      }
      
      // Look for governance_state messages
      for (const message of messages) {
        if (!message.data) continue;
        
        let messageData: string;
        if (typeof message.data === 'string') {
          messageData = message.data;
        } else {
          messageData = JSON.stringify(message.data);
        }
        
        try {
          const jsonData = JSON.parse(messageData);
          if (jsonData.p === 'hcs-10' && jsonData.op === 'governance_state') {
            this.currentGovernanceState = jsonData.data.parameters;
            this.logger.info('Governance state updated from HCS topic');
          }
        } catch (e) {
          // Not a JSON message, skip
        }
      }
    } catch (error) {
      this.logger.error(`Error checking governance state updates: ${error}`);
    }
  }

  /**
   * Perform market analysis by fetching token data from various sources
   */
  private async performMarketAnalysis(): Promise<void> {
    try {
      this.logger.info('Performing market analysis...');
      
      const mockTokenData = this.generateMockTokenData();
      
      // Update cache
      for (const token of mockTokenData) {
        this.tokenDataCache.set(token.symbol, token);
      }
      
      this.lastAnalysisUpdate = new Date();
      this.logger.info(`Market analysis completed. Updated data for ${mockTokenData.length} tokens`);
    } catch (error) {
      this.logger.error(`Error performing market analysis: ${error}`);
    }
  }

  /**
   * Generate mock token data for demonstration
   */
  private generateMockTokenData(): TokenData[] {
    const now = new Date();
    
    return [
      {
        symbol: 'HBAR',
        tokenId: '0.0.0',
        marketCap: 2500000000,
        liquidity: 50000000,
        volume24h: 25000000,
        priceUsd: 0.08,
        sector: 'Core Hedera',
        liquidityScore: 0.95,
        eligible: true,
        lastUpdated: now,
      },
      {
        symbol: 'SAUCE',
        tokenId: '0.0.731861',
        marketCap: 15000000,
        liquidity: 2000000,
        volume24h: 1000000,
        priceUsd: 0.025,
        sector: 'DeFi & DEX',
        liquidityScore: 0.75,
        eligible: true,
        lastUpdated: now,
      },
      {
        symbol: 'HELI',
        tokenId: '0.0.1456986',
        marketCap: 8000000,
        liquidity: 800000,
        volume24h: 400000,
        priceUsd: 0.012,
        sector: 'DeFi & DEX',
        liquidityScore: 0.65,
        eligible: true,
        lastUpdated: now,
      },
      {
        symbol: 'HSUITE',
        tokenId: '0.0.540921',
        marketCap: 5000000,
        liquidity: 500000,
        volume24h: 250000,
        priceUsd: 0.045,
        sector: 'Enterprise & Utility',
        liquidityScore: 0.70,
        eligible: true,
        lastUpdated: now,
      },
      {
        symbol: 'USDC',
        tokenId: '0.0.456858',
        marketCap: 100000000,
        liquidity: 10000000,
        volume24h: 5000000,
        priceUsd: 1.00,
        sector: 'Stablecoins',
        liquidityScore: 0.90,
        eligible: true,
        lastUpdated: now,
      },
    ];
  }

  /**
   * Analyze a specific sector and recommend weights and token selection
   */
  private async analyzeSector(sectorName: string, tokenSymbols: string[]): Promise<SectorAnalysis> {
    const sectorTokens: TokenData[] = [];
    let totalMarketCap = 0;
    let totalLiquidity = 0;
    
    // Get token data for this sector
    for (const symbol of tokenSymbols) {
      const tokenData = this.tokenDataCache.get(symbol);
      if (tokenData && tokenData.eligible) {
        sectorTokens.push(tokenData);
        totalMarketCap += tokenData.marketCap;
        totalLiquidity += tokenData.liquidity;
      }
    }
    
    // Calculate average liquidity
    const averageLiquidity = sectorTokens.length > 0 ? totalLiquidity / sectorTokens.length : 0;
    
    // Find top token (highest liquidity-adjusted market cap)
    let topToken: TokenData | undefined;
    let bestScore = 0;
    
    for (const token of sectorTokens) {
      const liquidityFactor = Math.min(1, token.liquidity / averageLiquidity);
      const adjustedScore = token.marketCap * liquidityFactor;
      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        topToken = token;
      }
    }
    
    // Calculate recommended weight based on sector importance and market cap
    let recommendedWeight = 0;
    if (sectorName === 'Core Hedera') {
      recommendedWeight = 35;
    } else if (sectorName === 'Stablecoins') {
      recommendedWeight = 20;
    } else if (sectorName === 'DeFi & DEX') {
      recommendedWeight = 20;
    } else {
      recommendedWeight = 15;
    }
    
    return {
      sectorName,
      totalMarketCap,
      averageLiquidity,
      tokens: sectorTokens,
      recommendedWeight,
      maxTokens: 1,
      topToken,
    };
  }

  /**
   * Generate parameter recommendations based on market analysis
   */
  private async generateParameterRecommendations(
    sectorAnalyses: SectorAnalysis[],
    selectedTokens: TokenData[]
  ): Promise<ParameterRecommendation[]> {
    const recommendations: ParameterRecommendation[] = [];
    
    const totalMarketCap = selectedTokens.reduce((sum, token) => sum + token.marketCap, 0);
    const avgLiquidity = selectedTokens.reduce((sum, token) => sum + token.liquidity, 0) / selectedTokens.length;
    
    // Rebalancing frequency recommendation
    recommendations.push({
      parameterPath: 'rebalancing.frequencyHours',
      currentValue: 12,
      recommendedValue: avgLiquidity > 5000000 ? 6 : 12,
      confidence: 80,
      reasoning: avgLiquidity > 5000000 
        ? 'High liquidity allows for more frequent rebalancing with lower slippage'
        : 'Standard frequency recommended for moderate liquidity levels',
      impact: 'medium',
      urgency: 'low',
      dataSource: ['SaucerSwap Liquidity', 'Market Analysis'],
    });
    
    return recommendations;
  }

  /**
   * Assess portfolio risk based on selected tokens and sectors
   */
  private async assessPortfolioRisk(
    selectedTokens: TokenData[],
    sectorAnalyses: SectorAnalysis[]
  ): Promise<string> {
    const totalTokens = selectedTokens.length;
    const avgLiquidityScore = selectedTokens.reduce((sum, token) => sum + token.liquidityScore, 0) / totalTokens;
    
    return `Risk Level: Low\n\nPortfolio contains ${totalTokens} tokens.\nAverage liquidity score: ${avgLiquidityScore.toFixed(2)}\n\nRecommendation: Suitable for launch.`;
  }

  /**
   * Evaluate current parameters against ideal values
   */
  private async evaluateCurrentParameters(): Promise<void> {
    try {
      if (!this.currentGovernanceState) {
        this.logger.warn('No current governance state available for evaluation');
        return;
      }
      
      this.logger.info('Evaluating current DAO parameters...');
    } catch (error) {
      this.logger.error(`Error evaluating current parameters: ${error}`);
    }
  }

  /**
   * Generate educational tips for DAO members
   */
  private async generateEducationalTips(): Promise<void> {
    try {
      this.logger.info('Generating educational tips...');
    } catch (error) {
      this.logger.error(`Error generating educational tips: ${error}`);
    }
  }

  /**
   * Publish launch recommendations to the outbound topic
   */
  private async publishLaunchRecommendations(launchParams: LaunchParameters): Promise<void> {
    try {
      const message = {
        type: 'LAUNCH_RECOMMENDATIONS',
        timestamp: launchParams.timestamp,
        data: launchParams,
      };
      
      await this.sendMessageTool.invoke({
        topicId: this.outboundTopicId,
        message: JSON.stringify(message),
        memo: 'Launch Parameter Recommendations',
      });
      
      this.logger.info('Launch recommendations published');
    } catch (error) {
      this.logger.error(`Error publishing launch recommendations: ${error}`);
    }
  }

  /**
   * Get current token data cache
   */
  public getTokenDataCache(): Map<string, TokenData> {
    return this.tokenDataCache;
  }

  /**
   * Get current governance state
   */
  public getCurrentGovernanceState(): GovernanceParameters | null {
    return this.currentGovernanceState;
  }

  /**
   * Get sector definitions
   */
  public getSectorDefinitions(): Map<string, string[]> {
    return this.sectorDefinitions;
  }

  /**
   * Manually trigger market analysis
   */
  public async triggerAnalysis(): Promise<void> {
    await this.performMarketAnalysis();
    await this.evaluateCurrentParameters();
  }
} 
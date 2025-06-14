import { Logger } from '@hashgraphonline/standards-sdk';
import { KnowledgeBase } from './KnowledgeBase';
import { ChainOfThoughtAnalyzer } from './ChainOfThoughtAnalyzer';
import { RebalanceAlert } from '../../PriceMonitor';

export class SentinelRagSystem {
  private logger: Logger;
  private knowledgeBase: KnowledgeBase;
  private analyzer: ChainOfThoughtAnalyzer;
  private initialized: boolean = false;
  
  constructor(options: {
    openAiApiKey: string;
    openAiModel?: string;
    knowledgeDir?: string;
    logger?: Logger;
  }) {
    this.logger = options.logger || new Logger({
      module: 'SentinelRagSystem',
      level: 'info',
      prettyPrint: true,
    });
    
    // Initialize knowledge base
    this.knowledgeBase = new KnowledgeBase({
      openAiApiKey: options.openAiApiKey,
      openAiModel: options.openAiModel,
      knowledgeDir: options.knowledgeDir,
      logger: this.logger,
    });
    
    // Initialize chain of thought analyzer
    this.analyzer = new ChainOfThoughtAnalyzer({
      knowledgeBase: this.knowledgeBase,
      logger: this.logger,
    });
  }
  
  /**
   * Check if the RAG system is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Initialize the RAG system
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Sentinel RAG system...');
      
      // Initialize knowledge base
      await this.knowledgeBase.initialize();
      
      this.initialized = true;
      this.logger.info('Sentinel RAG system initialized successfully');
    } catch (error) {
      this.logger.error(`Error initializing Sentinel RAG system: ${error}`);
      throw error;
    }
  }
  
  /**
   * Analyze a rebalance alert
   */
  public async analyzeAlert(alert: RebalanceAlert): Promise<string> {
    if (!this.initialized) {
      throw new Error('Sentinel RAG system not initialized');
    }
    
    try {
      this.logger.info(`Analyzing ${alert.type} alert with reason: "${alert.reason}"`);
      
      // Perform chain of thought analysis
      const analysis = await this.analyzer.analyze(alert);
      
      this.logger.info('Analysis completed successfully');
      
      // Return the final analysis
      return analysis.finalAnalysis;
    } catch (error) {
      this.logger.error(`Error analyzing alert: ${error}`);
      return `Failed to analyze alert: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
} 
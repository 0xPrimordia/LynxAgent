import { Logger } from '@hashgraphonline/standards-sdk';
import { RebalanceAlert } from '../../PriceMonitor';
import { KnowledgeBase } from './KnowledgeBase';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load prompts from separate files to avoid massive strings in code
const PROMPTS_DIR = path.join(__dirname, '../../prompts');

export interface AnalysisResult {
  marketAnalysis: string;
  deviationAssessment: string;
  recommendations: string;
  finalAnalysis: string;
}

export class ChainOfThoughtAnalyzer {
  private logger: Logger;
  private knowledgeBase: KnowledgeBase;
  private prompts: Record<string, string> = {};
  
  constructor(options: {
    knowledgeBase: KnowledgeBase;
    logger?: Logger;
  }) {
    this.knowledgeBase = options.knowledgeBase;
    
    this.logger = options.logger || new Logger({
      module: 'ChainOfThoughtAnalyzer',
      level: 'info',
      prettyPrint: true,
    });
    
    // Load prompts from files
    this.loadPrompts();
  }
  
  /**
   * Load prompts from files
   */
  private loadPrompts(): void {
    // Create prompts directory if it doesn't exist
    if (!fs.existsSync(PROMPTS_DIR)) {
      fs.mkdirSync(PROMPTS_DIR, { recursive: true });
      this.createDefaultPrompts();
    }
    
    try {
      const promptFiles = [
        'market_analysis.txt', 
        'deviation_assessment.txt', 
        'recommendations.txt', 
        'final_analysis.txt'
      ];
      
      for (const file of promptFiles) {
        const filePath = path.join(PROMPTS_DIR, file);
        
        // Create default prompt if file doesn't exist
        if (!fs.existsSync(filePath)) {
          this.createDefaultPrompt(file);
        }
        
        // Load prompt
        const promptContent = fs.readFileSync(filePath, 'utf-8');
        const promptKey = file.replace('.txt', '');
        this.prompts[promptKey] = promptContent;
        this.logger.info(`Loaded prompt: ${file}`);
      }
    } catch (error) {
      this.logger.error(`Error loading prompts: ${error}`);
    }
  }
  
  /**
   * Create default prompts
   */
  private createDefaultPrompts(): void {
    const defaultPrompts: Record<string, string> = {
      'market_analysis.txt': 
`Based on this price data: {alert}

Analyze the current market conditions for {tokens}.
Consider:
1. Price movements and volatility
2. Relative changes between tokens
3. Potential causes for these movements

Use only the factual information provided.`,

      'deviation_assessment.txt':
`Market Analysis: {market_analysis}

Token data: {alert}

Relevant knowledge: {knowledge}

Assess the significance of these deviations:
1. Which tokens exceed their standard thresholds?
2. Which tokens exceed their emergency thresholds?
3. How concerning are these deviations in the current market context?
4. Are the deviations correlated or independent?`,

      'recommendations.txt':
`Market Analysis: {market_analysis}

Deviation Assessment: {deviation_assessment}

Relevant knowledge: {knowledge}

Formulate specific recommendations for each token that requires adjustment:
1. Specific actions needed for each token
2. Priority order for adjustments
3. Whether emergency procedures are warranted
4. Considerations for execution timing and market impact`,

      'final_analysis.txt':
`You are the Lynx Sentinel Agent responsible for monitoring token allocations and triggering rebalance operations.

You need to create a concise but comprehensive analysis of the current situation and your recommendations.

Market Analysis: {market_analysis}

Deviation Assessment: {deviation_assessment}

Recommendations: {recommendations}

Relevant knowledge: {knowledge}

Create a final analysis that:
1. Summarizes the key market conditions
2. Explains which tokens need adjustment and why
3. Provides clear, actionable recommendations
4. Justifies whether this is a standard or emergency rebalance
5. Includes any specific guidance for execution

Make your analysis direct, fact-based, and actionable.`
    };
    
    for (const [filename, content] of Object.entries(defaultPrompts)) {
      const filePath = path.join(PROMPTS_DIR, filename);
      fs.writeFileSync(filePath, content);
      this.logger.info(`Created default prompt: ${filename}`);
    }
  }
  
  /**
   * Create a default prompt file
   */
  private createDefaultPrompt(filename: string): void {
    const filePath = path.join(PROMPTS_DIR, filename);
    
    // Use predefined content or a placeholder
    let content = 'This is a placeholder prompt. Please replace with actual content.';
    
    switch (filename) {
      case 'market_analysis.txt':
        content = `Based on this price data: {alert}

Analyze the current market conditions for {tokens}.
Consider:
1. Price movements and volatility
2. Relative changes between tokens
3. Potential causes for these movements

Use only the factual information provided.`;
        break;
        
      case 'deviation_assessment.txt':
        content = `Market Analysis: {market_analysis}

Token data: {alert}

Relevant knowledge: {knowledge}

Assess the significance of these deviations:
1. Which tokens exceed their standard thresholds?
2. Which tokens exceed their emergency thresholds?
3. How concerning are these deviations in the current market context?
4. Are the deviations correlated or independent?`;
        break;
        
      // Additional cases for other prompt files
    }
    
    fs.writeFileSync(filePath, content);
    this.logger.info(`Created default prompt: ${filename}`);
  }
  
  /**
   * Perform a chain of thought analysis on a rebalance alert
   */
  public async analyze(alert: RebalanceAlert): Promise<AnalysisResult> {
    try {
      // Format alert data
      const formattedAlert = JSON.stringify(alert, null, 2);
      const tokensInvolved = alert.tokenData.map(t => t.symbol).join(', ');
      const isEmergency = alert.type === 'EMERGENCY_ALERT';
      
      // Get LLM from knowledge base
      const llm = this.knowledgeBase.getLLM();
      
      // Step 1: Retrieve relevant knowledge about the tokens and situation
      const relevantKnowledgeQuery = `Get information about token weights, thresholds, and ${
        isEmergency ? 'emergency' : 'standard'
      } rebalancing procedures for these tokens: ${tokensInvolved}`;
      
      let relevantKnowledge = await this.knowledgeBase.query(relevantKnowledgeQuery);
      
      // Safety check for undefined or null values
      if (relevantKnowledge === undefined || relevantKnowledge === null) {
        this.logger.warn('Knowledge base returned undefined or null response');
        relevantKnowledge = "No specific knowledge found.";
      }
      
      this.logger.info('Retrieved relevant knowledge from knowledge base');
      
      // Step 2: Multi-step chain of thought analysis
      
      // 2.1 Market condition analysis
      const marketAnalysisPrompt = this.formatPrompt('market_analysis', {
        alert: formattedAlert,
        tokens: tokensInvolved
      });
      
      const marketAnalysis = await llm.invoke(marketAnalysisPrompt);
      this.logger.info('Completed market condition analysis');
      
      // 2.2 Deviation assessment
      const deviationPrompt = this.formatPrompt('deviation_assessment', {
        market_analysis: marketAnalysis.toString(),
        alert: formattedAlert,
        knowledge: relevantKnowledge
      });
      
      const deviationAssessment = await llm.invoke(deviationPrompt);
      this.logger.info('Completed deviation assessment');
      
      // 2.3 Recommendation formulation
      const recommendationPrompt = this.formatPrompt('recommendations', {
        market_analysis: marketAnalysis.toString(),
        deviation_assessment: deviationAssessment.toString(),
        knowledge: relevantKnowledge
      });
      
      const recommendations = await llm.invoke(recommendationPrompt);
      this.logger.info('Formulated rebalance recommendations');
      
      // 2.4 Final comprehensive analysis
      const finalAnalysisPrompt = this.formatPrompt('final_analysis', {
        market_analysis: marketAnalysis.toString(),
        deviation_assessment: deviationAssessment.toString(),
        recommendations: recommendations.toString(),
        knowledge: relevantKnowledge
      });
      
      const finalAnalysis = await llm.invoke(finalAnalysisPrompt);
      this.logger.info('Completed final rebalance analysis');
      
      return {
        marketAnalysis: marketAnalysis.toString(),
        deviationAssessment: deviationAssessment.toString(),
        recommendations: recommendations.toString(),
        finalAnalysis: finalAnalysis.toString()
      };
    } catch (error) {
      this.logger.error(`Error in chain of thought analysis: ${error}`);
      
      // Return fallback analysis if there's an error
      return {
        marketAnalysis: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        deviationAssessment: "Unable to assess deviations due to error.",
        recommendations: "Please monitor the situation manually.",
        finalAnalysis: "The automated analysis process encountered an error. Please review the alert data manually."
      };
    }
  }
  
  /**
   * Format prompt with variables
   */
  private formatPrompt(promptName: string, values: Record<string, string>): string {
    try {
      // Get the prompt template
      let promptTemplate = this.prompts[promptName];
      
      // Safety check
      if (!promptTemplate) {
        this.logger.warn(`Prompt template not found: ${promptName}`);
        return `Please analyze the following data: ${JSON.stringify(values)}`;
      }
      
      // Replace placeholders with values
      for (const [key, value] of Object.entries(values)) {
        // Ensure both the template and value are defined and are strings
        if (promptTemplate && value !== undefined && value !== null) {
          const placeholder = `{${key}}`;
          // Use a safe string replacement method
          promptTemplate = promptTemplate.split(placeholder).join(String(value));
        }
      }
      
      return promptTemplate;
    } catch (error) {
      this.logger.error(`Error formatting prompt ${promptName}: ${error}`);
      // Return a safe fallback
      return `Please analyze this data: ${JSON.stringify(values)}`;
    }
  }
} 
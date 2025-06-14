import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger } from '@hashgraphonline/standards-sdk';
import { PluginRegistry, PluginContext } from '../../src/plugins';
import DeFiPlugin from '../plugins/defi';
import { HbarPricePlugin } from '../../src/plugins/hedera/HbarPricePlugin';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import axios from 'axios';

/**
 * Interface for token configuration with target weights and thresholds
 */
export interface TokenConfig {
  tokenId: string;  // Hedera token ID
  symbol: string;   // Token symbol
  targetWeight: number;  // Target portfolio weight (0-1)
  maxDeviationPercent: number;  // Standard deviation threshold
  emergencyThresholdPercent: number;  // Emergency deviation threshold
}

/**
 * Interface for price data
 */
export interface PriceData {
  tokenId: string;
  symbol: string;
  price: number;
  timestamp: Date;
  source: string;
}

/**
 * Interface for rebalance alert message
 */
export interface RebalanceAlert {
  type: 'REBALANCE_ALERT' | 'EMERGENCY_ALERT';
  reason: string;
  timestamp: Date;
  tokenData: {
    tokenId: string;
    symbol: string;
    currentPrice: number;
    deviationPercent: number;
    targetWeight: number;
    recommendedAction?: string;
  }[];
}

/**
 * Custom tool for getting token portfolio allocation current state
 */
class GetPortfolioStateVsTotalTool extends StructuredTool {
  name = 'get_portfolio_allocation';
  description = 'Get the current portfolio allocation compared to target weights';
  
  schema = z.object({});
  
  constructor(
    private priceMonitor: PriceMonitor
  ) {
    super();
  }
  
  async _call(): Promise<string> {
    try {
      const portfolioState = await this.priceMonitor.getPortfolioState();
      
      // Format the response
      let response = 'Current portfolio allocation vs target:\n\n';
      
      for (const token of portfolioState) {
        response += `${token.symbol} (${token.tokenId}):\n`;
        response += `- Current price: $${token.currentPrice.toFixed(6)}\n`;
        response += `- Current weight: ${(token.currentWeight * 100).toFixed(2)}%\n`;
        response += `- Target weight: ${(token.targetWeight * 100).toFixed(2)}%\n`;
        response += `- Deviation: ${(token.deviationPercent * 100).toFixed(2)}%\n\n`;
      }
      
      return response;
    } catch (error) {
      return `Error fetching portfolio state: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/**
 * Custom tool for checking if rebalance is needed
 */
class CheckRebalanceNeededTool extends StructuredTool {
  name = 'check_rebalance_needed';
  description = 'Check if the portfolio needs rebalancing based on current allocations';
  
  schema = z.object({});
  
  constructor(
    private priceMonitor: PriceMonitor
  ) {
    super();
  }
  
  async _call(): Promise<string> {
    try {
      const rebalanceCheck = await this.priceMonitor.checkRebalanceNeeded();
      
      if (rebalanceCheck.needed) {
        let response = `REBALANCE NEEDED: ${rebalanceCheck.reason}\n\n`;
        response += rebalanceCheck.isEmergency ? 'THIS IS AN EMERGENCY REBALANCE\n\n' : '';
        
        response += 'Token details:\n';
        for (const token of rebalanceCheck.tokenDetails) {
          response += `- ${token.symbol}: ${(token.deviationPercent * 100).toFixed(2)}% deviation `;
          response += token.exceedsEmergencyThreshold ? '(EMERGENCY) ' : (token.exceedsStandardThreshold ? '(ACTION NEEDED) ' : '(within limits) ');
          response += `\n`;
        }
        
        return response;
      } else {
        return 'No rebalance needed at this time. All token allocations are within acceptable deviation limits.';
      }
    } catch (error) {
      return `Error checking rebalance need: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/**
 * PriceMonitor class for monitoring token prices and making rebalance decisions
 */
export class PriceMonitor {
  private logger: Logger;
  private client: HCS10Client;
  private pluginRegistry: PluginRegistry;
  private tokenConfigs: TokenConfig[];
  private currentPrices: Map<string, PriceData> = new Map();
  private tools: StructuredTool[] = [];
  private lastUpdate: Date = new Date();
  private isInitialized: boolean = false;

  constructor(
    client: HCS10Client,
    tokenConfigs: TokenConfig[],
    logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info'
  ) {
    this.logger = new Logger({
      module: 'PriceMonitor',
      level: logLevel,
      prettyPrint: true,
    });
    
    this.client = client;
    this.tokenConfigs = tokenConfigs;
    
    // Initialize the plugin context
    const pluginContext: PluginContext = {
      client: this.client,
      logger: this.logger,
      config: {}
    };
    
    // Initialize the plugin registry
    this.pluginRegistry = new PluginRegistry(pluginContext);
    
    // Add custom tools
    this.tools = [
      new GetPortfolioStateVsTotalTool(this),
      new CheckRebalanceNeededTool(this)
    ];
  }
  
  /**
   * Initialize the price monitor with plugins
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing PriceMonitor...');
      
      // Initialize and register the DeFi plugin
      const defiPlugin = new DeFiPlugin();
      await this.pluginRegistry.registerPlugin(defiPlugin);
      
      // Initialize and register the HBAR price plugin
      const hbarPricePlugin = new HbarPricePlugin();
      await this.pluginRegistry.registerPlugin(hbarPricePlugin);
      
      // Add plugin tools to our tools array
      const pluginTools = this.pluginRegistry.getAllTools();
      this.tools = [...this.tools, ...pluginTools];
      
      this.logger.info(`Registered ${pluginTools.length} plugin tools`);
      
      // Initialize price data
      await this.updatePrices();
      
      this.isInitialized = true;
      this.logger.info('PriceMonitor initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize PriceMonitor', error);
      throw error;
    }
  }
  
  /**
   * Get all tools for use with LangChain
   */
  public getTools(): StructuredTool[] {
    return this.tools;
  }
  
  /**
   * Update price data for all tokens in the configuration
   */
  public async updatePrices(): Promise<void> {
    try {
      this.logger.info('Updating token prices...');
      
      for (const config of this.tokenConfigs) {
        try {
          // In a real implementation, we would use the DeFi plugin's GetTokenPriceTool
          // For now, using a direct API call for simplicity
          let price;
          
          // Use CoinGecko API for common tokens
          if (config.symbol.toLowerCase() === 'hbar') {
            const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd');
            price = response.data['hedera-hashgraph']?.usd || 0;
          } else {
            // Mock prices for other tokens
            // In a real implementation, we would use actual DEX APIs
            price = this.getMockPrice(config.symbol);
          }
          
          // Store the price data
          this.currentPrices.set(config.tokenId, {
            tokenId: config.tokenId,
            symbol: config.symbol,
            price,
            timestamp: new Date(),
            source: 'coingecko/mock'
          });
          
          this.logger.debug(`Updated price for ${config.symbol} (${config.tokenId}): $${price}`);
        } catch (tokenError) {
          this.logger.error(`Error updating price for ${config.symbol}: ${tokenError}`);
        }
      }
      
      this.lastUpdate = new Date();
      this.logger.info(`Updated prices for ${this.currentPrices.size} tokens`);
    } catch (error) {
      this.logger.error('Error updating prices', error);
      throw error;
    }
  }
  
  /**
   * Generate a mock price for testing
   */
  private getMockPrice(symbol: string): number {
    // Base prices for common tokens
    const basePrices: Record<string, number> = {
      'HBAR': 0.075,
      'HSUITE': 0.0125,
      'SAUCERSWAP': 0.032,
      'HTS': 0.0045,
      'HELI': 0.0085,
      'KARATE': 0.0062,
      'HASHPACK': 0.023
    };
    
    const basePrice = basePrices[symbol.toUpperCase()] || 0.01;
    
    // Add a small random fluctuation (-5% to +5%)
    const fluctuation = (Math.random() * 0.1) - 0.05;
    return basePrice * (1 + fluctuation);
  }
  
  /**
   * Get the current state of the portfolio
   */
  public async getPortfolioState(): Promise<{
    tokenId: string;
    symbol: string;
    currentPrice: number;
    currentWeight: number;
    targetWeight: number;
    deviationPercent: number;
  }[]> {
    // If prices are not up to date, refresh them
    if (Date.now() - this.lastUpdate.getTime() > 60000) {
      await this.updatePrices();
    }
    
    // Calculate total portfolio value
    let totalValue = 0;
    const tokenValues = new Map<string, number>();
    
    // Mock token quantities - in a real implementation, these would come from the treasury contract
    const mockQuantities: Record<string, number> = {
      // Assuming these are the tokenIds
      '0.0.1234': 1000000,  // HBAR
      '0.0.5678': 5000000,  // HSUITE
      '0.0.9012': 2000000,  // SAUCERSWAP
      '0.0.3456': 3000000,  // HTS
      '0.0.7890': 4000000,  // HELI
      '0.0.2345': 1500000,  // KARATE
      '0.0.6789': 2500000   // HASHPACK
    };
    
    // Calculate value of each token using Array.from to avoid the MapIterator issue
    Array.from(this.currentPrices.entries()).forEach(([tokenId, priceData]) => {
      const quantity = mockQuantities[tokenId] || 0;
      const value = quantity * priceData.price;
      tokenValues.set(tokenId, value);
      totalValue += value;
    });
    
    // Calculate current weights and deviations
    return this.tokenConfigs.map(config => {
      const priceData = this.currentPrices.get(config.tokenId);
      const value = tokenValues.get(config.tokenId) || 0;
      const currentWeight = totalValue > 0 ? value / totalValue : 0;
      const deviationPercent = currentWeight - config.targetWeight;
      
      return {
        tokenId: config.tokenId,
        symbol: config.symbol,
        currentPrice: priceData?.price || 0,
        currentWeight,
        targetWeight: config.targetWeight,
        deviationPercent
      };
    });
  }
  
  /**
   * Check if the portfolio needs rebalancing
   */
  public async checkRebalanceNeeded(): Promise<{
    needed: boolean;
    isEmergency: boolean;
    reason: string;
    tokenDetails: {
      tokenId: string;
      symbol: string;
      deviationPercent: number;
      exceedsStandardThreshold: boolean;
      exceedsEmergencyThreshold: boolean;
    }[];
  }> {
    const portfolioState = await this.getPortfolioState();
    
    let emergencyRebalanceNeeded = false;
    let standardRebalanceNeeded = false;
    const tokenDetails: {
      tokenId: string;
      symbol: string;
      deviationPercent: number;
      exceedsStandardThreshold: boolean;
      exceedsEmergencyThreshold: boolean;
    }[] = [];
    
    // Check each token against thresholds
    for (const token of portfolioState) {
      const config = this.tokenConfigs.find(t => t.tokenId === token.tokenId);
      if (!config) continue;
      
      const absDeviation = Math.abs(token.deviationPercent);
      const exceedsStandardThreshold = absDeviation * 100 > config.maxDeviationPercent;
      const exceedsEmergencyThreshold = absDeviation * 100 > config.emergencyThresholdPercent;
      
      tokenDetails.push({
        tokenId: token.tokenId,
        symbol: token.symbol,
        deviationPercent: token.deviationPercent,
        exceedsStandardThreshold,
        exceedsEmergencyThreshold
      });
      
      if (exceedsEmergencyThreshold) {
        emergencyRebalanceNeeded = true;
      } else if (exceedsStandardThreshold) {
        standardRebalanceNeeded = true;
      }
    }
    
    // Generate results
    if (emergencyRebalanceNeeded) {
      const emergencyTokens = tokenDetails
        .filter(t => t.exceedsEmergencyThreshold)
        .map(t => t.symbol)
        .join(', ');
      
      return {
        needed: true,
        isEmergency: true,
        reason: `EMERGENCY: ${emergencyTokens} exceeded emergency threshold of deviation`,
        tokenDetails
      };
    } else if (standardRebalanceNeeded) {
      const standardTokens = tokenDetails
        .filter(t => t.exceedsStandardThreshold)
        .map(t => t.symbol)
        .join(', ');
      
      return {
        needed: true,
        isEmergency: false,
        reason: `${standardTokens} exceeded standard deviation threshold`,
        tokenDetails
      };
    }
    
    return {
      needed: false,
      isEmergency: false,
      reason: 'No rebalance needed',
      tokenDetails
    };
  }
  
  /**
   * Generate a rebalance alert if needed
   */
  public async generateRebalanceAlertIfNeeded(): Promise<RebalanceAlert | null> {
    const rebalanceCheck = await this.checkRebalanceNeeded();
    
    if (!rebalanceCheck.needed) {
      return null;
    }
    
    const portfolioState = await this.getPortfolioState();
    
    return {
      type: rebalanceCheck.isEmergency ? 'EMERGENCY_ALERT' : 'REBALANCE_ALERT',
      reason: rebalanceCheck.reason,
      timestamp: new Date(),
      tokenData: portfolioState.map(token => {
        const tokenDetail = rebalanceCheck.tokenDetails.find(t => t.tokenId === token.tokenId);
        
        return {
          tokenId: token.tokenId,
          symbol: token.symbol,
          currentPrice: token.currentPrice,
          deviationPercent: token.deviationPercent,
          targetWeight: token.targetWeight,
          recommendedAction: tokenDetail?.exceedsEmergencyThreshold 
            ? `Immediate rebalance for ${token.symbol}` 
            : (tokenDetail?.exceedsStandardThreshold 
              ? `Consider adjusting ${token.symbol} allocation` 
              : undefined)
        };
      })
    };
  }
  
  /**
   * Get default token configurations
   */
  public static getDefaultTokenConfigs(): TokenConfig[] {
    return [
      {
        tokenId: '0.0.1234',
        symbol: 'HBAR',
        targetWeight: 0.30,
        maxDeviationPercent: 5,
        emergencyThresholdPercent: 15
      },
      {
        tokenId: '0.0.5678',
        symbol: 'HSUITE',
        targetWeight: 0.15,
        maxDeviationPercent: 8,
        emergencyThresholdPercent: 20
      },
      {
        tokenId: '0.0.9012',
        symbol: 'SAUCERSWAP',
        targetWeight: 0.15,
        maxDeviationPercent: 10,
        emergencyThresholdPercent: 25
      },
      {
        tokenId: '0.0.3456',
        symbol: 'HTS',
        targetWeight: 0.10,
        maxDeviationPercent: 7,
        emergencyThresholdPercent: 18
      },
      {
        tokenId: '0.0.7890',
        symbol: 'HELI',
        targetWeight: 0.10,
        maxDeviationPercent: 12,
        emergencyThresholdPercent: 30
      },
      {
        tokenId: '0.0.2345',
        symbol: 'KARATE',
        targetWeight: 0.10,
        maxDeviationPercent: 10,
        emergencyThresholdPercent: 25
      },
      {
        tokenId: '0.0.6789',
        symbol: 'HASHPACK',
        targetWeight: 0.10,
        maxDeviationPercent: 8,
        emergencyThresholdPercent: 20
      }
    ];
  }
} 
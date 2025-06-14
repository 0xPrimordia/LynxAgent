import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { IPlugin /*, PluginContext */ } from '../PluginInterface';
import axios from 'axios'; // Use axios instead of node-fetch

const HEDERA_MIRROR_NODE_API = 'https://mainnet.mirrornode.hedera.com/api/v1';

/**
 * Defines the schema for the HBAR price API response.
 */
const ExchangeRateResponseSchema = z.object({
  current_rate: z.object({
    cent_equivalent: z.number(),
    hbar_equivalent: z.number(),
    expiration_time: z.number(),
  }),
  next_rate: z.object({
    cent_equivalent: z.number(),
    hbar_equivalent: z.number(),
    expiration_time: z.number(),
  }),
  timestamp: z.string(),
});

/**
 * A Langchain tool to get the current HBAR price in USD.
 */
// Export the class for testing purposes
export class GetHbarPriceTool extends StructuredTool {
  name = 'getHbarPrice';
  description = 'Retrieves the current price of HBAR in USD from the Hedera Mirror Node.';
  schema = z.object({}); // No input required for this tool

  /**
   * DISCLAIMER: THIS TOOL USES THE EXCHANGE RATE ENDPOINT FROM THE MIRROR NODE, AND IT IS NOT GUARANTEED TO BE ACCURATE.
   * USE AN ORACLE OR OTHER SOURCES FOR PRODUCTION USE WHERE PRICE IS IMPORTANT.
   * Retrieves the current price of HBAR in USD from the Hedera Mirror Node.
   * @returns A promise that resolves to a string containing the current HBAR price in USD.
   */
  protected async _call(): Promise<string> {
    try {
      // Use axios.get instead of fetch
      const response = await axios.get(`${HEDERA_MIRROR_NODE_API}/network/exchangerate`);

      // Axios puts data directly in response.data
      const data: unknown = response.data;

      // Validate the response structure
      const parsedData = ExchangeRateResponseSchema.safeParse(data);
      if (!parsedData.success) {
         console.error("Failed to parse exchange rate response:", parsedData.error);
         throw new Error('Invalid API response format');
      }

      const { current_rate } = parsedData.data;
      const priceUsd = current_rate.cent_equivalent / current_rate.hbar_equivalent / 100;

      return `The current price of HBAR is $${priceUsd.toFixed(6)} USD.`;
    } catch (error) {
      console.error('Error fetching HBAR price:', error);
      // Handle axios errors specifically if needed, otherwise generic handling
      let errorMessage = 'An unknown error occurred';
      if (axios.isAxiosError(error)) {
        errorMessage = error.message;
        if (error.response) {
          errorMessage += ` (Status: ${error.response.status})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      return `Failed to retrieve HBAR price: ${errorMessage}`;
    }
  }
}


/**
 * DISCLAIMER: THIS PLUGIN USES THE EXCHANGE RATE ENDPOINT FROM THE MIRROR NODE, AND IT IS NOT GUARANTEED TO BE ACCURATE.
 * USE AN ORACLE OR OTHER SOURCES FOR PRODUCTION USE WHERE PRICE IS IMPORTANT.
 * Plugin to provide tools related to Hedera network information, like HBAR price.
 */
export class HbarPricePlugin implements IPlugin {
  id = 'hedera-hbar-price';
  name = 'Hedera HBAR Price Plugin';
  description = 'Provides tools to interact with Hedera network data, specifically HBAR price.';
  version = '1.0.0';
  author = 'Hedera Agent'; // Replace with actual author/team name if desired

  private tools: StructuredTool[];

  constructor() {
    this.tools = [new GetHbarPriceTool()];
  }

  /**
   * Initializes the plugin. Currently no specific initialization needed.
   */
  async initialize(): Promise<void> {
    // No specific initialization required for this plugin yet
    return Promise.resolve();
  }

  /**
   * Returns the tools provided by this plugin.
   * @returns An array containing the GetHbarPriceTool.
   */
  getTools(): StructuredTool[] {
    return this.tools;
  }

  /**
   * Cleans up resources. Currently no cleanup needed.
   */
  async cleanup(): Promise<void> {
    // No cleanup necessary
    return Promise.resolve();
  }
}
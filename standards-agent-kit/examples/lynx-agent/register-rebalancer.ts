#!/usr/bin/env node

import { config } from 'dotenv';
import { OpenConvaiState } from '../../src/state/open-convai-state';
import { RegisterAgentTool } from '../../src/tools/RegisterAgentTool';
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { AIAgentCapability, Logger } from '@hashgraphonline/standards-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
config();

// Configure longer timeout for inscriptions
process.env.INSCRIPTION_TIMEOUT_MS = process.env.INSCRIPTION_TIMEOUT_MS || '120000'; // 2 minutes
process.env.INSCRIPTION_MAX_RETRIES = process.env.INSCRIPTION_MAX_RETRIES || '200'; // 200 retries
process.env.INSCRIPTION_BACKOFF_MS = process.env.INSCRIPTION_BACKOFF_MS || '3000'; // 3 seconds

// Create a logger
const logger = new Logger({
  module: 'RebalancerRegistration',
  level: 'info',
  prettyPrint: true,
});

logger.info('Configuring inscription with extended timeout settings:');
logger.info(`- Timeout: ${process.env.INSCRIPTION_TIMEOUT_MS}ms`);
logger.info(`- Max Retries: ${process.env.INSCRIPTION_MAX_RETRIES}`);
logger.info(`- Backoff: ${process.env.INSCRIPTION_BACKOFF_MS}ms`);

// Validate required environment variables
const requiredEnvVars = [
  'REBALANCER_ACCOUNT',
  'REBALANCER_KEY',
  'HEDERA_NETWORK'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Error: Missing required environment variable ${envVar}`);
    process.exit(1);
  }
}

// Validate network type
const networkType = process.env.HEDERA_NETWORK;
let validNetworkType: 'testnet' | 'mainnet' = 'testnet';

if (networkType === 'mainnet') {
  validNetworkType = 'mainnet';
} else if (networkType !== 'testnet') {
  logger.warn(`Warning: Unsupported network type "${networkType}", defaulting to "testnet"`);
}

/**
 * Load the Rebalancer logo image and convert to base64
 */
async function loadLogoImage(): Promise<string> {
  try {
    // Define the path to the logo
    const logoPath = path.join(__dirname, 'assets', 'rebalancer-logo.png');
    
    // Check if the logo exists
    if (!fs.existsSync(logoPath)) {
      logger.warn(`Logo file not found at ${logoPath}. The agent will be registered without a profile picture.`);
      return '';
    }
    
    // Read the file and convert to base64
    const logoData = fs.readFileSync(logoPath);
    const base64Logo = `data:image/png;base64,${logoData.toString('base64')}`;
    
    logger.info(`Logo loaded successfully (${Math.round(logoData.length / 1024)}KB)`);
    return base64Logo;
  } catch (error) {
    logger.warn(`Error loading logo: ${error}`);
    return '';
  }
}

async function main() {
  logger.info(`=== Registering Rebalancer Agent (${validNetworkType}) ===`);
  logger.info(`Account: ${process.env.REBALANCER_ACCOUNT}`);
  
  try {
    // Initialize state manager for agent
    const stateManager = new OpenConvaiState();
    logger.info('State manager initialized');

    // Set the current agent with rebalancer credentials
    stateManager.setCurrentAgent({
      name: 'Rebalancer Agent',
      accountId: process.env.REBALANCER_ACCOUNT!,
      privateKey: process.env.REBALANCER_KEY!,
      inboundTopicId: '',
      outboundTopicId: '',
      profileTopicId: '',
    });
    
    // Initialize HCS10 client with rebalancer credentials
    logger.info('Initializing HCS10 client...');
    
    // Set up SDK client with custom options for more reliable inscriptions
    const client = new HCS10Client(
      process.env.REBALANCER_ACCOUNT!,
      process.env.REBALANCER_KEY!,
      validNetworkType,
      {
        useEncryption: false,
        logLevel: 'info'
      }
    );
    
    // Try to manually configure inscription settings if possible
    try {
      if (client.standardClient) {
        const clientAny = client.standardClient as any;
        if (clientAny.setInscriptionOptions) {
          clientAny.setInscriptionOptions({
            timeout: parseInt(process.env.INSCRIPTION_TIMEOUT_MS || '120000', 10),
            maxRetries: parseInt(process.env.INSCRIPTION_MAX_RETRIES || '200', 10),
            backoffMs: parseInt(process.env.INSCRIPTION_BACKOFF_MS || '3000', 10),
          });
          logger.info('Successfully configured custom inscription options on the client');
        }
      }
    } catch (error) {
      logger.warn(`Unable to set custom inscription options: ${error}`);
    }
    
    // Create RegisterAgentTool
    const registerTool = new RegisterAgentTool(client, stateManager);
    logger.info('RegisterAgentTool created');
    
    // Define agent capabilities
    const capabilities = [AIAgentCapability.TEXT_GENERATION];
    
    // Load the logo image
    logger.info('Loading Rebalancer logo...');
    const profilePicture = await loadLogoImage();
    
    // Registration parameters
    const registrationParams = {
      name: 'Lynx Rebalancer Agent',
      description: 'Monitors sentinel alerts and executes treasury rebalancing operations',
      capabilities,
      type: 'autonomous' as const,
      model: 'gpt-4-turbo',
      setAsCurrent: true,
      persistence: {
        prefix: 'REBALANCER',
      },
      profilePicture
    };
    
    // Register the agent
    logger.info('Registering Rebalancer Agent using RegisterAgentTool...');
    logger.info('This process may take several minutes. Please be patient...');
    
    const resultJson = await registerTool._call(registrationParams);
    
    // Handle potential errors in the response
    if (resultJson.startsWith('Error:')) {
      throw new Error(resultJson);
    }
    
    const result = JSON.parse(resultJson);
    
    if (result.success) {
      logger.info('\n=== AGENT REGISTRATION SUCCESSFUL ===');
      logger.info(`Agent registered successfully: ${result.name}`);
      logger.info(`Agent Account ID: ${result.accountId}`);
      logger.info(`Inbound Topic ID: ${result.inboundTopicId}`);
      logger.info(`Outbound Topic ID: ${result.outboundTopicId}`);
      logger.info(`Profile Topic ID: ${result.profileTopicId}`);
      
      // Update .env file if it exists
      const envPath = path.join(process.cwd(), '.env.local');
      let envContent = '';
      
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
      }
      
      const envVars = {
        REBALANCER_AGENT_ID: result.accountId,
        REBALANCER_PRIVATE_KEY: result.privateKey,
        REBALANCER_INBOUND_TOPIC_ID: result.inboundTopicId,
        REBALANCER_OUTBOUND_TOPIC_ID: result.outboundTopicId,
        REBALANCER_PROFILE_TOPIC_ID: result.profileTopicId || '',
      };
      
      for (const [key, value] of Object.entries(envVars)) {
        if (envContent.includes(`${key}=`)) {
          // Replace existing variable
          envContent = envContent.replace(
            new RegExp(`${key}=.*`),
            `${key}=${value}`
          );
        } else {
          // Add new variable
          envContent += `\n${key}=${value}`;
        }
      }
      
      fs.writeFileSync(envPath, envContent);
      logger.info(`\nEnvironment variables saved to ${envPath}`);
      
      // Display next steps
      logger.info('\n=== NEXT STEPS ===');
      logger.info('1. Update your .env or .env.local file with the new REBALANCER credentials');
      logger.info('2. Make sure to set SENTINEL_OUTBOUND_TOPIC_ID in your environment to monitor the Sentinel Agent');
      logger.info('3. Start the Rebalancer Agent with npm run rebalancer:start');
    } else {
      logger.error('\nFailed to register agent:', result.message || resultJson);
    }
  } catch (error) {
    logger.error('Error registering Rebalancer Agent:', error);
    logger.error('\nTROUBLESHOOTING TIPS:');
    logger.error('1. The inscription service might be experiencing delays');
    logger.error('2. Try increasing INSCRIPTION_TIMEOUT_MS and INSCRIPTION_MAX_RETRIES in your .env file');
    logger.error('3. Check if you have sufficient HBAR in your account');
    logger.error('4. Try again later when the network might be less congested');
    process.exit(1);
  }
}

// Execute the main function
main().catch(console.error); 
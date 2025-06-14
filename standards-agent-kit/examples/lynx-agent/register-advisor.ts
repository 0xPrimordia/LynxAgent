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
process.env.INSCRIPTION_MAX_RETRIES = process.env.INSCRIPTION_MAX_RETRIES || '60'; // 60 retries
process.env.INSCRIPTION_BACKOFF_MS = process.env.INSCRIPTION_BACKOFF_MS || '5000'; // 5 seconds

// Set up logger
const logger = new Logger({
  module: 'AdvisorRegistration',
  level: 'info',
  prettyPrint: true,
});

// Get configuration from environment variables
const accountId = process.env.ADVISOR_ACCOUNT;
const privateKey = process.env.ADVISOR_KEY;
const networkName = process.env.HEDERA_NETWORK || 'testnet';

// Log configuration
logger.info('Preparing to register Advisor Agent');
logger.info(`Network: ${networkName}`);
logger.info(`Account ID: ${accountId || 'Not provided'}`);

// Read logo image file if available - EXACTLY like governance
let profileImageBase64 = '';
try {
  const imagePath = path.join(__dirname, 'assets', 'sentinel-logo.png');
  if (fs.existsSync(imagePath)) {
    profileImageBase64 = fs.readFileSync(imagePath).toString('base64');
    logger.info(`Loaded profile image: ${imagePath}`);
  } else {
    logger.warn(`Profile image not found at ${imagePath}`);
  }
} catch (error) {
  logger.error(`Error loading profile image: ${error}`);
}

const main = async () => {
  try {
    // Validate required configurations
    if (!accountId || !privateKey) {
      logger.error('Required environment variables missing:');
      if (!accountId) logger.error('- ADVISOR_ACCOUNT must be defined');
      if (!privateKey) logger.error('- ADVISOR_KEY must be defined');
      process.exit(1);
    }

    // Create HCS10 client
    const client = new HCS10Client(
      accountId,
      privateKey,
      networkName as 'testnet' | 'mainnet',
      { useEncryption: false }
    );

    // Create state manager
    const stateManager = new OpenConvaiState();

    // Create RegisterAgentTool
    const registerTool = new RegisterAgentTool(client, stateManager);

    // Register the agent - EXACTLY like governance
    const result = await registerTool.invoke({
      name: 'Lynx Advisor Agent',
      description: 'Provides strategic intelligence, educational assistance, and parameter recommendations for the Lynx DAO. Analyzes market data to suggest optimal launch parameters and evaluates current DAO settings against market conditions.',
      capabilities: [AIAgentCapability.TEXT_GENERATION],
      profileImage: profileImageBase64 || undefined,
      setAsCurrent: true,
      agentConsent: true
    });

    // Extract the agent details from the result
    const agentId = result.accountId || 'Unknown';
    const inboundTopic = result.inboundTopicId || 'Unknown';
    const outboundTopic = result.outboundTopicId || 'Unknown';
    const profileTopic = result.profileTopicId || 'Unknown';

    // Success
    logger.info('===============================');
    logger.info('Advisor Agent Registration Complete');
    logger.info(`Account ID: ${agentId}`);
    logger.info(`Inbound Topic: ${inboundTopic}`);
    logger.info(`Outbound Topic: ${outboundTopic}`);
    logger.info(`Profile Topic: ${profileTopic}`);
    logger.info('===============================');
    logger.info('Update your .env file manually with these values');
    
    logger.info('\n=== ENVIRONMENT VARIABLES ===');
    logger.info(`ADVISOR_AGENT_ID=${agentId}`);
    logger.info(`ADVISOR_PRIVATE_KEY=${result.privateKey || 'Unknown'}`);
    logger.info(`ADVISOR_INBOUND_TOPIC_ID=${inboundTopic}`);
    logger.info(`ADVISOR_OUTBOUND_TOPIC_ID=${outboundTopic}`);
    logger.info(`ADVISOR_PROFILE_TOPIC_ID=${profileTopic}`);

  } catch (error) {
    logger.error('Error registering Advisor Agent:', error);
    process.exit(1);
  }
};

// Run the registration
main(); 
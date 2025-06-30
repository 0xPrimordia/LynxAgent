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

// Load environment variables from the correct path
config({ path: '../../.env' });

// Configure longer timeout for inscriptions
process.env.INSCRIPTION_TIMEOUT_MS = process.env.INSCRIPTION_TIMEOUT_MS || '120000'; // 2 minutes
process.env.INSCRIPTION_MAX_RETRIES = process.env.INSCRIPTION_MAX_RETRIES || '60'; // 60 retries
process.env.INSCRIPTION_BACKOFF_MS = process.env.INSCRIPTION_BACKOFF_MS || '5000'; // 5 seconds

// Set up logger
const logger = new Logger({
  module: 'GovernanceRegistration',
  level: 'info',
  prettyPrint: true,
});

// Get configuration from environment variables - FOLLOW WORKING PATTERN  
const accountId = process.env.GOV2_ACCOUNT;
const privateKey = process.env.GOV2_KEY;
const networkName = process.env.HEDERA_NETWORK || 'testnet';

// Log configuration
logger.info('Preparing to register Governance Agent');
logger.info(`Network: ${networkName}`);
logger.info(`Account ID: ${accountId || 'Not provided'}`);

// Read logo image file if available
let profileImageBase64 = '';
try {
  const imagePath = path.join(__dirname, 'images', 'governance-logo.png');
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
    // Validate required configurations - FOLLOW WORKING PATTERN
    if (!accountId || !privateKey) {
      logger.error('Required environment variables missing:');
      if (!accountId) logger.error('- GOV2_ACCOUNT must be defined');
      if (!privateKey) logger.error('- GOV2_KEY must be defined');
      process.exit(1);
    }

    // Create HCS10 client - FOLLOW WORKING PATTERN
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

    logger.info('Registering Governance Agent...');
    logger.info('This process may take several minutes. Please be patient...');

    // Register the agent - FOLLOW WORKING PATTERN
    const result = await registerTool.invoke({
      name: 'Lynx Governance Agent',
      description: 'Manages DAO governance parameters and executes parameter changes',
      capabilities: [AIAgentCapability.TEXT_GENERATION],
      profileImage: profileImageBase64 || undefined,
      setAsCurrent: true,
      agentConsent: true
    });

    // Extract the agent details from the result - FOLLOW WORKING PATTERN
    const agentId = result.accountId || accountId;
    const inboundTopic = result.inboundTopicId || 'Unknown';
    const outboundTopic = result.outboundTopicId || 'Unknown';
    const profileTopic = result.profileTopicId || 'Unknown';

    // Success - FOLLOW WORKING PATTERN
    logger.info('===============================');
    logger.info('Governance Agent Registration Complete');
    logger.info(`Account ID: ${agentId}`);
    logger.info(`Inbound Topic: ${inboundTopic}`);
    logger.info(`Outbound Topic: ${outboundTopic}`);
    logger.info(`Profile Topic: ${profileTopic}`);
    logger.info('===============================');
    
    logger.info('\n=== ENVIRONMENT VARIABLES ===');
    logger.info(`GOVERNANCE_AGENT_ID=${agentId}`);
    logger.info(`GOVERNANCE_PRIVATE_KEY=${privateKey}`);
    logger.info(`GOVERNANCE_INBOUND_TOPIC_ID=${inboundTopic}`);
    logger.info(`GOVERNANCE_OUTBOUND_TOPIC_ID=${outboundTopic}`);
    logger.info(`GOVERNANCE_PROFILE_TOPIC_ID=${profileTopic}`);

  } catch (error) {
    logger.error('Error registering Governance Agent:', error);
    process.exit(1);
  }
};

// Run the registration
main(); 
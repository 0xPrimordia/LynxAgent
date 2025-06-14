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
  module: 'register-governance',
  level: 'info',
  prettyPrint: true,
});

// Get configuration from environment variables - FOLLOW STANDARDS-EXPERT PATTERN
const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = process.env.HEDERA_OPERATOR_KEY;
const networkName = process.env.HEDERA_NETWORK || 'testnet';

// Log configuration
logger.info('Preparing to register Governance Agent');
logger.info(`Network: ${networkName}`);
logger.info(`Operator Account ID: ${operatorId || 'Not provided'}`);

// Read default image file if available
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
    // Validate required configurations - FOLLOW STANDARDS-EXPERT PATTERN
    if (!operatorId || !operatorKey) {
      logger.error('Required environment variables missing:');
      if (!operatorId) logger.error('- HEDERA_OPERATOR_ID must be defined');
      if (!operatorKey) logger.error('- HEDERA_OPERATOR_KEY must be defined');
      process.exit(1);
    }

    // Initialize state manager
    const stateManager = new OpenConvaiState();

    // Set the current agent with operator credentials (for funding)
    stateManager.setCurrentAgent({
      name: 'Governance Registration Operator',
      accountId: operatorId,
      privateKey: operatorKey,
      inboundTopicId: '',
      outboundTopicId: '',
      profileTopicId: '',
    });

    // Create HCS10 client with OPERATOR credentials (for funding)
    const client = new HCS10Client(
      operatorId,
      operatorKey,
      networkName as 'testnet' | 'mainnet',
      { useEncryption: false }
    );

    // Create RegisterAgentTool
    const registerTool = new RegisterAgentTool(client, stateManager);

    logger.info('Registering Governance Agent...');
    logger.info('This process may take several minutes. Please be patient...');

    // Register the agent and get topics - FOLLOW STANDARDS-EXPERT PATTERN
    const resultJson = await registerTool.invoke({
      name: 'Lynx Governance Agent',
      description: 'Manages DAO governance parameters and executes parameter changes',
      capabilities: [AIAgentCapability.TEXT_GENERATION],
      profilePicture: profileImageBase64 || undefined,
      setAsCurrent: true,
      persistence: {
        prefix: 'GOVERNANCE'
      }
    });

    // Parse the result
    const result = JSON.parse(resultJson);

    if (result.success) {
      logger.info('\n=== GOVERNANCE AGENT REGISTRATION SUCCESSFUL ===');
      logger.info(`Agent registered successfully: ${result.name}`);
      logger.info(`Agent Account ID: ${result.accountId}`);
      logger.info(`Agent Private Key: ${result.privateKey}`);
      logger.info(`Inbound Topic ID: ${result.inboundTopicId}`);
      logger.info(`Outbound Topic ID: ${result.outboundTopicId}`);
      logger.info(`Profile Topic ID: ${result.profileTopicId}`);
      
      logger.info('\n=== ENVIRONMENT VARIABLES TO ADD ===');
      logger.info(`GOVERNANCE_ACCOUNT_ID=${result.accountId}`);
      logger.info(`GOVERNANCE_PRIVATE_KEY=${result.privateKey}`);
      logger.info(`GOVERNANCE_INBOUND_TOPIC_ID=${result.inboundTopicId}`);
      logger.info(`GOVERNANCE_OUTBOUND_TOPIC_ID=${result.outboundTopicId}`);
      logger.info(`GOVERNANCE_PROFILE_TOPIC_ID=${result.profileTopicId || ''}`);
      
      logger.info('\n=== NEXT STEPS ===');
      logger.info('1. Copy the environment variables above to your .env or .env.local file');
      logger.info('2. Start the Governance Agent with npm run lynx-agent:start-governance');
      logger.info('\n=== IMPORTANT: SAVE YOUR PRIVATE KEY ===');
      logger.info(`Your new governance agent private key is: ${result.privateKey}`);
      logger.info('Make sure to save this private key securely!');
      
    } else {
      logger.error('Failed to register agent:', result.message || resultJson);
    }

  } catch (error) {
    logger.error('Error registering governance agent:', error);
    process.exit(1);
  }
};

// Run the registration
main(); 
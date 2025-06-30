#!/usr/bin/env node

import { config } from 'dotenv';
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger } from '@hashgraphonline/standards-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the correct path
config({ path: '../../.env' });

// Set up logger
const logger = new Logger({
  module: 'GovernanceProfileOnly',
  level: 'info',
  prettyPrint: true,
});

// Get configuration from environment variables
const accountId = process.env.GOV2_ACCOUNT;
const privateKey = process.env.GOV2_KEY;
const networkName = process.env.HEDERA_NETWORK || 'testnet';

// Log configuration
logger.info('Creating HCS-11 profile for EXISTING Governance account');
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
    // Validate required configurations
    if (!accountId || !privateKey) {
      logger.error('Required environment variables missing:');
      if (!accountId) logger.error('- GOV2_ACCOUNT must be defined');
      if (!privateKey) logger.error('- GOV2_KEY must be defined');
      process.exit(1);
    }

    // Create HCS10 client for existing account
    const client = new HCS10Client(
      accountId,
      privateKey,
      networkName as 'testnet' | 'mainnet',
      { useEncryption: false }
    );

    logger.info('Creating HCS-11 profile for existing account...');
    logger.info('This will NOT create a new account, only a profile...');

    try {
      // Try using storeHCS11Profile method directly
      const profileResult = await client.standardClient.storeHCS11Profile({
        name: 'Lynx Governance Agent',
        bio: 'Manages DAO governance parameters and executes parameter changes for the Lynx Index Token',
        pfpImage: profileImageBase64 ? Buffer.from(profileImageBase64, 'base64') : undefined,
        model: 'governance-agent-2024',
        socials: []
      });

      logger.info('Profile creation successful!');
      logger.info(`Profile Topic ID: ${profileResult.profileTopicId || 'Unknown'}`);
      
      // For governance, we'll need to manually create topics since this is just profile creation
      logger.info('\n=== MANUAL SETUP REQUIRED ===');
      logger.info('Since this only creates a profile, you need to:');
      logger.info('1. Create an inbound topic for receiving governance votes');
      logger.info('2. Create an outbound topic for publishing governance results');
      logger.info('3. Update your .env file with these topic IDs');
      
      // Show what the env vars should look like
      logger.info('\n=== ENVIRONMENT VARIABLES ===');
      logger.info(`GOVERNANCE_AGENT_ID=${accountId}`);
      logger.info(`GOVERNANCE_PRIVATE_KEY=${privateKey}`);
      logger.info(`GOVERNANCE_PROFILE_TOPIC_ID=${profileResult.profileTopicId || 'CREATE_MANUALLY'}`);
      logger.info(`GOVERNANCE_INBOUND_TOPIC_ID=CREATE_MANUALLY`);
      logger.info(`GOVERNANCE_OUTBOUND_TOPIC_ID=CREATE_MANUALLY`);

    } catch (profileError) {
      logger.error('Profile creation failed:');
      console.error('Profile error details:', profileError);
      
      // If profile creation fails, let's just proceed with using the account as-is
      logger.info('\n=== FALLBACK: USE ACCOUNT AS-IS ===');
      logger.info('Profile creation failed, but you can still use the account directly.');
      logger.info('The governance agent can work without an HCS-11 profile.');
      logger.info('You just need to create the topics manually.');
      
      logger.info('\n=== CREATE TOPICS MANUALLY ===');
      logger.info('Use the Hedera Portal or CLI to create:');
      logger.info('1. One topic for inbound governance votes');
      logger.info('2. One topic for outbound governance results');
      
      logger.info('\n=== ENVIRONMENT VARIABLES ===');
      logger.info(`GOVERNANCE_AGENT_ID=${accountId}`);
      logger.info(`GOVERNANCE_PRIVATE_KEY=${privateKey}`);
      logger.info(`GOVERNANCE_INBOUND_TOPIC_ID=CREATE_MANUALLY`);
      logger.info(`GOVERNANCE_OUTBOUND_TOPIC_ID=CREATE_MANUALLY`);
    }

  } catch (error) {
    logger.error('Error setting up governance profile:');
    console.error('Full error details:', error);
    process.exit(1);
  }
};

// Run the setup
main(); 
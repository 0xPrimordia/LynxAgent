#!/usr/bin/env node

import { config } from 'dotenv';
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger, AgentBuilder, InboundTopicType, AIAgentCapability } from '@hashgraphonline/standards-sdk';
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
  module: 'GovernanceRegistrationExisting',
  level: 'info',
  prettyPrint: true,
});

// Get configuration from environment variables
const accountId = process.env.GOV2_ACCOUNT;
const privateKey = process.env.GOV2_KEY;
const networkName = process.env.HEDERA_NETWORK || 'testnet';

// Log configuration
logger.info('Preparing to register Governance Agent for EXISTING account');
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

    logger.info('Registering profile for existing Governance Agent account...');
    logger.info('This process may take several minutes. Please be patient...');

    // Use the Standards SDK directly to register the agent profile without creating a new account
    const agentBuilder = new AgentBuilder()
      .setName('Lynx Governance Agent')
      .setBio('Manages DAO governance parameters and executes parameter changes')
      .setCapabilities([AIAgentCapability.TEXT_GENERATION])
      .setType('autonomous')
      .setModel('agent-model-2024')
      .setNetwork(networkName as 'testnet' | 'mainnet')
      .setInboundTopicType(InboundTopicType.PUBLIC);

    // Add profile image if available
    if (profileImageBase64) {
      const profileImageBuffer = Buffer.from(profileImageBase64, 'base64');
      agentBuilder.setProfilePicture(profileImageBuffer, 'governance-logo.png');
    }

    // Build the agent metadata
    const agentMetadata = await agentBuilder.build();

    // Extract the agent details from the result
    const agentId = registrationResult.accountId || accountId;
    const inboundTopic = registrationResult.inboundTopicId || 'Unknown';
    const outboundTopic = registrationResult.outboundTopicId || 'Unknown';
    const profileTopic = registrationResult.profileTopicId || 'Unknown';

    // Success
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
    logger.error('Error registering Governance Agent profile:');
    console.error('Full error details:', error);
    
    // If the method doesn't exist, fall back to a simpler approach
    if (error instanceof Error && (error.message.includes('registerAgentProfile') || error.message.includes('is not a function'))) {
      logger.info('Falling back to direct profile creation...');
      
      try {
        // Create HCS10 client for existing account
        const client = new HCS10Client(
          accountId!,
          privateKey!,
          networkName as 'testnet' | 'mainnet',
          { useEncryption: false }
        );

        // Create topics manually and register profile
        const profileResponse = await client.standardClient.createProfile({
          name: 'Lynx Governance Agent',
          bio: 'Manages DAO governance parameters and executes parameter changes',
          capabilities: [AIAgentCapability.TEXT_GENERATION],
          type: 'autonomous',
          model: 'agent-model-2024',
          profileImage: profileImageBase64 || undefined,
        });

        logger.info('Profile created successfully using fallback method');
        logger.info(`Profile Topic: ${profileResponse.profileTopicId}`);
        
      } catch (fallbackError) {
        logger.error('Fallback registration also failed:', fallbackError);
        process.exit(1);
      }
    } else {
      process.exit(1);
    }
  }
};

// Run the registration
main(); 
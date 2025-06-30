#!/usr/bin/env node

import { config } from 'dotenv';
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger } from '@hashgraphonline/standards-sdk';

// Load environment variables from the correct path
config({ path: '../../.env' });

// Set up logger
const logger = new Logger({
  module: 'UseExistingGovernanceAccount',
  level: 'info',
  prettyPrint: true,
});

// Get configuration from environment variables
const accountId = process.env.GOVERNANCE_ACCOUNT_ID || process.env.GOV2_ACCOUNT;
const privateKey = process.env.GOVERNANCE_KEY || process.env.GOV2_KEY;
const networkName = process.env.HEDERA_NETWORK || 'testnet';

const main = async () => {
  try {
    logger.info('=== USING EXISTING GOVERNANCE ACCOUNT ===');
    logger.info(`Network: ${networkName}`);
    logger.info(`Account ID: ${accountId || 'Not provided'}`);

    // Validate required configurations
    if (!accountId || !privateKey) {
      logger.error('Required environment variables missing:');
      if (!accountId) logger.error('- GOV2_ACCOUNT must be defined');
      if (!privateKey) logger.error('- GOV2_KEY must be defined');
      process.exit(1);
    }

    // Test the account connection
    const client = new HCS10Client(
      accountId,
      privateKey,
      networkName as 'testnet' | 'mainnet',
      { useEncryption: false }
    );

    // Verify the account works
    logger.info('Testing account connection...');
    const operatorId = client.getOperatorId();
    const network = client.getNetwork();
    
    logger.info(`✅ Account connection successful!`);
    logger.info(`Operator ID: ${operatorId}`);
    logger.info(`Network: ${network}`);

    logger.info('\n=== GOVERNANCE AGENT SETUP COMPLETE ===');
    logger.info('Your existing account is ready to use! No registration needed.');
    logger.info('\nTo complete the setup, you need to:');
    logger.info('1. Create an inbound topic for receiving governance votes');
    logger.info('2. Create an outbound topic for publishing governance results');
    logger.info('3. Add these environment variables to your .env:');
    
    logger.info('\n=== REQUIRED ENVIRONMENT VARIABLES ===');
    logger.info(`GOVERNANCE_AGENT_ID=${accountId}`);
    logger.info(`GOVERNANCE_PRIVATE_KEY=${privateKey}`);
    logger.info(`GOVERNANCE_INBOUND_TOPIC_ID=0.0.YOUR_INBOUND_TOPIC`);
    logger.info(`GOVERNANCE_OUTBOUND_TOPIC_ID=0.0.YOUR_OUTBOUND_TOPIC`);

    logger.info('\n=== CREATE TOPICS USING HEDERA CLI ===');
    logger.info('1. Install Hedera CLI: npm install -g @hashgraph/hedera-cli');
    logger.info('2. Configure: hedera account set-default --account-id YOUR_OPERATOR_ID --private-key YOUR_OPERATOR_KEY');
    logger.info('3. Create inbound topic: hedera topic create --memo "Lynx Governance Inbound"');
    logger.info('4. Create outbound topic: hedera topic create --memo "Lynx Governance Outbound"');
    logger.info('5. Update your .env file with the returned topic IDs');

    logger.info('\n=== ALTERNATIVE: CREATE TOPICS PROGRAMMATICALLY ===');
    logger.info('Or use this code to create topics:');
    logger.info(`
    const inboundTopic = await client.standardClient.createTopic('Lynx Governance Inbound');
    const outboundTopic = await client.standardClient.createTopic('Lynx Governance Outbound');
    console.log('Inbound Topic:', inboundTopic);
    console.log('Outbound Topic:', outboundTopic);
    `);

    logger.info('\n=== NEXT STEPS ===');
    logger.info('1. Create the topics (see instructions above)');
    logger.info('2. Update your .env file with the topic IDs');
    logger.info('3. Start your governance agent normally');
    logger.info('\nThe version mismatch issue should now be resolved with standards-sdk 0.0.121!');

  } catch (error) {
    logger.error('Error testing governance account:');
    console.error('Full error details:', error);
    
    if (error instanceof Error && error.message.includes('INVALID_SIGNATURE')) {
      logger.error('\n❌ INVALID_SIGNATURE ERROR - This suggests:');
      logger.error('1. The private key does not match the account ID');
      logger.error('2. There may still be a version mismatch issue');
      logger.error('3. The account might not exist or be accessible');
      logger.error('\nDouble-check your GOV2_ACCOUNT and GOV2_KEY values.');
    }
    
    process.exit(1);
  }
};

// Run the test
main(); 
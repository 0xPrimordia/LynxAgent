#!/usr/bin/env node

import { config } from 'dotenv';
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger } from '@hashgraphonline/standards-sdk';

// Load environment variables from the correct path
config({ path: '../../.env' });

// Set up logger
const logger = new Logger({
  module: 'MethodDiagnostic',
  level: 'info',
  prettyPrint: true,
});

// Get configuration from environment variables
const accountId = process.env.GOV2_ACCOUNT;
const privateKey = process.env.GOV2_KEY;
const networkName = process.env.HEDERA_NETWORK || 'testnet';

const main = async () => {
  try {
    if (!accountId || !privateKey) {
      logger.error('Required environment variables missing');
      process.exit(1);
    }

    // Create HCS10 client for existing account
    const client = new HCS10Client(
      accountId,
      privateKey,
      networkName as 'testnet' | 'mainnet',
      { useEncryption: false }
    );

    logger.info('=== Available methods on client ===');
    console.log('HCS10Client methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(client)).filter(name => name !== 'constructor'));
    
    logger.info('=== Available methods on standardClient ===');
    console.log('StandardClient methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(client.standardClient)).filter(name => name !== 'constructor'));
    
    logger.info('=== Testing account info ===');
    console.log('Account ID:', client.getOperatorId());
    console.log('Network:', client.getNetwork());

  } catch (error) {
    logger.error('Error:', error);
  }
};

// Run the diagnostic
main(); 
#!/usr/bin/env node

import { PrivateKey, AccountId } from '@hashgraph/sdk';

async function debugAccount() {
  const privateKeyHex = process.env.GOVERNANCE_KEY || process.env.TEST_KEY;
  const expectedAccountId = process.env.GOVERNANCE_ACCOUNT_ID || process.env.TEST_ACCOUNT;
  
  if (!privateKeyHex) {
    console.error('❌ No private key provided via GOVERNANCE_KEY or TEST_KEY');
    process.exit(1);
  }
  
  if (!expectedAccountId) {
    console.error('❌ No account ID provided via GOVERNANCE_ACCOUNT_ID or TEST_ACCOUNT');
    process.exit(1);
  }
  
  try {
    console.log('🔑 Private Key Debugging');
    console.log('========================');
    console.log(`Private Key (hex): ${privateKeyHex}`);
    console.log(`Expected Account: ${expectedAccountId}`);
    console.log('');
    
    // Create PrivateKey from hex
    const privateKey = PrivateKey.fromStringED25519(privateKeyHex);
    console.log(`✅ Successfully parsed private key`);
    
    // Get public key
    const publicKey = privateKey.publicKey;
    console.log(`📋 Derived Public Key: ${publicKey.toStringRaw()}`);
    
    // Try to create account ID (though this doesn't verify it exists)
    const accountId = AccountId.fromString(expectedAccountId);
    console.log(`📋 Account ID Object: ${accountId.toString()}`);
    
    console.log('');
    console.log('🔍 This verifies the private key is valid, but we need to check');
    console.log('   if this public key actually corresponds to the account on Hedera.');
    console.log('   The account/key mismatch might be in the HCS-11 profile.');
    
  } catch (error) {
    console.error(`❌ Error processing private key: ${error}`);
    process.exit(1);
  }
}

debugAccount().catch(console.error); 
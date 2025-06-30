#!/usr/bin/env tsx

import { PrivateKey, AccountId, Client } from '@hashgraph/sdk';
import { config } from 'dotenv';

// Load environment variables from the correct path
config({ path: '../../.env' });

const ACCOUNT_ID = process.env.GOV2_ACCOUNT!;
const PRIVATE_KEY = process.env.GOV2_KEY!;
const HEDERA_NETWORK = process.env.HEDERA_NETWORK || 'testnet';

async function testKeyAndAccount() {
  console.log('🔑 Testing GOV2 Key/Account Match');
  console.log('=================================');
  console.log(`Account: ${ACCOUNT_ID}`);
  console.log(`Network: ${HEDERA_NETWORK}`);
  console.log(`Private Key: ${PRIVATE_KEY?.substring(0, 20)}...`);
  
  try {
    // Test 1: Parse the private key
    console.log('\n1. Testing private key parsing...');
    const privateKey = PrivateKey.fromStringECDSA(PRIVATE_KEY);
    const publicKey = privateKey.publicKey;
    
    console.log(`✅ Private key parsed successfully`);
    console.log(`📋 Derived public key: ${publicKey.toStringRaw()}`);
    
    // Test 2: Check account info from mirror node
    console.log('\n2. Checking account info from mirror node...');
    const mirrorUrl = HEDERA_NETWORK === 'mainnet' 
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : 'https://testnet.mirrornode.hedera.com';
    
    const response = await fetch(`${mirrorUrl}/api/v1/accounts/${ACCOUNT_ID}`);
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status}`);
    }
    
    const accountInfo = await response.json();
    const accountPublicKey = accountInfo.key?.key;
    
    console.log(`✅ Account info retrieved`);
    console.log(`📋 Account public key: ${accountPublicKey}`);
    
    // Test 3: Compare keys
    console.log('\n3. Comparing keys...');
    const match = publicKey.toStringRaw() === accountPublicKey;
    
    if (match) {
      console.log(`🎉 ✅ KEYS MATCH! This account/key pair should work.`);
    } else {
      console.log(`💥 ❌ KEYS DON'T MATCH!`);
      console.log(`   Derived: ${publicKey.toStringRaw()}`);
      console.log(`   Account: ${accountPublicKey}`);
    }
    
    return match;
    
  } catch (error) {
    console.log(`💥 ❌ Error testing key: ${error}`);
    return false;
  }
}

testKeyAndAccount(); 
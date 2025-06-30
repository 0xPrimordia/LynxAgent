#!/usr/bin/env tsx

import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { config } from 'dotenv';

// Load environment variables from the correct path
config({ path: '../../.env' });

const ACCOUNT_ID = process.env.GOV2_ACCOUNT!;
const PRIVATE_KEY = process.env.GOV2_KEY!;
const HEDERA_NETWORK = process.env.HEDERA_NETWORK || 'testnet';

async function testHCS10Client() {
  console.log('🧪 Testing HCS10Client with ECDSA Key');
  console.log('=====================================');
  console.log(`Account: ${ACCOUNT_ID}`);
  console.log(`Network: ${HEDERA_NETWORK}`);
  
  try {
    // Test 1: Create HCS10Client
    console.log('\n1. Creating HCS10Client...');
    const client = new HCS10Client(
      ACCOUNT_ID,
      PRIVATE_KEY,
      HEDERA_NETWORK as 'testnet' | 'mainnet',
      { useEncryption: false }
    );
    console.log('✅ HCS10Client created successfully');
    
    // Test 2: Get operator info
    console.log('\n2. Getting operator info...');
    const operatorId = client.getOperatorId();
    const network = client.getNetwork();
    console.log(`✅ Operator ID: ${operatorId}`);
    console.log(`✅ Network: ${network}`);
    
    // Test 3: Test basic client access
    console.log('\n3. Testing account and signer access...');
    const accountAndSigner = client.getAccountAndSigner();
    console.log(`✅ Account: ${accountAndSigner.accountId}`);
    console.log(`✅ Signer available: ${accountAndSigner.signer ? 'Yes' : 'No'}`);
    
    console.log('\n🎉 All basic HCS10Client tests passed!');
    console.log('The ECDSA key works with HCS10Client for basic operations.');
    
    return true;
    
  } catch (error) {
    console.log(`💥 Error testing HCS10Client: ${error}`);
    return false;
  }
}

testHCS10Client(); 
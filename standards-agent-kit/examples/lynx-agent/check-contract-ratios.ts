#!/usr/bin/env tsx

/**
 * Check Contract Ratios Script
 * 
 * This script queries the contract to get the current token ratios
 * and displays them in a readable format.
 */

import { config } from 'dotenv';
import { HCS10Client } from '../../src/hcs10/HCS10Client.js';
import { ContractCallQuery, ContractId, Client } from '@hashgraph/sdk';

// Load environment variables
config();

// Configuration interface
interface TestConfig {
  ACCOUNT_ID: string;
  PRIVATE_KEY: string | undefined;
  CONTRACT_ID: string;
  NETWORK: 'testnet' | 'mainnet';
}

// Contract ratios interface
interface ContractRatios {
  [key: string]: number | string;
}

// Configuration
const CONFIG: TestConfig = {
  // Use governance account credentials for contract access, fallback to operator, then test account
  ACCOUNT_ID: process.env.GOVERNANCE_ACCOUNT_ID || process.env.OPERATOR_ID || process.env.TEST_ACCOUNT || '0.0.4372449',
  PRIVATE_KEY: process.env.GOVERNANCE_KEY || process.env.OPERATOR_KEY || process.env.TEST_KEY,
  
  // Contract details
  CONTRACT_ID: '0.0.6216949',
  
  // Network
  NETWORK: 'testnet'
};

async function checkContractRatios(): Promise<ContractRatios | null> {
  try {
    console.log('🔍 Checking Contract Ratios');
    console.log('============================');
    
    if (!CONFIG.PRIVATE_KEY) {
      throw new Error('GOVERNANCE_KEY, OPERATOR_KEY, or TEST_KEY environment variable is required');
    }
    
    // Initialize HCS10Client
    const client = new HCS10Client(
      CONFIG.ACCOUNT_ID,
      CONFIG.PRIVATE_KEY,
      CONFIG.NETWORK,
      { logLevel: 'warn' } // Reduce log noise
    );
    
    const hederaClient: Client = client.standardClient.getClient();
    const contractId = ContractId.fromString(CONFIG.CONTRACT_ID);
    
    console.log(`📋 Contract: ${CONFIG.CONTRACT_ID}`);
    console.log(`🌐 Network: ${CONFIG.NETWORK}`);
    console.log(`🔑 Using account: ${CONFIG.ACCOUNT_ID}`);
    console.log('');
    
    // Use the correct ABI function: getCurrentRatios() returns all ratios at once
    console.log('📊 Current Token Ratios:');
    console.log('Token      | Ratio | Symbol');
    console.log('-----------|-------|-------');
    
    const ratios: ContractRatios = {};
    const tokenInfo = [
      { name: 'HBAR', symbol: '♦️' },
      { name: 'WBTC', symbol: '₿' },
      { name: 'SAUCE', symbol: '🥫' },
      { name: 'USDC', symbol: '💵' },
      { name: 'JAM', symbol: '🍯' },
      { name: 'HEADSTART', symbol: '🚀' }
    ];
    
    try {
      // Call getCurrentRatios() which returns all 6 ratios as uint256 array
      const contractQuery = new ContractCallQuery()
        .setContractId(contractId)
        .setFunction("getCurrentRatios")
        .setGas(100000);
        
      const result = await contractQuery.execute(hederaClient);
      
      // Extract all 6 ratios from the result
      // The function returns (uint256,uint256,uint256,uint256,uint256,uint256)
      // representing HBAR, WBTC, SAUCE, USDC, JAM, HEADSTART ratios
      for (let i = 0; i < tokenInfo.length; i++) {
        try {
          const ratio = result.getUint256(i);
          ratios[tokenInfo[i].name] = Number(ratio);
          console.log(`${tokenInfo[i].name.padEnd(10)} | ${String(ratio).padEnd(5)} | ${tokenInfo[i].symbol}`);
        } catch (indexError) {
          ratios[tokenInfo[i].name] = 'error';
          console.log(`${tokenInfo[i].name.padEnd(10)} | ERROR | ${tokenInfo[i].symbol} (index ${i} not available)`);
        }
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.split(':')[0] : String(error);
      console.log(`\n❌ Failed to call getCurrentRatios(): ${errorMessage}`);
      console.log(`\n⚠️  This could mean:`);
      console.log(`   - Contract doesn't have getCurrentRatios() function`);
      console.log(`   - Account ${CONFIG.ACCOUNT_ID} doesn't have read permissions`);
      console.log(`   - Contract address ${CONFIG.CONTRACT_ID} is incorrect`);
      console.log(`   - Network connectivity issues\n`);
      
      // Set all ratios to error
      for (const token of tokenInfo) {
        ratios[token.name] = 'error';
        console.log(`${token.name.padEnd(10)} | ERROR | ${token.symbol} (function call failed)`);
      }
    }
    
    console.log('');
    
    // Calculate total and show percentages
    const validRatios = Object.values(ratios).filter((r): r is number => typeof r === 'number');
    if (validRatios.length > 0) {
      const total = validRatios.reduce((sum, r) => sum + r, 0);
      
      console.log('📈 Ratio Analysis:');
      console.log(`Total: ${total}`);
      console.log('Percentages:');
      
      for (const [token, ratio] of Object.entries(ratios)) {
        if (typeof ratio === 'number') {
          const percentage = ((ratio / total) * 100).toFixed(1);
          console.log(`  ${token}: ${percentage}%`);
        }
      }
    }
    
    console.log('');
    console.log(`🔗 View on HashScan: https://hashscan.io/testnet/contract/${CONFIG.CONTRACT_ID}`);
    
    return ratios;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to check contract ratios:', errorMessage);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  checkContractRatios()
    .then(ratios => {
      console.log('\n✅ Contract ratios retrieved successfully!');
      process.exit(0);
    })
    .catch(error => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('\n💥 Failed to check contract ratios:', errorMessage);
      process.exit(1);
    });
}

export default checkContractRatios; 
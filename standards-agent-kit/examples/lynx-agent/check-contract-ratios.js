#!/usr/bin/env node

/**
 * Check Contract Ratios Script
 * 
 * This script queries the contract to get the current token ratios
 * and displays them in a readable format.
 */

const { HCS10Client } = require('../../src/hcs10/HCS10Client');
const { ContractCallQuery, ContractId } = require('@hashgraph/sdk');

// Configuration
const CONFIG = {
  // Account credentials for querying
  ACCOUNT_ID: process.env.TEST_ACCOUNT || '0.0.4372449',
  PRIVATE_KEY: process.env.TEST_KEY,
  
  // Contract details
  CONTRACT_ID: '0.0.6216949',
  
  // Network
  NETWORK: 'testnet'
};

async function checkContractRatios() {
  try {
    console.log('🔍 Checking Contract Ratios');
    console.log('============================');
    
    if (!CONFIG.PRIVATE_KEY) {
      throw new Error('TEST_KEY environment variable is required');
    }
    
    // Initialize HCS10Client
    const client = new HCS10Client(
      CONFIG.ACCOUNT_ID,
      CONFIG.PRIVATE_KEY,
      CONFIG.NETWORK,
      { logLevel: 'warn' } // Reduce log noise
    );
    
    const hederaClient = client.standardClient.getClient();
    const contractId = ContractId.fromString(CONFIG.CONTRACT_ID);
    
    console.log(`📋 Contract: ${CONFIG.CONTRACT_ID}`);
    console.log(`🌐 Network: ${CONFIG.NETWORK}`);
    console.log('');
    
    // Query each ratio getter function
    const ratioQueries = [
      { name: 'HBAR', func: 'getHbarRatio', symbol: '♦️' },
      { name: 'WBTC', func: 'getWbtcRatio', symbol: '₿' },
      { name: 'SAUCE', func: 'getSauceRatio', symbol: '🥫' },
      { name: 'USDC', func: 'getUsdcRatio', symbol: '💵' },
      { name: 'JAM', func: 'getJamRatio', symbol: '🍯' },
      { name: 'HEADSTART', func: 'getHeadstartRatio', symbol: '🚀' }
    ];
    
    const ratios = {};
    
    console.log('📊 Current Token Ratios:');
    console.log('Token      | Ratio | Symbol');
    console.log('-----------|-------|-------');
    
    for (const query of ratioQueries) {
      try {
        const contractQuery = new ContractCallQuery()
          .setContractId(contractId)
          .setFunction(query.func)
          .setGas(100000);
          
        const result = await contractQuery.execute(hederaClient);
        const ratio = result.getUint256(0);
        ratios[query.name] = ratio;
        
        console.log(`${query.name.padEnd(10)} | ${String(ratio).padEnd(5)} | ${query.symbol}`);
      } catch (error) {
        console.log(`${query.name.padEnd(10)} | ERROR | ${query.symbol} (${error.message.split(':')[0]})`);
        ratios[query.name] = 'error';
      }
    }
    
    console.log('');
    
    // Calculate total and show percentages
    const validRatios = Object.values(ratios).filter(r => typeof r === 'number');
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
    console.error('❌ Failed to check contract ratios:', error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  checkContractRatios()
    .then(ratios => {
      console.log('\n✅ Contract ratios retrieved successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Failed to check contract ratios:', error.message);
      process.exit(1);
    });
}

module.exports = checkContractRatios; 
#!/usr/bin/env node

/**
 * Send Test Vote Script
 * 
 * This script sends a MULTI_RATIO_VOTE to the governance agent
 * to test contract execution functionality.
 */

const { HCS10Client } = require('../../src/hcs10/HCS10Client');

// Configuration
const CONFIG = {
  // Test account credentials
  ACCOUNT_ID: process.env.TEST_ACCOUNT || '0.0.4372449',
  PRIVATE_KEY: process.env.TEST_KEY,
  
  // Governance agent inbound topic
  GOVERNANCE_INBOUND_TOPIC: '0.0.6110235',
  
  // Network
  NETWORK: 'testnet',
  
  // Test vote parameters
  VOTING_POWER: 250000, // High enough to reach quorum
  TEST_RATIOS: {
    USDC: 22,
    SAUCE: 18,
    HBAR: 48
  }
};

async function sendTestVote() {
  try {
    console.log('🚀 Sending Test Vote to Governance Agent');
    console.log('=========================================');
    
    if (!CONFIG.PRIVATE_KEY) {
      throw new Error('TEST_KEY environment variable is required');
    }
    
    // Initialize HCS10Client
    const client = new HCS10Client(
      CONFIG.ACCOUNT_ID,
      CONFIG.PRIVATE_KEY,
      CONFIG.NETWORK,
      { logLevel: 'info' }
    );
    
    // Create the vote message
    const voteMessage = {
      type: 'MULTI_RATIO_VOTE',
      ratioChanges: Object.entries(CONFIG.TEST_RATIOS).map(([token, ratio]) => ({
        token,
        newRatio: ratio
      })),
      voterAccountId: CONFIG.ACCOUNT_ID,
      votingPower: CONFIG.VOTING_POWER,
      timestamp: new Date().toISOString(),
      reason: `Contract execution test - ${new Date().toLocaleTimeString()}`
    };
    
    console.log('📝 Vote Details:');
    console.log(JSON.stringify(voteMessage, null, 2));
    console.log('');
    
    // Send the vote
    console.log(`📨 Sending vote to topic: ${CONFIG.GOVERNANCE_INBOUND_TOPIC}`);
    
    const sequenceNumber = await client.sendMessage(
      CONFIG.GOVERNANCE_INBOUND_TOPIC,
      JSON.stringify(voteMessage),
      'Contract execution test vote'
    );
    
    console.log(`✅ Vote sent successfully!`);
    console.log(`📋 Sequence number: ${sequenceNumber}`);
    console.log(`🔗 Topic: https://hashscan.io/testnet/topic/${CONFIG.GOVERNANCE_INBOUND_TOPIC}`);
    
    console.log('\n🔍 Next Steps:');
    console.log('1. Monitor Heroku logs: heroku logs --tail --app lynx-agents');
    console.log('2. Run the contract execution test: node test-contract-execution.js');
    console.log('3. Check contract state: https://hashscan.io/testnet/contract/0.0.6216949');
    
    return sequenceNumber;
    
  } catch (error) {
    console.error('❌ Failed to send vote:', error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sendTestVote()
    .then(sequenceNumber => {
      console.log('\n🎉 Vote sent successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Failed to send vote:', error.message);
      process.exit(1);
    });
}

module.exports = sendTestVote; 
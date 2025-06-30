#!/usr/bin/env tsx

/**
 * Local Contract Execution Test
 * 
 * This script tests contract execution against a locally running governance agent.
 * It provides detailed debugging and waits for the agent to process the vote.
 */

import { config } from 'dotenv';
import { HCS10Client } from '../../src/hcs10/HCS10Client.js';

// Load environment variables
config();

interface TestConfig {
  GOVERNANCE_INBOUND_TOPIC: string;
  GOVERNANCE_OUTBOUND_TOPIC: string;
  GOVERNANCE_CONTRACT_ID: string;
  TEST_ACCOUNT: string;
  TEST_KEY: string;
  NETWORK: 'testnet' | 'mainnet';
  VOTING_POWER: number;
}

const CONFIG: TestConfig = {
  GOVERNANCE_INBOUND_TOPIC: process.env.GOVERNANCE_INBOUND_TOPIC_ID || '',
  GOVERNANCE_OUTBOUND_TOPIC: process.env.GOVERNANCE_OUTBOUND_TOPIC_ID || '',
  GOVERNANCE_CONTRACT_ID: process.env.GOVERNANCE_CONTRACT_ID || '',
  TEST_ACCOUNT: process.env.TEST_ACCOUNT || '',
  TEST_KEY: process.env.TEST_KEY || '',
  NETWORK: 'testnet',
  VOTING_POWER: 250000, // High enough to reach quorum
};

// Test ratios that should trigger contract execution
const TEST_RATIOS = {
  HBAR: 45,
  WBTC: 5,
  SAUCE: 25,
  USDC: 25
};

class LocalContractTester {
  private client: HCS10Client;
  private voteTimestamp: number = 0;
  private testStartTime: number = 0;

  constructor() {
    // Validate configuration
    if (!CONFIG.TEST_ACCOUNT || !CONFIG.TEST_KEY) {
      console.error('❌ Missing TEST_ACCOUNT or TEST_KEY environment variables');
      process.exit(1);
    }
    
    if (!CONFIG.GOVERNANCE_INBOUND_TOPIC || !CONFIG.GOVERNANCE_OUTBOUND_TOPIC) {
      console.error('❌ Missing GOVERNANCE_INBOUND_TOPIC_ID or GOVERNANCE_OUTBOUND_TOPIC_ID environment variables');
      process.exit(1);
    }
    
    if (!CONFIG.GOVERNANCE_CONTRACT_ID) {
      console.error('❌ Missing GOVERNANCE_CONTRACT_ID environment variable'); 
      process.exit(1);
    }

    // Initialize HCS10 client with test account
    this.client = new HCS10Client(
      CONFIG.TEST_ACCOUNT,
      CONFIG.TEST_KEY,
      CONFIG.NETWORK,
      { useEncryption: false }
    );
  }

  /**
   * Send a multi-ratio vote to the governance agent
   */
  async sendTestVote(): Promise<number> {
    try {
      console.log('🗳️  Sending MULTI_RATIO_VOTE to local governance agent...');
      
      this.voteTimestamp = Date.now();
      this.testStartTime = Date.now();
      
      // Create the vote message
      const voteMessage = {
        type: 'MULTI_RATIO_VOTE',
        ratioChanges: Object.entries(TEST_RATIOS).map(([token, ratio]) => ({
          token,
          newRatio: ratio
        })),
        voterAccountId: CONFIG.TEST_ACCOUNT,
        votingPower: CONFIG.VOTING_POWER,
        timestamp: new Date().toISOString(),
        reason: `Local contract test - ${new Date().toLocaleTimeString()}`
      };
      
      console.log('📝 Vote Details:');
      console.log(`  Voter: ${CONFIG.TEST_ACCOUNT}`);
      console.log(`  Voting Power: ${CONFIG.VOTING_POWER}`);
      console.log(`  Ratio Changes:`);
      Object.entries(TEST_RATIOS).forEach(([token, ratio]) => {
        console.log(`    ${token}: ${ratio}%`);
      });
      console.log(`  Target Topic: ${CONFIG.GOVERNANCE_INBOUND_TOPIC}`);
      
      // Send the vote
      const sequenceNumber = await this.client.sendMessage(
        CONFIG.GOVERNANCE_INBOUND_TOPIC,
        JSON.stringify(voteMessage),
        `Local contract test vote`
      );
      
      console.log(`✅ Vote sent successfully!`);
      console.log(`  Sequence Number: ${sequenceNumber || 'unknown'}`);
      console.log(`  Timestamp: ${new Date(this.voteTimestamp).toLocaleString()}`);
      
      return sequenceNumber || 0;
    } catch (error) {
      console.error('❌ Failed to send test vote:', error);
      throw error;
    }
  }

  /**
   * Monitor the governance agent's response
   */
  async monitorResponse(timeoutMs: number = 120000): Promise<boolean> {
    console.log('\n👁️  Monitoring governance agent response...');
    console.log(`  Timeout: ${timeoutMs / 1000} seconds`);
    console.log(`  Watching outbound topic: ${CONFIG.GOVERNANCE_OUTBOUND_TOPIC}`);
    
    const startTime = Date.now();
    let foundResponse = false;
    
    while (Date.now() - startTime < timeoutMs && !foundResponse) {
      try {
        // Check outbound topic for responses
        const { messages } = await this.client.getMessages(CONFIG.GOVERNANCE_OUTBOUND_TOPIC);
        
        // Look for messages since our vote
        const cutoffTime = new Date(this.voteTimestamp - 5000); // 5 seconds before vote
        
        for (const message of messages) {
          if (!message.timestamp) continue;
          
          const messageTime = new Date(message.timestamp);
          if (messageTime > cutoffTime) {
            console.log(`📨 Found response message:`);
            console.log(`  Timestamp: ${message.timestamp}`);
            console.log(`  Sequence: ${message.sequence_number}`);
            
            // Try to parse the message
            try {
              let messageData: any = message.data;
              if (typeof messageData === 'string') {
                messageData = JSON.parse(messageData);
              }
              
              console.log(`  Type: ${messageData?.type || 'unknown'}`);
              console.log(`  Operation: ${messageData?.op || 'unknown'}`);
              
              // Check for specific governance responses
              if (messageData?.op === 'vote_result' || 
                  messageData?.op === 'state_snapshot' ||
                  messageData?.type === 'PARAMETER_UPDATE') {
                
                console.log(`✅ Found governance response!`);
                console.log(`  Details:`, JSON.stringify(messageData, null, 2));
                foundResponse = true;
                break;
              }
            } catch (e) {
              console.log(`  Content: ${JSON.stringify(message.data).substring(0, 100)}...`);
            }
          }
        }
        
        if (!foundResponse) {
          // Wait before checking again
          await new Promise(resolve => setTimeout(resolve, 5000));
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log(`⏳ Waiting for response... (${elapsed}s elapsed)`);
        }
        
      } catch (error) {
        console.error(`❌ Error monitoring response: ${error}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    if (!foundResponse) {
      console.log(`⏰ No governance response found within ${timeoutMs / 1000} seconds`);
    }
    
    return foundResponse;
  }

  /**
   * Check if contract was executed
   */
  async checkContractExecution(): Promise<boolean> {
    try {
      console.log('\n🔍 Checking for contract execution...');
      
      const mirrorUrl = 'https://testnet.mirrornode.hedera.com';
      const response = await fetch(`${mirrorUrl}/api/v1/contracts/${CONFIG.GOVERNANCE_CONTRACT_ID}/results?limit=5`);
      
      if (!response.ok) {
        console.error(`❌ Mirror node error: ${response.status}`);
        return false;
      }
      
      const data = await response.json();
      const results = data.results || [];
      
      // Look for executions since our test started
      const cutoffTime = new Date(this.testStartTime);
      
      for (const result of results) {
        const resultTime = new Date(result.timestamp);
        if (resultTime > cutoffTime) {
          console.log(`✅ Found contract execution!`);
          console.log(`  Transaction ID: ${result.transaction_id}`);
          console.log(`  Timestamp: ${result.timestamp}`);
          console.log(`  Status: ${result.status}`);
          console.log(`  Gas Used: ${result.gas_used}`);
          
          if (result.function_name) {
            console.log(`  Function: ${result.function_name}`);
          }
          
          return true;
        }
      }
      
      console.log(`❌ No contract executions found since test started`);
      return false;
    } catch (error) {
      console.error(`❌ Error checking contract execution: ${error}`);
      return false;
    }
  }

  /**
   * Run the complete test
   */
  async runTest(): Promise<boolean> {
    console.log('🚀 Starting Local Contract Execution Test');
    console.log('==========================================');
    
    try {
      // Step 1: Send test vote
      console.log('Step 1: Sending test vote...');
      const sequenceNumber = await this.sendTestVote();
      
      // Step 2: Monitor for governance response
      console.log('\nStep 2: Monitoring for governance response...');
      const gotResponse = await this.monitorResponse(60000); // 60 seconds
      
      // Step 3: Check for contract execution
      console.log('\nStep 3: Checking for contract execution...');
      const contractExecuted = await this.checkContractExecution();
      
      // Results
      console.log('\n📊 Test Results:');
      console.log('=================');
      console.log(`Vote Sent: ✅ (Sequence: ${sequenceNumber})`);
      console.log(`Governance Response: ${gotResponse ? '✅' : '❌'}`);
      console.log(`Contract Execution: ${contractExecuted ? '✅' : '❌'}`);
      
      const success = gotResponse && contractExecuted;
      
      if (success) {
        console.log('\n🎉 SUCCESS: Contract execution test passed!');
        console.log('The local governance agent successfully processed the vote and executed the contract.');
      } else {
        console.log('\n⚠️  ISSUES DETECTED:');
        
        if (!gotResponse) {
          console.log('❌ No governance response detected');
          console.log('   Check the local governance agent logs for errors');
        }
        
        if (!contractExecuted) {
          console.log('❌ No contract execution detected');
          console.log('   The vote may not have reached quorum or contract call failed');
        }
        
        console.log('\n💡 Debugging tips:');
        console.log('   - Check the local governance agent console for detailed logs');
        console.log('   - Verify the contract ID is correct');
        console.log('   - Ensure the governance account has permission to call the contract');
        console.log('   - Check if voting power is sufficient for quorum');
      }
      
      return success;
    } catch (error) {
      console.error('💥 Test failed with error:', error);
      return false;
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const tester = new LocalContractTester();
  
  console.log('🔧 Configuration:');
  console.log(`  Test Account: ${CONFIG.TEST_ACCOUNT}`);
  console.log(`  Governance Inbound Topic: ${CONFIG.GOVERNANCE_INBOUND_TOPIC}`);
  console.log(`  Governance Outbound Topic: ${CONFIG.GOVERNANCE_OUTBOUND_TOPIC}`);
  console.log(`  Contract ID: ${CONFIG.GOVERNANCE_CONTRACT_ID}`);
  console.log(`  Network: ${CONFIG.NETWORK}`);
  console.log('');
  
  const success = await tester.runTest();
  process.exit(success ? 0 : 1);
}

main().catch(error => {
  console.error('💥 FATAL ERROR:', error);
  process.exit(1);
}); 
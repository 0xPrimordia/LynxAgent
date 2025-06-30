#!/usr/bin/env tsx

/**
 * Local Governance Agent Runner
 * 
 * This script runs the governance agent locally with enhanced debug logging
 * so we can see exactly what happens when votes are processed and contracts are called.
 */

import { config } from 'dotenv';
import { GovernanceAgent } from './GovernanceAgent.js';
import { initializeHCS10Client } from '../../src/init.js';
import { HCS10Client } from '../../src/hcs10/HCS10Client.js';

// Load environment variables
config();

async function runLocalGovernanceAgent(): Promise<void> {
  console.log('🚀 Starting LOCAL Governance Agent with Enhanced Debugging');
  console.log('==========================================================');
  
  // Get required environment variables
  const governanceAccountId = process.env.GOVERNANCE_ACCOUNT_ID;
  const governanceKey = process.env.GOVERNANCE_KEY;
  const inboundTopic = process.env.GOVERNANCE_INBOUND_TOPIC_ID;
  const outboundTopic = process.env.GOVERNANCE_OUTBOUND_TOPIC_ID;
  const contractId = process.env.GOVERNANCE_CONTRACT_ID;
  
  // Validate required variables
  if (!governanceAccountId) {
    console.error('❌ Missing GOVERNANCE_ACCOUNT_ID environment variable');
    process.exit(1);
  }
  
  if (!governanceKey) {
    console.error('❌ Missing GOVERNANCE_KEY environment variable');
    process.exit(1);
  }
  
  if (!inboundTopic) {
    console.error('❌ Missing GOVERNANCE_INBOUND_TOPIC_ID environment variable');
    process.exit(1);
  }
  
  if (!outboundTopic) {
    console.error('❌ Missing GOVERNANCE_OUTBOUND_TOPIC_ID environment variable');
    process.exit(1);
  }
  
  if (!contractId) {
    console.error('❌ Missing GOVERNANCE_CONTRACT_ID environment variable');
    process.exit(1);
  }
  
  // Use dummy rebalancer ID since we don't need it for testing
  const dummyRebalancerId = '0.0.999999';
  
  console.log('Configuration:');
  console.log(`  Governance Account: ${governanceAccountId}`);
  console.log(`  Inbound Topic: ${inboundTopic}`);
  console.log(`  Outbound Topic: ${outboundTopic}`);
  console.log(`  Contract ID: ${contractId}`);
  console.log(`  Network: testnet`);
  console.log(`  Log Level: debug`);
  console.log('');
  
  try {
    // Initialize HCS10 client using the CLI pattern
    console.log('🔗 Initializing HCS10 Client...');
    const client = new HCS10Client(
      governanceAccountId,
      governanceKey,
      'testnet',
      { 
        useEncryption: false,
        logLevel: 'debug'
      }
    );
    
    // Force the StandardSDKClient to use the correct account for inscription
    client.standardClient = client.setClient(governanceAccountId, governanceKey);
    console.log('✅ HCS10 Client initialized');
    
    // Initialize governance agent with debug logging
    console.log('🏛️  Initializing Governance Agent...');
    const agent = new GovernanceAgent({
      client,
      accountId: governanceAccountId,
      inboundTopicId: inboundTopic,
      outboundTopicId: outboundTopic,
      rebalancerAgentId: dummyRebalancerId, // Dummy value since we don't need it
      governanceContractId: contractId,
      logLevel: 'debug', // Maximum verbosity
      openAiApiKey: process.env.OPENAI_API_KEY,
      openAiModel: 'gpt-4o'
    });
    
    console.log('⚙️  Initializing agent...');
    await agent.initialize();
    console.log('✅ Governance Agent initialized');
    
    console.log('🚀 Starting governance agent...');
    await agent.start();
    console.log('✅ Governance Agent is now running locally');
    
    console.log('');
    console.log('🎯 READY FOR TESTING!');
    console.log('The governance agent is now running locally with debug logging.');
    console.log('You can now run your test scripts to send votes and see exactly what happens.');
    console.log('');
    console.log('To test contract execution:');
    console.log('  npm run lynx-agent:send-test-vote');
    console.log('');
    console.log('All contract execution attempts will be logged in detail.');
    console.log('Press Ctrl+C to stop the agent.');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down Local Governance Agent...');
      await agent.stop();
      console.log('✅ Governance Agent stopped');
      process.exit(0);
    });
    
    // Keep the process running
    setInterval(() => {
      // Heartbeat every 30 seconds
      console.log(`💓 Local Governance Agent heartbeat - ${new Date().toLocaleTimeString()}`);
    }, 30000);
    
  } catch (error) {
    console.error('💥 Failed to start Local Governance Agent:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    process.exit(1);
  }
}

// Run the local governance agent
runLocalGovernanceAgent().catch(error => {
  console.error('💥 FATAL ERROR:', error);
  process.exit(1);
}); 
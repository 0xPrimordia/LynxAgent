#!/usr/bin/env node

// Import dotenv through the project's installed version
const envFile = 'standards-agent-kit/node_modules/dotenv/lib/main.js';
try {
  // Simple check for environment variables without using dotenv
  console.log('\n=== SENTINEL CREDENTIALS ===');
  console.log(`SENTINEL_ACCOUNT_ID: ${process.env.SENTINEL_ACCOUNT_ID || '(not set)'}`);
  console.log(`SENTINEL_ACCOUNT: ${process.env.SENTINEL_ACCOUNT || '(not set)'}`);
  console.log(`SENTINEL_KEY: ${process.env.SENTINEL_KEY ? '(set)' : '(not set)'}`);
  
  // Show Sentinel topics
  console.log('\n=== SENTINEL TOPICS ===');
  console.log(`SENTINEL_INBOUND_TOPIC_ID: ${process.env.SENTINEL_INBOUND_TOPIC_ID || '(not set)'}`);
  console.log(`SENTINEL_OUTBOUND_TOPIC_ID: ${process.env.SENTINEL_OUTBOUND_TOPIC_ID || '(not set)'}`);
  console.log(`SENTINEL_PROFILE_TOPIC_ID: ${process.env.SENTINEL_PROFILE_TOPIC_ID || '(not set)'}`);
  
  // Show other agent env vars
  console.log('\n=== AGENT TOPICS ===');
  console.log(`AGENT_INBOUND_TOPIC_ID: ${process.env.AGENT_INBOUND_TOPIC_ID || '(not set)'}`);
  console.log(`AGENT_OUTBOUND_TOPIC_ID: ${process.env.AGENT_OUTBOUND_TOPIC_ID || '(not set)'}`);
  
  // Show network settings
  console.log('\n=== NETWORK SETTINGS ===');
  console.log(`HEDERA_NETWORK: ${process.env.HEDERA_NETWORK || '(not set)'}`);
  console.log(`REBALANCER_AGENT_ID: ${process.env.REBALANCER_AGENT_ID || '(not set)'}`);
} catch (error) {
  console.error('Error:', error);
} 
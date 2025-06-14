import { config } from 'dotenv';
import { HCS10Client } from '../../../src/hcs10/HCS10Client';
import { SendMessageTool, InitiateConnectionTool, ListConnectionsTool } from '../../../src/tools';
import { OpenConvaiState } from '../../../src/state/open-convai-state';
import { Logger } from '@hashgraphonline/standards-sdk';

// Load environment variables
config();

// Validate required environment variables
const requiredEnvVars = [
  'HEDERA_OPERATOR_ID',
  'HEDERA_OPERATOR_KEY',
  'HEDERA_NETWORK'
  // TARGET_AGENT_ID is now optional and will default to self for testing
  // No longer requiring AGENT_INBOUND_TOPIC_ID and AGENT_OUTBOUND_TOPIC_ID
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: Missing required environment variable ${envVar}`);
    process.exit(1);
  }
}

// Logger for better output
const logger = new Logger({
  module: 'ConnectionTester',
  level: 'info',
  prettyPrint: true,
});

/**
 * Tests the connection topic approach by following these steps:
 * 1. Initialize the client and state manager
 * 2. Establish a connection to the target agent
 * 3. Verify we can send messages through the connection topic
 * 4. Listen for responses on the connection topic
 */
async function testConnectionTopicApproach() {
  logger.info('=== CONNECTION TOPIC APPROACH TEST ===');
  
  try {
    // Step 1: Initialize the client and state manager
    logger.info('Step 1: Initializing client and state manager...');
    
    // Create HCS10Client
    const client = new HCS10Client(
      process.env.HEDERA_OPERATOR_ID!,
      process.env.HEDERA_OPERATOR_KEY!,
      process.env.HEDERA_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
      { useEncryption: false, logLevel: 'info' }
    );
    
    // Get this agent's ID to use as default target (self-connection for testing)
    const myAccountId = client.getAccountAndSigner().accountId;
    
    // Get target agent ID - default to self if not provided (for testing)
    let targetAgentId = process.env.TARGET_AGENT_ID;
    if (!targetAgentId) {
      targetAgentId = myAccountId;
      logger.info(`No TARGET_AGENT_ID provided in environment variables. Using own ID (${targetAgentId}) for testing.`);
    }
    
    // Discover inbound topic ID from profile
    logger.info(`Discovering inbound topic from HCS-11 profile...`);
    let inboundTopicId = '';
    try {
      inboundTopicId = await client.getInboundTopicId();
      logger.info(`Discovered inbound topic from profile: ${inboundTopicId}`);
    } catch (error) {
      logger.warn(`Could not discover inbound topic: ${error}`);
      // Use environment variable as fallback if available
      if (process.env.AGENT_INBOUND_TOPIC_ID) {
        inboundTopicId = process.env.AGENT_INBOUND_TOPIC_ID;
        logger.info(`Using AGENT_INBOUND_TOPIC_ID from environment: ${inboundTopicId}`);
      } else {
        logger.warn('No inbound topic ID available. Some functionality may not work.');
      }
    }
    
    // Initialize state manager
    const stateManager = new OpenConvaiState();
    
    // Set current agent (essential for ConnectionsManager to work properly)
    stateManager.setCurrentAgent({
      name: 'Connection Tester',
      accountId: myAccountId,
      inboundTopicId: inboundTopicId,
      outboundTopicId: process.env.AGENT_OUTBOUND_TOPIC_ID || '',
      profileTopicId: '',
      privateKey: process.env.HEDERA_OPERATOR_KEY!,
    });
    
    // CRITICAL: Initialize ConnectionsManager properly using the standardClient
    const connectionsManager = stateManager.initializeConnectionsManager(client.standardClient);
    if (!connectionsManager) {
      throw new Error('Failed to initialize connections manager');
    }
    
    logger.info(`ConnectionsManager initialized`);
    
    // Initialize tools
    const initiateConnectionTool = new InitiateConnectionTool({
      hcsClient: client,
      stateManager
    });
    
    const sendMessageTool = new SendMessageTool(client);
    
    const listConnectionsTool = new ListConnectionsTool({
      stateManager,
      hcsClient: client
    });
    
    logger.info('Client and tools initialized successfully.');
    logger.info(`Using account: ${myAccountId}`);
    
    // Step 2: Establish connection to target agent
    logger.info(`Step 2: Establishing connection to target agent: ${targetAgentId}...`);
    
    // Check for existing connections first
    const existingConnections = stateManager.listConnections();
    logger.info(`Found ${existingConnections.length} existing connections.`);
    
    for (const conn of existingConnections) {
      logger.info(`- Connection with ${conn.targetAccountId} via topic ${conn.connectionTopicId} (status: ${conn.status})`);
    }
    
    let activeConnection = existingConnections.find(
      conn => conn.targetAccountId === targetAgentId && conn.status === 'established'
    );
    
    if (activeConnection) {
      logger.info(`Found existing established connection with topic: ${activeConnection.connectionTopicId}`);
    } else {
      // Establish a new connection
      logger.info('No existing connection found. Establishing new connection...');
      
      const connectionResult = await initiateConnectionTool.invoke({
        targetAccountId: targetAgentId
      });
      
      logger.info(`Connection result: ${connectionResult}`);
      
      // Check if connection was established
      const updatedConnections = stateManager.listConnections();
      logger.info(`After connection attempt, found ${updatedConnections.length} connections in state manager`);
      
      for (const conn of updatedConnections) {
        logger.info(`- Connection with ${conn.targetAccountId} via topic ${conn.connectionTopicId} (status: ${conn.status})`);
      }
      
      activeConnection = updatedConnections.find(
        conn => conn.targetAccountId === targetAgentId && conn.status === 'established'
      );
      
      if (!activeConnection) {
        throw new Error('Failed to establish connection with target agent');
      }
      
      logger.info(`Successfully established connection with topic: ${activeConnection.connectionTopicId}`);
    }
    
    // Step 3: Send test message through connection topic
    logger.info(`Step 3: Sending test message through connection topic: ${activeConnection.connectionTopicId}...`);
    
    const testMessage = `Connection test message: ${new Date().toISOString()}`;
    const sequenceNumber = await sendMessageTool.invoke({
      topicId: activeConnection.connectionTopicId,
      message: testMessage
    });
    
    logger.info(`Message sent successfully with sequence number: ${sequenceNumber}`);
    
    // Step 4: Listen for responses
    logger.info('Step 4: Listening for responses on the connection topic...');
    logger.info('This test will listen for 30 seconds for any messages...');
    
    // Get initial messages on the topic
    const initialMessages = await client.getMessageStream(activeConnection.connectionTopicId);
    const initialCount = initialMessages.messages.length;
    logger.info(`Initially found ${initialCount} messages on topic ${activeConnection.connectionTopicId}`);
    
    // Display all existing messages for debugging
    if (initialCount > 0) {
      logger.info('Existing messages:');
      for (const msg of initialMessages.messages) {
        logger.info(`- Message #${msg.sequence_number} from ${msg.operator_id}: ${msg.data?.substring(0, 100)}${msg.data && msg.data.length > 100 ? '...' : ''}`);
      }
    }
    
    // Track last sequence number
    let lastSequenceNumber = initialMessages.messages.length > 0 ? 
      Math.max(...initialMessages.messages.map(m => m.sequence_number || 0)) : 0;
    
    // Listen for 30 seconds
    const endTime = Date.now() + 30000;
    let newMessagesFound = false;
    
    while (Date.now() < endTime) {
      // Wait for 5 seconds between checks
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        // Check for new messages
        const messages = await client.getMessageStream(activeConnection.connectionTopicId);
        
        // Filter for messages newer than the last one we saw
        const newMessages = messages.messages.filter(
          m => (m.sequence_number || 0) > lastSequenceNumber
        );
        
        if (newMessages.length > 0) {
          newMessagesFound = true;
          
          // Display new messages
          logger.info(`Received ${newMessages.length} new messages!`);
          
          for (const msg of newMessages) {
            logger.info(`Message #${msg.sequence_number} from ${msg.operator_id}: ${msg.data?.substring(0, 100)}${msg.data && msg.data.length > 100 ? '...' : ''}`);
            
            // Update last sequence number
            if (msg.sequence_number && msg.sequence_number > lastSequenceNumber) {
              lastSequenceNumber = msg.sequence_number;
            }
          }
        } else {
          logger.info('No new messages found yet...');
        }
      } catch (error) {
        logger.error(`Error checking for messages: ${error}`);
      }
    }
    
    // Test summary
    logger.info('==== CONNECTION TEST SUMMARY ====');
    logger.info(`Target Agent: ${targetAgentId}`);
    logger.info(`Connection Topic: ${activeConnection.connectionTopicId}`);
    logger.info(`Messages Received: ${newMessagesFound ? 'YES' : 'NO'}`);
    logger.info(`Test Result: ${newMessagesFound ? 'SUCCESS' : 'PARTIAL - message sent but no response received'}`);
    logger.info('===============================');
    
  } catch (error) {
    logger.error(`Test failed with error: ${error}`);
    process.exit(1);
  }
}

// Run the test
testConnectionTopicApproach().catch(error => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
}); 
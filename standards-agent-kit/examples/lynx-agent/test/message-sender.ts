import { config } from 'dotenv';
import { HCS10Client } from '../../../src/hcs10/HCS10Client';
import { 
  SendMessageTool, 
  InitiateConnectionTool, 
  SendMessageToConnectionTool,
  ListConnectionsTool
} from '../../../src/tools';
import * as readline from 'readline';
import { OpenConvaiState } from '../../../src/state/open-convai-state';
import { IStateManager, ActiveConnection } from '../../../src/state/state-types';
import { Logger } from '@hashgraphonline/standards-sdk';

// Load environment variables
config();

// Create readline interface for interactive usage
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Validate required environment variables
const requiredEnvVars = [
  'TEST_ACCOUNT',
  'TEST_KEY',
  'HEDERA_NETWORK'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: Missing required environment variable ${envVar}`);
    process.exit(1);
  }
}

// Validate network type
const networkType = process.env.HEDERA_NETWORK;
let validNetworkType: 'testnet' | 'mainnet' = 'testnet';

if (networkType === 'mainnet') {
  validNetworkType = 'mainnet';
} else if (networkType !== 'testnet') {
  console.warn(`Warning: Unsupported network type "${networkType}", defaulting to "testnet"`);
}

let client: HCS10Client;
let stateManager: OpenConvaiState;
let initiateConnectionTool: InitiateConnectionTool;
let sendMessageToConnectionTool: SendMessageToConnectionTool;
let listConnectionsTool: ListConnectionsTool;
let activeConnection: ActiveConnection | null = null;
let sendMessageTool: SendMessageTool;
let logger: Logger;

// Track seen messages to avoid showing duplicates
let processedMessages = new Set<string>();
// Interval for checking messages
let messageCheckInterval: NodeJS.Timeout | null = null;
// Last sequence number seen for the connection
let lastSequenceNumber = 0;

async function initializeClient() {
  console.log('Initializing HCS10 client and tools...');
  
  // Create a logger
  logger = new Logger({
    module: 'LynxMessageSender',
    level: 'info',
    prettyPrint: true,
  });
  
  // Initialize the client with TEST_ACCOUNT and TEST_KEY
  client = new HCS10Client(
    process.env.TEST_ACCOUNT!,
    process.env.TEST_KEY!,
    validNetworkType,
    { 
      useEncryption: false,
      logLevel: 'info'
    }
  );
  
  // Discover inbound topic ID from profile
  console.log('Discovering inbound topic from HCS-11 profile...');
  let inboundTopicId = '';
  try {
    inboundTopicId = await client.getInboundTopicId();
    console.log(`Discovered inbound topic from profile: ${inboundTopicId}`);
  } catch (error) {
    console.warn(`Could not discover inbound topic: ${error}`);
    // Use environment variable as fallback if available
    if (process.env.AGENT_INBOUND_TOPIC_ID) {
      inboundTopicId = process.env.AGENT_INBOUND_TOPIC_ID;
      console.log(`Using AGENT_INBOUND_TOPIC_ID from environment: ${inboundTopicId}`);
    } else {
      console.warn('No inbound topic ID available. Some functionality may not work.');
    }
  }
  
  // Initialize state manager
  stateManager = new OpenConvaiState();
  
  // Set the current agent info in state manager with test account
  stateManager.setCurrentAgent({
    name: 'Test Message Sender',
    accountId: process.env.TEST_ACCOUNT!,
    inboundTopicId: inboundTopicId,
    outboundTopicId: process.env.AGENT_OUTBOUND_TOPIC_ID || '',
    profileTopicId: '',
    privateKey: process.env.TEST_KEY!,
  });
  
  // CRITICAL: Initialize ConnectionsManager with the standard client
  // This needs to happen before creating any tools
  const connectionsManager = stateManager.initializeConnectionsManager(client.standardClient);
  if (!connectionsManager) {
    console.error('Failed to initialize connections manager');
    process.exit(1);
  }
  
  console.log(`ConnectionsManager initialized successfully`);
  
  // Initialize Tools
  initiateConnectionTool = new InitiateConnectionTool({
    hcsClient: client,
    stateManager
  });
  
  sendMessageToConnectionTool = new SendMessageToConnectionTool({
    hcsClient: client,
    stateManager
  });
  
  listConnectionsTool = new ListConnectionsTool({
    stateManager,
    hcsClient: client
  });
  
  // Initialize SendMessageTool with client
  sendMessageTool = new SendMessageTool(client);

  console.log('Client and tools initialized.');
  console.log(`Connected with account: ${client.getAccountAndSigner().accountId}`);
}

async function establishConnection(targetAccountId: string): Promise<boolean> {
  try {
    console.log(`\nEstablishing connection with agent ${targetAccountId}...`);
    
    // Check if we already have a connection
    const connections = stateManager.listConnections();
    console.log(`Found ${connections.length} existing connections in state manager`);
    
    // Log all connections for debugging
    if (connections.length > 0) {
      console.log('Existing connections:');
      for (const conn of connections) {
        console.log(`- Target: ${conn.targetAccountId}, Status: ${conn.status}, Topic: ${conn.connectionTopicId}`);
      }
    }
    
    // Find an existing connection to the target
    const existingConnection = connections.find(c => 
      c.targetAccountId === targetAccountId && c.status === 'established'
    );
    
    if (existingConnection) {
      console.log(`\n✅ Connection already established with ${targetAccountId}`);
      console.log(`Connection status: ${existingConnection.status}`);
      activeConnection = existingConnection;
      
      // Verify the connection topic is valid
      if (!existingConnection.connectionTopicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)) {
        console.error(`Warning: Connection has invalid topic ID format: ${existingConnection.connectionTopicId}`);
      }
      
      // Start message listener for this connection
      startMessageListener(existingConnection.connectionTopicId);
      
      return true;
    }
    
    // Initiate a new connection
    console.log(`\nNo existing connection found. Initiating a new connection...`);
    
    // Use InitiateConnectionTool to establish connection properly
    const result = await initiateConnectionTool.invoke({ targetAccountId });
    
    if (result.includes('Successfully established connection') || result.includes('Connection confirmed')) {
      console.log(`\n✅ ${result}`);
      
      // Wait a moment for the connection to be fully registered
      console.log('Waiting for connection to be fully registered...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get the new connections after establishment
      const updatedConnections = stateManager.listConnections();
      console.log(`After connection attempt, found ${updatedConnections.length} connections in state manager`);
      
      // Log all connections for debugging
      if (updatedConnections.length > 0) {
        console.log('Active connections:');
        for (const conn of updatedConnections) {
          console.log(`- Target: ${conn.targetAccountId}, Status: ${conn.status}, Topic: ${conn.connectionTopicId}`);
        }
      }
      
      // Get the new connection
      activeConnection = updatedConnections.find(c => 
        c.targetAccountId === targetAccountId && c.status === 'established'
      ) || null;
      
      if (activeConnection) {
        console.log(`Active connection established successfully`);
        console.log(`Connection status: ${activeConnection.status}`);
        
        // Verify the connection topic is valid
        if (!activeConnection.connectionTopicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)) {
          console.error(`Warning: Connection has invalid topic ID format: ${activeConnection.connectionTopicId}`);
        }
        
        // Start message listener for this connection
        startMessageListener(activeConnection.connectionTopicId);
        
        // Wait a bit more to ensure the Lynx Agent has had time to recognize the connection
        console.log('Waiting additional time to ensure connection is recognized by agent...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return true;
      } else {
        console.error('Failed to find the newly created connection in state manager');
        
        // List all connections for debugging
        console.log('All available connections:');
        updatedConnections.forEach(conn => {
          console.log(`- Target: ${conn.targetAccountId}, Status: ${conn.status}, Topic: ${conn.connectionTopicId}`);
        });
      }
    } else {
      console.error(`\n❌ Failed to establish connection: ${result}`);
    }
    
    return false;
  } catch (error) {
    console.error(`Error establishing connection: ${error}`);
    return false;
  }
}

/**
 * Start listening for messages on the connection topic
 */
function startMessageListener(connectionTopicId: string) {
  // Clear any existing interval
  if (messageCheckInterval) {
    clearInterval(messageCheckInterval);
  }
  
  console.log(`\n🔍 Starting message listener for topic ${connectionTopicId}...`);
  
  // Reset tracking for this connection
  processedMessages.clear();
  lastSequenceNumber = 0;
  
  // Set up interval to check for new messages
  messageCheckInterval = setInterval(async () => {
    try {
      if (!activeConnection) {
        return;
      }
      
      const messages = await client.getMessageStream(connectionTopicId);
      
      // Get messages from the agent (not from our account)
      const agentMessages = messages.messages
        .filter(m => 
          m.op === 'message' && 
          m.operator_id && 
          !m.operator_id.includes(process.env.TEST_ACCOUNT!) &&
          m.sequence_number && 
          m.sequence_number > lastSequenceNumber
        )
        .sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
      
      // Process any new messages
      for (const msg of agentMessages) {
        // Create a unique ID for the message
        const msgId = `${connectionTopicId}-${msg.sequence_number}`;
        
        // Skip if we've already processed this message
        if (processedMessages.has(msgId)) {
          continue;
        }
        
        // Track the highest sequence number we've seen
        if (msg.sequence_number && msg.sequence_number > lastSequenceNumber) {
          lastSequenceNumber = msg.sequence_number;
        }
        
        // Add to processed messages set
        processedMessages.add(msgId);
        
        // Check if this is an HCS-1 large message reference
        let displayContent = msg.data || '';
        try {
          // If it's an HCS-1 reference, resolve it
          if (typeof displayContent === 'string' && displayContent.startsWith('hcs://1/')) {
            console.log(`\n💬 [AGENT] #${msg.sequence_number}: [Resolving large message...]`);
            
            try {
              // Resolve the content using the client
              displayContent = await client.getMessageContent(displayContent);
              console.log(`Successfully resolved large message (${displayContent.length} chars)`);
            } catch (resolveError) {
              console.error(`Error resolving large message: ${resolveError}`);
              displayContent = `[Error: Could not retrieve large message content - ${displayContent}]`;
            }
          }
        } catch (error) {
          console.error(`Error processing message content: ${error}`);
        }
        
        // Display the message in a chat-like format
        console.log(`\n💬 [AGENT] #${msg.sequence_number}: ${displayContent}`);
        
        // If we're in the readline question, print the prompt again to avoid UI confusion
        if (rl.line !== '') {
          rl.prompt(true);
        }
      }
    } catch (error) {
      // Ignore occasional errors in the background poller
    }
  }, 2000); // Check every 2 seconds
}

// Helper to determine if something looks like JSON
function looksLikeJson(str: string): boolean {
  if (typeof str !== 'string') return false;
  str = str.trim();
  return (str.startsWith('{') && str.endsWith('}')) || 
         (str.startsWith('[') && str.endsWith(']'));
}

async function sendMessageViaConnection(message: string): Promise<boolean> {
  if (!activeConnection) {
    console.error('No active connection to send message through');
    return false;
  }
  
  try {
    console.log(`\nSending message to ${activeConnection.targetAgentName || activeConnection.targetAccountId}...`);
    
    // Verify the connection is in a valid state
    if (activeConnection.status !== 'established') {
      console.error(`Connection is not in 'established' state (current: ${activeConnection.status})`);
      return false;
    }
    
    // Check if this is a large message (>1000 characters)
    const isLargeMessage = message.length > 1000;
    if (isLargeMessage) {
      console.log(`Message is large (${message.length} chars), will be stored via HCS-1...`);
    }
    
    // Send message using the SendMessageToConnectionTool with just the account ID
    try {
      const result = await sendMessageToConnectionTool.invoke({
        targetIdentifier: activeConnection.targetAccountId,
        message: message,
        forceHCS1: isLargeMessage // Force HCS-1 storage for large messages
      });
      
      if (isLargeMessage) {
        // For large messages, check if the result contains an HCS-1 reference
        if (result.includes('hcs://1/')) {
          // Extract the HCS-1 reference from the result
          const match = result.match(/hcs:\/\/1\/[0-9]+\.[0-9]+\.[0-9]+/);
          if (match) {
            console.log(`\n✅ Large message stored successfully as ${match[0]}`);
          } else {
            console.log(`\n✅ ${result}`);
          }
        } else {
          console.log(`\n✅ ${result}`);
        }
      } else {
        console.log(`\n✅ ${result}`);
      }
      
      return true;
    } catch (toolError) {
      console.error(`Error with SendMessageToConnectionTool: ${toolError}`);
      console.error(`Cannot send message - make sure your connection is properly established.`);
      
      // If this was a large message error, suggest fallback options
      if (isLargeMessage) {
        console.log('\nFor large messages, you might want to try:');
        console.log('1. Breaking your message into smaller parts (under 1000 characters)');
        console.log('2. Ensuring the system has properly set up inscription timeouts');
        console.log('3. Setting environment variables like INSCRIPTION_TIMEOUT_MS to higher values');
      }
      
      return false;
    }
  } catch (error) {
    console.error(`Error sending message: ${error}`);
    
    // Try to diagnose the issue
    console.log('\nDiagnosing connection issue:');
    try {
      // Check if we can find the connection in state
      const connections = stateManager.listConnections();
      const foundInState = connections.find(c => 
        activeConnection && c.targetAccountId === activeConnection.targetAccountId
      );
      if (foundInState) {
        console.log(`✓ Connection found in state manager with status: ${foundInState.status}`);
      } else {
        console.error(`✗ Connection to ${activeConnection.targetAccountId} NOT found in state manager!`);
      }
    } catch (diagError) {
      console.error(`✗ Error diagnosing connection issue: ${diagError}`);
    }
    
    return false;
  }
}

async function interactiveMode() {
  try {
    console.log('\n===== Lynx Agent Message Sender =====');
    console.log('This tool allows you to send messages to a Lynx Agent\n');
    
    // Use the Lynx Agent's account ID as the target
    const targetAgentId = process.env.HEDERA_OPERATOR_ID!;
    console.log(`\nConnecting to Lynx Agent with ID: ${targetAgentId}`);
    
    // Establish connection
    const connectionSuccessful = await establishConnection(targetAgentId);
    
    if (!connectionSuccessful) {
      console.error('Failed to establish connection. Exiting...');
      rl.close();
      return;
    }
    
    console.log(`\n✅ Ready to send messages to ${targetAgentId}`);
    console.log(`Connection managed by ConnectionsManager - no need to specify topics manually`);
    console.log(`\n📱 CHAT STARTED - Agent responses will appear automatically`);
    
    // Enter message sending loop
    const askForMessage = function() {
      rl.question('\n💬 [YOU]: ', async (message) => {
        if (message.toLowerCase() === 'exit') {
          console.log('Exiting message sender...');
          // Clean up message listener interval
          if (messageCheckInterval) {
            clearInterval(messageCheckInterval);
          }
          rl.close();
          return;
        }
        
        if (message.toLowerCase() === 'status') {
          // Show connection status
          const connections = stateManager.listConnections();
          console.log('\nCurrent connections:');
          for (const conn of connections) {
            console.log(`- ${conn.targetAccountId}: Status: ${conn.status}`);
          }
          askForMessage();
          return;
        }
        
        if (message.toLowerCase() === 'messages') {
          // Show recent messages on the connection topic
          if (activeConnection) {
            try {
              const messages = await client.getMessageStream(activeConnection.connectionTopicId);
              console.log(`\nRecent messages on topic ${activeConnection.connectionTopicId}:`);
              if (messages.messages.length > 0) {
                // Sort by sequence number
                const sortedMessages = [...messages.messages]
                  .sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
                
                // Show up to 10 most recent messages
                for (const msg of sortedMessages.slice(-10)) {
                  const isFromAgent = msg.operator_id && !msg.operator_id.includes(process.env.TEST_ACCOUNT!);
                  
                  // Check for HCS-1 references
                  let displayContent = msg.data || '';
                  if (typeof displayContent === 'string' && displayContent.startsWith('hcs://1/')) {
                    try {
                      console.log(`- #${msg.sequence_number} from ${isFromAgent ? 'AGENT' : 'YOU'}: [Resolving large message...]`);
                      displayContent = await client.getMessageContent(displayContent);
                      console.log(`  ✓ Resolved large message (${displayContent.length} chars)`);
                      
                      // Truncate for display if needed
                      const displayText = displayContent.substring(0, 200) + (displayContent.length > 200 ? '...' : '');
                      console.log(`- #${msg.sequence_number} from ${isFromAgent ? 'AGENT' : 'YOU'}: ${displayText}`);
                    } catch (resolveError) {
                      console.error(`  ✗ Error resolving large message: ${resolveError}`);
                      console.log(`- #${msg.sequence_number} from ${isFromAgent ? 'AGENT' : 'YOU'}: [Could not retrieve large message: ${displayContent}]`);
                    }
                  } else {
                    // Normal message display (not an HCS-1 reference)
                    console.log(`- #${msg.sequence_number} from ${isFromAgent ? 'AGENT' : 'YOU'}: ${displayContent.substring(0, 200)}${displayContent.length > 200 ? '...' : ''}`);
                  }
                }
              } else {
                console.log('No messages found on this connection.');
              }
            } catch (error) {
              console.error(`Error fetching messages: ${error}`);
            }
          } else {
            console.log('No active connection to check messages on.');
          }
          askForMessage();
          return;
        }
        
        if (message.toLowerCase() === 'help') {
          console.log('\n📋 Available commands:');
          console.log('- exit: Exit the message sender');
          console.log('- status: Show current connection status');
          console.log('- messages: Show recent message history');
          console.log('- help: Show this help message');
          console.log('\nOr just type your message to send it to the agent');
          
          console.log('\n📝 Large Message Handling:');
          console.log('- Messages over 1000 characters will automatically use HCS-1 storage');
          console.log('- The system will show references like "hcs://1/0.0.12345" for stored content');
          console.log('- These references are automatically resolved when viewing messages');
          console.log('- If you encounter timeout errors with large messages, try:');
          console.log('  * Setting INSCRIPTION_TIMEOUT_MS=60000 in your environment');
          console.log('  * Setting INSCRIPTION_MAX_RETRIES=40 in your environment');
          console.log('  * Breaking your message into smaller chunks');
          
          askForMessage();
          return;
        }
        
        if (message.trim() === '') {
          console.log('Message cannot be empty. Please try again.');
          askForMessage();
          return;
        }
        
        // Send the message
        const success = await sendMessageViaConnection(message);
        
        if (success) {
          // After sending a message, check connection status
          const updatedConnections = stateManager.listConnections();
          const currentConnection = updatedConnections.find(c => 
            c.targetAccountId === targetAgentId && c.status === 'established'
          );
          
          if (currentConnection && currentConnection !== activeConnection) {
            console.log(`Note: Connection status updated`);
            activeConnection = currentConnection;
          }
        } else {
          console.error('\nFailed to send message. You may need to re-establish the connection.');
          
          // Try to re-establish connection
          console.log('Attempting to re-establish connection...');
          const reconnected = await establishConnection(targetAgentId);
          if (reconnected) {
            console.log('Connection re-established successfully.');
          } else {
            console.error('Could not re-establish connection.');
          }
        }
        
        // Ask for next message
        askForMessage();
      });
    };
    
    // Start the message loop
    askForMessage();
    
  } catch (error) {
    console.error(`Error in interactive mode: ${error}`);
    rl.close();
  }
}

// Main function
async function main() {
  try {
    await initializeClient();
    await interactiveMode();
  } catch (error) {
    console.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

// Clean up on exit
process.on('SIGINT', () => {
  console.log('\nExiting message sender...');
  if (messageCheckInterval) {
    clearInterval(messageCheckInterval);
  }
  process.exit(0);
});

// Run the main function
main(); 
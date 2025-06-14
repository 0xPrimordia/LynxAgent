import { config } from 'dotenv';
import { HCS10Client } from '../../../src/hcs10/HCS10Client';
import * as readline from 'readline';

// Load environment variables
config();

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Validate required environment variables
const requiredEnvVars = [
  'HEDERA_OPERATOR_ID',
  'HEDERA_OPERATOR_KEY',
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

console.log('Response Listener for Lynx Agent');
console.log('--------------------------------');

let client: HCS10Client;
let isListening = false;
let lastProcessedSequence: { [topicId: string]: number } = {};
let intervalId: NodeJS.Timeout | null = null;

async function initializeClient() {
  console.log('Initializing HCS10 client...');
  client = new HCS10Client(
    process.env.HEDERA_OPERATOR_ID!,
    process.env.HEDERA_OPERATOR_KEY!,
    validNetworkType,
    { useEncryption: false }
  );

  console.log(`Connected with account: ${client.getAccountAndSigner().accountId}`);
}

async function startListening(topicId: string, intervalMs = 5000) {
  if (isListening) {
    console.log('Already listening. Stop the current listener first.');
    return;
  }

  console.log(`Starting to listen on topic ${topicId}...`);
  isListening = true;

  // Get current messages to determine the latest sequence number
  try {
    const currentMessages = await client.getMessages(topicId);
    
    if (currentMessages.messages.length > 0) {
      // Find the maximum sequence number
      const maxSequence = Math.max(
        ...currentMessages.messages
          .map(msg => msg.sequence_number || 0)
      );
      
      lastProcessedSequence[topicId] = maxSequence;
      console.log(`Found ${currentMessages.messages.length} existing messages. Will only show new messages (after sequence #${maxSequence}).`);
    } else {
      lastProcessedSequence[topicId] = 0;
      console.log('No existing messages found. Will show all new messages.');
    }
  } catch (error) {
    console.error('Error getting current messages:', error);
    lastProcessedSequence[topicId] = 0;
  }

  // Start polling
  intervalId = setInterval(async () => {
    if (!isListening) {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      return;
    }

    try {
      const messages = await client.getMessages(topicId);
      
      // Filter for new messages
      const newMessages = messages.messages.filter(msg => 
        msg.sequence_number !== undefined && 
        msg.sequence_number > (lastProcessedSequence[topicId] || 0)
      );
      
      if (newMessages.length > 0) {
        console.log(`\n--- ${new Date().toLocaleTimeString()} - Received ${newMessages.length} new message(s) ---`);
        
        for (const message of newMessages) {
          console.log(`\nMessage [Sequence #${message.sequence_number}]:`);
          console.log('-'.repeat(50));
          
          try {
            let content = message.data || '';
            
            // If it's an HCS inscription link, resolve it
            if (typeof content === 'string' && content.startsWith('hcs://')) {
              console.log('Resolving inscribed content...');
              content = await client.getMessageContent(content);
            }
            
            // Try to parse as JSON
            try {
              const parsedContent = JSON.parse(content as string);
              console.log(JSON.stringify(parsedContent, null, 2));
            } catch {
              // Not JSON, display as is
              console.log(content);
            }
          } catch (error) {
            console.error('Error processing message:', error);
          }
          
          console.log('-'.repeat(50));
          
          // Update last processed sequence
          if (message.sequence_number !== undefined) {
            lastProcessedSequence[topicId] = Math.max(
              lastProcessedSequence[topicId] || 0,
              message.sequence_number
            );
          }
        }
      } else {
        process.stdout.write('.');
      }
    } catch (error) {
      console.error('\nError polling for messages:', error);
    }
  }, intervalMs);
  
  console.log(`Listening for new messages on topic ${topicId}. Press Ctrl+C to stop.`);
}

function stopListening() {
  if (!isListening) {
    console.log('Not currently listening.');
    return;
  }
  
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  
  isListening = false;
  console.log('Stopped listening.');
}

async function run() {
  try {
    await initializeClient();
    
    rl.question('Enter the topic ID to listen on: ', async (topicId) => {
      if (!topicId) {
        console.error('Topic ID is required.');
        rl.close();
        return;
      }
      
      await startListening(topicId);
      
      // Set up command handling
      console.log('\nCommands: stop, start, exit');
      
      rl.on('line', async (line) => {
        const command = line.trim().toLowerCase();
        
        switch (command) {
          case 'stop':
            stopListening();
            break;
          case 'start':
            if (!isListening) {
              await startListening(topicId);
            } else {
              console.log('Already listening.');
            }
            break;
          case 'exit':
            stopListening();
            console.log('Exiting...');
            rl.close();
            break;
          default:
            console.log('Unknown command. Available commands: stop, start, exit');
        }
      });
    });
    
    // Handle CTRL+C
    rl.on('SIGINT', () => {
      stopListening();
      console.log('\nExiting...');
      rl.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Error:', error);
    rl.close();
    process.exit(1);
  }
}

// Start the application
run().catch(console.error); 
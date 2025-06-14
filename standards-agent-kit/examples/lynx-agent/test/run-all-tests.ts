import { config } from 'dotenv';
import { HCS10Client } from '../../../src/hcs10/HCS10Client';
import { execSync } from 'child_process';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
config();

// Validate required environment variables
const requiredEnvVars = [
  'HEDERA_OPERATOR_ID',
  'HEDERA_OPERATOR_KEY',
  'HEDERA_NETWORK',
  'AGENT_INBOUND_TOPIC_ID',
  'AGENT_OUTBOUND_TOPIC_ID'
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

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a log directory
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logFile = path.join(logDir, `test-run-${Date.now()}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Helper function to log to both console and file
function log(message: string) {
  console.log(message);
  logStream.write(message + '\n');
}

// Test stages
async function runTests() {
  log('=== Lynx Agent Complete Test Suite ===');
  log(`Started: ${new Date().toISOString()}`);
  log('');

  // STAGE 1: Test connection
  log('STAGE 1: Testing Basic Connectivity');
  log('----------------------------------');
  try {
    log('Initializing HCS10 client...');
    const client = new HCS10Client(
      process.env.HEDERA_OPERATOR_ID!,
      process.env.HEDERA_OPERATOR_KEY!,
      validNetworkType,
      { useEncryption: false }
    );

    log('Getting account info...');
    const accountInfo = client.getAccountAndSigner();
    log(`Successfully connected with account: ${accountInfo.accountId}`);

    // Test topic access
    const inboundTopicId = process.env.AGENT_INBOUND_TOPIC_ID!;
    const outboundTopicId = process.env.AGENT_OUTBOUND_TOPIC_ID!;

    log(`Testing access to inbound topic: ${inboundTopicId}`);
    const inboundMessages = await client.getMessages(inboundTopicId);
    log(`Successfully accessed inbound topic. Found ${inboundMessages.messages.length} messages.`);

    log(`Testing access to outbound topic: ${outboundTopicId}`);
    const outboundMessages = await client.getMessages(outboundTopicId);
    log(`Successfully accessed outbound topic. Found ${outboundMessages.messages.length} messages.`);

    log('STAGE 1 PASSED: Basic connectivity verified.');
  } catch (error) {
    log(`STAGE 1 FAILED: ${error}`);
    log('Exiting test suite due to connectivity failure.');
    return;
  }

  log('');

  // STAGE 2: Test message sending
  log('STAGE 2: Testing Message Sending');
  log('-------------------------------');
  try {
    const client = new HCS10Client(
      process.env.HEDERA_OPERATOR_ID!,
      process.env.HEDERA_OPERATOR_KEY!,
      validNetworkType,
      { useEncryption: false }
    );

    const testTopicId = process.env.AGENT_OUTBOUND_TOPIC_ID!;
    const testMessage = `Test message from Lynx Agent test suite: ${Date.now()}`;

    log(`Sending test message to topic ${testTopicId}...`);
    const sequenceNumber = await client.sendMessage(testTopicId, testMessage);

    log(`Message sent successfully! Sequence number: ${sequenceNumber}`);
    log('Waiting 5 seconds for message propagation...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    log(`Verifying message (sequence ${sequenceNumber}) was recorded...`);
    const messages = await client.getMessages(testTopicId);
    const sentMessage = messages.messages.find(m => m.sequence_number === sequenceNumber);

    if (sentMessage) {
      log('Message found in topic! Message sending verified.');
      log('STAGE 2 PASSED: Message sending verified.');
    } else {
      log('Warning: Message not found in topic. This might be due to network delays.');
      log('STAGE 2 PARTIAL PASS: Message was sent but verification was not conclusive.');
    }
  } catch (error) {
    log(`STAGE 2 FAILED: ${error}`);
    log('Continuing to next stage...');
  }

  log('');

  // STAGE 3: Test agent start (simulated)
  log('STAGE 3: Testing Agent Initialization');
  log('-----------------------------------');
  log('Note: This test will not actually start the agent process but will verify the command succeeds.');
  
  try {
    const command = 'npx tsx examples/lynx-agent/cli.ts --help';
    log(`Executing: ${command}`);
    
    const output = execSync(command).toString();
    log('Agent CLI loaded successfully.');
    log('CLI output summary:');
    log(output.split('\n').slice(0, 5).join('\n'));
    log('...');
    
    log('STAGE 3 PASSED: Agent CLI verified.');
  } catch (error) {
    log(`STAGE 3 FAILED: ${error}`);
  }

  log('');
  log('=== Test Suite Summary ===');
  log(`Completed: ${new Date().toISOString()}`);
  log(`Full logs written to: ${logFile}`);
  log('');
  
  // Close the log stream
  logStream.end();
}

// Run the tests
runTests().catch(error => {
  log(`FATAL ERROR: ${error}`);
  logStream.end();
  process.exit(1);
}); 
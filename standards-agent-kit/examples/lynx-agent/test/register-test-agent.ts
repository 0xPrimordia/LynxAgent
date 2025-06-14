import { config } from 'dotenv';
import { HCS11Client, Logger, AIAgentCapability, AIAgentType } from '@hashgraphonline/standards-sdk';
import { TopicCreateTransaction, Client, PrivateKey, AccountId } from "@hashgraph/sdk";
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
config();

// Create a logger
const logger = new Logger({
  module: 'TestAgentRegistration',
  level: 'info',
  prettyPrint: true,
});

// Validate required environment variables
const requiredEnvVars = [
  'SENTINEL_ACCOUNT',
  'SENTINEL_KEY',
  'HEDERA_NETWORK'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Error: Missing required environment variable ${envVar}`);
    process.exit(1);
  }
}

// Validate network type
const networkType = process.env.HEDERA_NETWORK;
let validNetworkType: 'testnet' | 'mainnet' = 'testnet';

if (networkType === 'mainnet') {
  validNetworkType = 'mainnet';
} else if (networkType !== 'testnet') {
  logger.warn(`Warning: Unsupported network type "${networkType}", defaulting to "testnet"`);
}

/**
 * Create a Hedera consensus topic
 */
async function createTopic(client: Client): Promise<string> {
  const createTransaction = new TopicCreateTransaction();
  const createResponse = await createTransaction.execute(client);
  const receipt = await createResponse.getReceipt(client);
  const topicId = receipt.topicId;
  if (!topicId) {
    throw new Error("Failed to create topic");
  }
  return topicId.toString();
}

async function main() {
  logger.info(`=== Creating Test Agent Profile (${validNetworkType}) ===`);
  logger.info(`Account: ${process.env.SENTINEL_ACCOUNT}`);
  
  try {
    // Initialize the HCS-11 client exactly as in the documentation
    logger.info('\nInitializing HCS11 client...');
    
    const client = new HCS11Client({
      network: validNetworkType,
      auth: {
        operatorId: process.env.SENTINEL_ACCOUNT!,
        privateKey: process.env.SENTINEL_KEY!
      },
      logLevel: 'info'
    });
    
    // Create topic IDs first using the Hedera SDK directly
    logger.info('\nPre-generating topic IDs using Hedera SDK...');
    
    // Create a Hedera client
    const hederaClient = Client.forName(validNetworkType);
    hederaClient.setOperator(
      AccountId.fromString(process.env.SENTINEL_ACCOUNT!),
      PrivateKey.fromString(process.env.SENTINEL_KEY!)
    );
    
    // Create inbound and outbound topics
    const inboundTopicId = await createTopic(hederaClient);
    logger.info(`Created inbound topic: ${inboundTopicId}`);
    
    const outboundTopicId = await createTopic(hederaClient);
    logger.info(`Created outbound topic: ${outboundTopicId}`);
    
    // Create an AI agent profile with BOTH inbound and outbound topics
    logger.info('\nCreating AI agent profile with both topic IDs...');
    
    const agentProfile = client.createAIAgentProfile(
      'Test Agent', // Display name
      AIAgentType.AUTONOMOUS, // Agent type
      [AIAgentCapability.TEXT_GENERATION], // Capabilities
      'GPT-4', // Model
      {
        bio: 'A test agent for messaging with Lynx Agent',
        creator: 'LynxAgent Tester',
        // Explicitly set both inbound and outbound topics
        inboundTopicId: inboundTopicId,
        outboundTopicId: outboundTopicId
      }
    );
    
    // Inscribe the profile and link it to the account in one step
    logger.info('\nInscribing profile and linking to account...');
    
    const result = await client.createAndInscribeProfile(
      agentProfile,
      true, // Update account memo automatically
      {
        waitForConfirmation: true,
        progressCallback: (progress) => {
          logger.info(`${progress.stage}: ${progress.progressPercent}%`);
        },
      }
    );
    
    if (result.success) {
      logger.info('\n=== PROFILE CREATION RESULTS ===');
      logger.info(`Profile created and published: ${result.profileTopicId}`);
      logger.info(`Transaction ID: ${result.transactionId}`);
      
      // Save the profile topic ID and inbound/outbound topic IDs
      const profileTopicId = result.profileTopicId;
      
      if (profileTopicId) {
        logger.info('\n=== PROFILE VERIFICATION ===');
        logger.info(`Account ${process.env.SENTINEL_ACCOUNT} successfully linked to profile`);
        logger.info(`Profile Topic ID: ${profileTopicId}`);
        logger.info(`Inbound Topic ID: ${inboundTopicId}`);
        logger.info(`Outbound Topic ID: ${outboundTopicId}`);
        
        logger.info('\n=== IMPORTANT VALUES ===');
        logger.info(`Profile: ${profileTopicId}`);
        logger.info(`Inbound: ${inboundTopicId}`);
        logger.info(`Outbound: ${outboundTopicId}`);
        logger.info('\nCopy these values to use in messaging applications');
      } else {
        logger.error('Profile created but no topic ID returned');
      }
    } else {
      logger.error('\nFailed to create and inscribe profile:', result.error);
    }
  } catch (error) {
    logger.error('Error creating profile:', error);
  }
}

// Execute the main function
main().catch(console.error); 
import { config } from 'dotenv';
import { HCS10Client } from '../../../src/hcs10/HCS10Client';
import { Logger } from '@hashgraphonline/standards-sdk';
import { Client, AccountId, PrivateKey, TopicMessageQuery } from '@hashgraph/sdk';

// Load environment variables
config();

// Create a logger
const logger = new Logger({
  module: 'GovernanceTopicChecker',
  level: 'info',
  prettyPrint: true,
});

async function checkWithHCS10Client(topicId: string) {
  logger.info(`\n=== METHOD 1: Using HCS10Client ===`);
  
  try {
    // Initialize HCS10 client with governance account credentials
    const client = new HCS10Client(
      process.env.GOVERNANCE_ACCOUNT_ID || process.env.HEDERA_OPERATOR_ID!,
      process.env.GOVERNANCE_PRIVATE_KEY || process.env.HEDERA_OPERATOR_KEY!,
      'testnet',
      { 
        useEncryption: false,
        logLevel: 'info'
      }
    );
    
    logger.info('HCS10 Client initialized');
    
    // Get messages from the topic
    logger.info('Fetching messages from topic...');
    const result = await client.getMessageStream(topicId);
    
    logger.info(`Total messages retrieved: ${result.messages?.length || 0}`);
    
    return result.messages || [];
  } catch (error) {
    logger.error('Error with HCS10Client:', error);
    return [];
  }
}

async function checkWithDirectSDK(topicId: string) {
  logger.info(`\n=== METHOD 2: Using Direct Hedera SDK ===`);
  
  try {
    // Create direct Hedera client
    const client = Client.forName('testnet');
    client.setOperator(
      AccountId.fromString(process.env.GOVERNANCE_ACCOUNT_ID || process.env.HEDERA_OPERATOR_ID!),
      PrivateKey.fromString(process.env.GOVERNANCE_PRIVATE_KEY || process.env.HEDERA_OPERATOR_KEY!)
    );
    
    logger.info('Direct Hedera SDK client initialized');
    
    // Use mirror node API directly via fetch
    const mirrorUrl = `https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId}/messages`;
    logger.info(`Fetching from mirror node: ${mirrorUrl}`);
    
    const response = await fetch(mirrorUrl);
    const data = await response.json();
    
    logger.info(`Mirror node response status: ${response.status}`);
    logger.info(`Messages from mirror node: ${data.messages?.length || 0}`);
    
    if (data.messages && data.messages.length > 0) {
      logger.info('Sample message structure from mirror node:');
      const sample = data.messages[0];
      logger.info(`  consensus_timestamp: ${sample.consensus_timestamp}`);
      logger.info(`  sequence_number: ${sample.sequence_number}`);
      logger.info(`  message (base64): ${sample.message?.substring(0, 100)}...`);
      
      // Decode the message
      if (sample.message) {
        try {
          const decoded = Buffer.from(sample.message, 'base64').toString('utf-8');
          logger.info(`  decoded message: ${decoded.substring(0, 200)}...`);
        } catch (e) {
          logger.info(`  failed to decode: ${e}`);
        }
      }
    }
    
    return data.messages || [];
  } catch (error) {
    logger.error('Error with direct SDK:', error);
    return [];
  }
}

async function checkWithStandardsSDK(topicId: string) {
  logger.info(`\n=== METHOD 3: Using Standards SDK Directly ===`);
  
  try {
    const client = new HCS10Client(
      process.env.GOVERNANCE_ACCOUNT_ID || process.env.HEDERA_OPERATOR_ID!,
      process.env.GOVERNANCE_PRIVATE_KEY || process.env.HEDERA_OPERATOR_KEY!,
      'testnet',
      { 
        useEncryption: false,
        logLevel: 'info'
      }
    );
    
    // Try to use the underlying standard client directly
    const standardClient = client.standardClient;
    logger.info('Trying standardClient.getMessages...');
    
    try {
      const messages = await standardClient.getMessages(topicId);
      logger.info(`Standard SDK getMessages returned: ${messages.messages?.length || 0} messages`);
      return messages.messages || [];
    } catch (error) {
      logger.error('Error with standardClient.getMessages:', error);
      return [];
    }
  } catch (error) {
    logger.error('Error with Standards SDK:', error);
    return [];
  }
}

async function checkGovernanceTopic() {
  try {
    // Get topic ID from environment
    const topicId = process.env.GOVERNANCE_INBOUND_TOPIC_ID || '0.0.6110235';
    
    logger.info(`=== Checking Governance Topic: ${topicId} ===`);
    logger.info(`Using credentials: ${process.env.GOVERNANCE_ACCOUNT_ID || process.env.HEDERA_OPERATOR_ID}`);
    
    // Try all three methods
    const hcs10Messages = await checkWithHCS10Client(topicId);
    const directMessages = await checkWithDirectSDK(topicId);
    const standardMessages = await checkWithStandardsSDK(topicId);
    
    logger.info(`\n=== COMPARISON ===`);
    logger.info(`HCS10Client messages: ${hcs10Messages.length}`);
    logger.info(`Direct SDK messages: ${directMessages.length}`);
    logger.info(`Standards SDK messages: ${standardMessages.length}`);
    
    // Use whichever method found messages
    const messages = directMessages.length > 0 ? directMessages : 
                    standardMessages.length > 0 ? standardMessages : 
                    hcs10Messages;
    
    if (messages.length === 0) {
      logger.warn('\n❌ NO MESSAGES FOUND BY ANY METHOD!');
      logger.warn('This suggests either:');
      logger.warn('1. Messages were posted to a different topic');
      logger.warn('2. There\'s a network/timing issue');
      logger.warn('3. The transaction failed despite appearing successful');
      return;
    }
    
    logger.info(`\n=== ANALYZING ${messages.length} MESSAGES ===`);
    
    // Process messages (convert from mirror node format if needed)
    const processedMessages = messages.map((m: any) => {
      if (m.message) {
        // Mirror node format - decode base64
        try {
          const decoded = Buffer.from(m.message, 'base64').toString('utf-8');
          return {
            sequence_number: m.sequence_number,
            data: decoded,
            created: m.consensus_timestamp
          };
        } catch (e) {
          return {
            sequence_number: m.sequence_number,
            data: m.message,
            created: m.consensus_timestamp
          };
        }
      } else {
        // Already processed format
        return m;
      }
    });
    
    // Sort by sequence number
    const sortedMessages = processedMessages
      .filter((m: any) => m.sequence_number !== undefined)
      .sort((a: any, b: any) => (a.sequence_number || 0) - (b.sequence_number || 0));
    
    logger.info(`Messages sorted by sequence number:`);
    
    for (const message of sortedMessages) {
      logger.info(`\n--- Message #${message.sequence_number} ---`);
      logger.info(`Created: ${message.created || 'unknown'}`);
      logger.info(`Data type: ${typeof message.data}`);
      
      if (message.data) {
        // Log first 200 characters of message data
        const dataStr = typeof message.data === 'string' 
          ? message.data 
          : JSON.stringify(message.data);
        
        logger.info(`Data preview: ${dataStr.substring(0, 200)}${dataStr.length > 200 ? '...' : ''}`);
        
        // Try to parse as JSON if it looks like JSON
        try {
          const jsonData = typeof message.data === 'string' 
            ? JSON.parse(message.data)
            : message.data;
          
          if (jsonData.type) {
            logger.info(`Message type: ${jsonData.type}`);
            
            if (jsonData.type === 'PARAMETER_VOTE') {
              logger.info(`✅ FOUND PARAMETER_VOTE!`);
              logger.info(`  Parameter: ${jsonData.parameterPath}`);
              logger.info(`  New Value: ${jsonData.newValue}`);
              logger.info(`  Voter: ${jsonData.voterAccountId}`);
              logger.info(`  Voting Power: ${jsonData.votingPower}`);
              logger.info(`  Timestamp: ${jsonData.timestamp}`);
            }
          }
        } catch (e) {
          logger.info(`Not valid JSON: ${e}`);
        }
      } else {
        logger.info('No data in message');
      }
    }
    
    // Check specifically for PARAMETER_VOTE messages
    const voteMessages = sortedMessages.filter((m: any) => {
      try {
        const data = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
        return data?.type === 'PARAMETER_VOTE';
      } catch {
        return false;
      }
    });
    
    logger.info(`\n=== VOTE SUMMARY ===`);
    logger.info(`Total PARAMETER_VOTE messages found: ${voteMessages.length}`);
    
    if (voteMessages.length > 0) {
      logger.info('Vote messages:');
      for (const vote of voteMessages) {
        const data = typeof vote.data === 'string' ? JSON.parse(vote.data) : vote.data;
        logger.info(`  Seq #${vote.sequence_number}: ${data.parameterPath} = ${data.newValue} (by ${data.voterAccountId})`);
      }
    }
    
  } catch (error) {
    logger.error('Error checking governance topic:', error);
  }
}

// Execute the check
checkGovernanceTopic().catch(console.error); 
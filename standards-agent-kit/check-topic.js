// Utility to check topic information
import { Client, TopicInfoQuery } from "@hashgraph/sdk";
import dotenv from 'dotenv';

dotenv.config();

async function checkTopicInfo(topicId) {
  try {
    console.log(`Checking topic info for: ${topicId}`);
    
    // Create client from environment variables
    const client = Client.forName(process.env.HEDERA_NETWORK || 'testnet');
    
    // First try with operator credentials
    if (process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY) {
      console.log(`Using HEDERA_OPERATOR credentials (${process.env.HEDERA_OPERATOR_ID})`);
      client.setOperator(process.env.HEDERA_OPERATOR_ID, process.env.HEDERA_OPERATOR_KEY);
      
      try {
        const topicInfo = await new TopicInfoQuery()
          .setTopicId(topicId)
          .execute(client);
          
        console.log('Topic info retrieved with OPERATOR credentials:');
        console.log(`- Topic ID: ${topicInfo.topicId.toString()}`);
        console.log(`- Admin Key: ${topicInfo.adminKey ? topicInfo.adminKey.toString() : 'None'}`);
        console.log(`- Submit Key: ${topicInfo.submitKey ? topicInfo.submitKey.toString() : 'None'}`);
        console.log(`- Auto Renew Account: ${topicInfo.autoRenewAccountId ? topicInfo.autoRenewAccountId.toString() : 'None'}`);
        return;
      } catch (error) {
        console.error(`Error with OPERATOR credentials: ${error.message}`);
      }
    }
    
    // Try with sentinel credentials
    if (process.env.SENTINEL_ACCOUNT && process.env.SENTINEL_KEY) {
      console.log(`Using SENTINEL credentials (${process.env.SENTINEL_ACCOUNT})`);
      client.setOperator(process.env.SENTINEL_ACCOUNT, process.env.SENTINEL_KEY);
      
      try {
        const topicInfo = await new TopicInfoQuery()
          .setTopicId(topicId)
          .execute(client);
          
        console.log('Topic info retrieved with SENTINEL credentials:');
        console.log(`- Topic ID: ${topicInfo.topicId.toString()}`);
        console.log(`- Admin Key: ${topicInfo.adminKey ? topicInfo.adminKey.toString() : 'None'}`);
        console.log(`- Submit Key: ${topicInfo.submitKey ? topicInfo.submitKey.toString() : 'None'}`);
        console.log(`- Auto Renew Account: ${topicInfo.autoRenewAccountId ? topicInfo.autoRenewAccountId.toString() : 'None'}`);
        return;
      } catch (error) {
        console.error(`Error with SENTINEL credentials: ${error.message}`);
      }
    }
    
    // Without credentials, we might still get basic info
    console.log('Trying anonymous query...');
    client.setOperator(null, null);
    
    try {
      const topicInfo = await new TopicInfoQuery()
        .setTopicId(topicId)
        .execute(client);
        
      console.log('Topic info retrieved (anonymous):');
      console.log(`- Topic ID: ${topicInfo.topicId.toString()}`);
      console.log(`- Admin Key: ${topicInfo.adminKey ? topicInfo.adminKey.toString() : 'None'}`);
      console.log(`- Submit Key: ${topicInfo.submitKey ? topicInfo.submitKey.toString() : 'None'}`);
      console.log(`- Auto Renew Account: ${topicInfo.autoRenewAccountId ? topicInfo.autoRenewAccountId.toString() : 'None'}`);
    } catch (error) {
      console.error(`Error with anonymous query: ${error.message}`);
    }
    
  } catch (error) {
    console.error(`Failed to check topic: ${error.message}`);
  }
}

// Get topic ID from command line arguments or use default
const topicId = process.argv[2] || '0.0.5966031';
checkTopicInfo(topicId); 
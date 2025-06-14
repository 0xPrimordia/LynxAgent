#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';
import path from 'path';
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { LynxAgent } from './LynxAgent';
import { SentinelAgent } from './SentinelAgent';
import { PriceMonitor } from './PriceMonitor';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables - first from .env, then override with .env.local
config(); // Load .env

// Explicitly load .env.local to ensure it overrides .env
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  console.log(`Loading environment variables from ${envLocalPath}`);
  const envLocalConfig = config({ path: envLocalPath }).parsed || {};
  
  // Apply .env.local values to process.env
  for (const key in envLocalConfig) {
    process.env[key] = envLocalConfig[key];
  }
}

const program = new Command();

// Define command-line parameters
program
  .name('lynx-agent')
  .description('Lynx Agent - An AI agent using the Hedera Consensus Service')
  .version('0.1.0');

// Define the debug function outside the command block
async function debugInboundTopic(client: any, topicId: string) {
  console.log(`[DEBUG] Fetching raw messages from inbound topic ${topicId}...`);
  try {
    // Use getMessages which exists on HCS10Client
    const result = await client.getMessages(topicId);
    
    // Log total count
    console.log(`[DEBUG] Found ${result.messages?.length || 0} total messages`);
    
    // Print raw data of recent messages
    const messages = result.messages || [];
    for (let i = 0; i < Math.min(messages.length, 5); i++) {
      const msg = messages[messages.length - 1 - i];
      console.log(`[DEBUG] Message #${i+1}:`);
      console.log(`  Timestamp: ${msg.timestamp}`);
      console.log(`  Sequence: ${msg.sequence_number}`);
      console.log(`  Data: ${msg.data}`);
      try {
        // Try to parse as JSON
        if (typeof msg.data === 'string') {
          const parsed = JSON.parse(msg.data);
          console.log(`  Parsed: ${JSON.stringify(parsed, null, 2)}`);
        } else {
          console.log(`  Data is not a string: ${typeof msg.data}`);
        }
      } catch (error) {
        console.log(`  Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      console.log('---');
    }
  } catch (error) {
    console.error(`[DEBUG] Error fetching raw messages: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Command to start the agent
program
  .command('start')
  .description('Start the Lynx Agent')
  .option('-a, --account-id <accountId>', 'Hedera account ID', process.env.HEDERA_OPERATOR_ID)
  .option('-k, --private-key <privateKey>', 'Hedera private key', process.env.HEDERA_OPERATOR_KEY)
  .option('-n, --network <network>', 'Hedera network', process.env.HEDERA_NETWORK || 'testnet')
  .option('-i, --inbound-topic <inboundTopic>', 'Inbound HCS topic ID (Optional - will be discovered from profile)', process.env.AGENT_INBOUND_TOPIC_ID)
  .option('-o, --outbound-topic <outboundTopic>', 'Outbound HCS topic ID', process.env.AGENT_OUTBOUND_TOPIC_ID)
  .option('-l, --log-level <logLevel>', 'Log level (debug, info, warn, error)', process.env.LOG_LEVEL || 'info')
  .option('--openai-api-key <openAiApiKey>', 'OpenAI API key', process.env.OPENAI_API_KEY)
  .option('--openai-model <openAiModel>', 'OpenAI model to use', process.env.OPENAI_MODEL || 'gpt-4-turbo')
  .option('--sentinel-agent-id <sentinelAgentId>', 'Sentinel agent account ID for monitoring', process.env.SENTINEL_ACCOUNT_ID || process.env.SENTINEL_ACCOUNT)
  .action(async (options) => {
    try {
      // Validate required parameters
      if (!options.accountId) {
        console.error('Error: Account ID is required. Provide it with --account-id or HEDERA_OPERATOR_ID env var.');
        process.exit(1);
      }

      if (!options.privateKey) {
        console.error('Error: Private key is required. Provide it with --private-key or HEDERA_OPERATOR_KEY env var.');
        process.exit(1);
      }

      // Inbound topic is no longer required - will be discovered from profile
      if (!options.inboundTopic) {
        console.log('Note: No inbound topic ID provided. The correct topic will be discovered from HCS-11 profile.');
        options.inboundTopic = '0.0.0'; // Placeholder that will be replaced during initialization
      } else {
        console.log('Note: Provided inbound topic ID will be ignored. The correct topic will be discovered from HCS-11 profile.');
      }

      if (!options.outboundTopic) {
        console.error('Error: Outbound topic ID is required. Provide it with --outbound-topic or AGENT_OUTBOUND_TOPIC_ID env var.');
        process.exit(1);
      }
      
      // Validate network type
      let validNetwork: 'testnet' | 'mainnet' = 'testnet';
      if (options.network === 'mainnet') {
        validNetwork = 'mainnet';
      } else if (options.network !== 'testnet') {
        console.warn(`Warning: Unsupported network type "${options.network}", defaulting to "testnet"`);
      }

      console.log('Initializing Lynx Agent with the following configuration:');
      console.log(`- Account ID: ${options.accountId}`);
      console.log(`- Network: ${validNetwork}`);
      console.log(`- Outbound Topic: ${options.outboundTopic}`);
      console.log(`- Log Level: ${options.logLevel}`);
      console.log(`- OpenAI Model: ${options.openAiModel}`);
      console.log(`- Inbound Topic: Will be discovered from HCS-11 profile`);

      // Log sentinel agent info if provided
      if (options.sentinelAgentId) {
        console.log(`- Sentinel Agent ID: ${options.sentinelAgentId}`);
        console.log(`- Monitoring Sentinel Outbound Topic: ${process.env.SENTINEL_OUTBOUND_TOPIC_ID || 'Not found in environment'}`);
      }

      // Initialize the HCS10 client
      const client = new HCS10Client(
        options.accountId,
        options.privateKey,
        validNetwork,
        { useEncryption: false }
      );

      // No need to call client.init() as the constructor handles initialization

      console.log('HCS10 Client initialized');

      // Skip debug function for inbound topic since we don't have the real topic yet
      // We'll discover it during initialization

      console.log('Initializing Lynx Agent...');
      const agent = new LynxAgent({
        client,
        accountId: options.accountId,
        inboundTopicId: options.inboundTopic, // This will be replaced during initialization
        outboundTopicId: options.outboundTopic,
        logLevel: options.logLevel as 'debug' | 'info' | 'warn' | 'error',
        openAiApiKey: options.openAiApiKey,
        openAiModel: options.openAiModel,
        langchainConfig: {
          temperature: 0.2,
          maxTokens: 1000,
          streaming: true,
        },
        sentinelAgentId: options.sentinelAgentId, // Pass sentinel agent ID for monitoring
      });

      await agent.initialize();
      console.log('Starting Lynx Agent...');
      await agent.start();

      console.log('\nLynx Agent is now running.');
      console.log('Press Ctrl+C to stop the agent.');

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\nShutting down Lynx Agent...');
        await agent.stop();
        console.log('Lynx Agent stopped.');
        process.exit(0);
      });

      // Keep the process running
      setInterval(() => {}, 1000);
    } catch (error) {
      console.error('Error starting Lynx Agent:', error);
      process.exit(1);
    }
  });

// Command to start the sentinel agent
program
  .command('start-sentinel')
  .description('Start the Lynx Sentinel Agent for monitoring and rebalancing')
  .option('-a, --account-id <accountId>', 'Hedera account ID', process.env.SENTINEL_ACCOUNT_ID || process.env.SENTINEL_ACCOUNT)
  .option('-k, --private-key <privateKey>', 'Hedera private key', process.env.SENTINEL_PRIVATE_KEY || process.env.SENTINEL_KEY)
  .option('-n, --network <network>', 'Hedera network', process.env.HEDERA_NETWORK || 'testnet')
  .option('-i, --inbound-topic <inboundTopic>', 'Inbound HCS topic ID (Optional - will be discovered from profile)', process.env.SENTINEL_INBOUND_TOPIC_ID || process.env.AGENT_INBOUND_TOPIC_ID)
  .option('-o, --outbound-topic <outboundTopic>', 'Outbound HCS topic ID', process.env.SENTINEL_OUTBOUND_TOPIC_ID || process.env.AGENT_OUTBOUND_TOPIC_ID)
  .option('-r, --rebalancer-id <rebalancerId>', 'Rebalancer Agent ID', process.env.REBALANCER_AGENT_ID)
  .option('-l, --log-level <logLevel>', 'Log level (debug, info, warn, error)', process.env.LOG_LEVEL || 'info')
  .option('--openai-api-key <openAiApiKey>', 'OpenAI API key', process.env.OPENAI_API_KEY)
  .option('--openai-model <openAiModel>', 'OpenAI model to use', process.env.OPENAI_MODEL || 'gpt-4-turbo')
  .option('--price-check-interval <interval>', 'Price check interval in milliseconds', process.env.PRICE_CHECK_INTERVAL_MS || '60000')
  .action(async (options) => {
    try {
      // Validate required parameters
      if (!options.accountId) {
        console.error('Error: Account ID is required. Provide it with --account-id or SENTINEL_ACCOUNT_ID env var.');
        process.exit(1);
      }

      if (!options.privateKey) {
        console.error('Error: Private key is required. Provide it with --private-key or SENTINEL_PRIVATE_KEY env var.');
        process.exit(1);
      }

      if (!options.outboundTopic) {
        console.error('Error: Outbound topic ID is required. Provide it with --outbound-topic or SENTINEL_OUTBOUND_TOPIC_ID env var.');
        process.exit(1);
      }

      if (!options.rebalancerId) {
        console.error('Error: Rebalancer Agent ID is required. Provide it with --rebalancer-id or REBALANCER_AGENT_ID env var.');
        process.exit(1);
      }
      
      // Validate network type
      let validNetwork: 'testnet' | 'mainnet' = 'testnet';
      if (options.network === 'mainnet') {
        validNetwork = 'mainnet';
      } else if (options.network !== 'testnet') {
        console.warn(`Warning: Unsupported network type "${options.network}", defaulting to "testnet"`);
      }

      console.log('Initializing Sentinel Agent with the following configuration:');
      console.log(`- Account ID: ${options.accountId}`);
      console.log(`- Network: ${validNetwork}`);
      console.log(`- Outbound Topic: ${options.outboundTopic}`);
      console.log(`- Rebalancer Agent ID: ${options.rebalancerId}`);
      console.log(`- Log Level: ${options.logLevel}`);
      console.log(`- OpenAI Model: ${options.openAiModel}`);
      console.log(`- Price Check Interval: ${options.priceCheckInterval}ms`);
      console.log(`- Inbound Topic: Will be discovered from HCS-11 profile`);

      // Initialize the HCS10 client
      const client = new HCS10Client(
        options.accountId,
        options.privateKey,
        validNetwork,
        { useEncryption: false }
      );

      console.log('HCS10 Client initialized');

      // Initialize the Sentinel Agent
      console.log('Initializing Sentinel Agent...');
      const knowledgeDir = path.join(__dirname, 'knowledge');
      const agent = new SentinelAgent({
        client,
        accountId: options.accountId,
        inboundTopicId: '0.0.0', // Will be discovered from profile
        outboundTopicId: options.outboundTopic,
        rebalancerAgentId: options.rebalancerId,
        logLevel: options.logLevel as 'debug' | 'info' | 'warn' | 'error',
        priceCheckIntervalMs: parseInt(options.priceCheckInterval),
        openAiApiKey: options.openAiApiKey,
        openAiModel: options.openAiModel,
        knowledgeDir,
        tokenConfigs: PriceMonitor.getDefaultTokenConfigs()
      });

      await agent.initialize();
      console.log('Starting Sentinel Agent...');
      await agent.start();

      console.log('\nSentinel Agent is now running.');
      console.log('Press Ctrl+C to stop the agent.');

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\nShutting down Sentinel Agent...');
        await agent.stop();
        console.log('Sentinel Agent stopped.');
        process.exit(0);
      });

      // Keep the process running
      setInterval(() => {}, 1000);
    } catch (error) {
      console.error('Error starting Sentinel Agent:', error);
      process.exit(1);
    }
  });

// Command to start the rebalancer agent
program
  .command('start-rebalancer')
  .description('Start the Lynx Rebalancer Agent for executing treasury rebalances')
  .option('-a, --account-id <accountId>', 'Hedera account ID', process.env.REBALANCER_AGENT_ID)
  .option('-k, --private-key <privateKey>', 'Hedera private key', process.env.REBALANCER_PRIVATE_KEY)
  .option('-n, --network <network>', 'Hedera network', process.env.HEDERA_NETWORK || 'testnet')
  .option('-i, --inbound-topic <inboundTopic>', 'Inbound HCS topic ID (Optional - will be discovered from profile)', process.env.REBALANCER_INBOUND_TOPIC_ID)
  .option('-o, --outbound-topic <outboundTopic>', 'Outbound HCS topic ID', process.env.REBALANCER_OUTBOUND_TOPIC_ID)
  .option('-s, --sentinel-id <sentinelId>', 'Sentinel Agent ID', process.env.SENTINEL_ACCOUNT_ID || process.env.SENTINEL_ACCOUNT)
  .option('--sentinel-topic <sentinelTopicId>', 'Sentinel outbound topic ID to monitor', process.env.SENTINEL_OUTBOUND_TOPIC_ID)
  .option('-l, --log-level <logLevel>', 'Log level (debug, info, warn, error)', process.env.LOG_LEVEL || 'info')
  .option('--openai-api-key <openAiApiKey>', 'OpenAI API key', process.env.OPENAI_API_KEY)
  .option('--openai-model <openAiModel>', 'OpenAI model to use', process.env.OPENAI_MODEL || 'gpt-4-turbo')
  .action(async (options) => {
    try {
      // Import the RebalancerAgent class
      const { RebalancerAgent } = await import('./RebalancerAgent');
      
      // Validate required options
      if (!options.accountId) {
        console.error('Error: Missing required option "account-id" or REBALANCER_ACCOUNT environment variable');
        process.exit(1);
      }
      
      if (!options.privateKey) {
        console.error('Error: Missing required option "private-key" or REBALANCER_KEY environment variable');
        process.exit(1);
      }
      
      if (!options.outboundTopic) {
        console.error('Error: Missing required option "outbound-topic" or REBALANCER_OUTBOUND_TOPIC_ID environment variable');
        process.exit(1);
      }
      
      if (!options.sentinelId) {
        console.error('Error: Missing required option "sentinel-id" or SENTINEL_ACCOUNT_ID environment variable');
        process.exit(1);
      }
      
      if (!options.sentinelTopic) {
        console.error('Error: Missing required option "sentinel-topic" or SENTINEL_OUTBOUND_TOPIC_ID environment variable');
        process.exit(1);
      }
      
      // Validate network type
      const validNetwork = options.network === 'mainnet' ? 'mainnet' : 'testnet';
      
      console.log('\n=== Starting Lynx Rebalancer Agent ===');
      console.log(`- Account ID: ${options.accountId}`);
      console.log(`- Network: ${validNetwork}`);
      console.log(`- Inbound Topic: ${options.inboundTopic || 'Will be discovered from profile'}`);
      console.log(`- Outbound Topic: ${options.outboundTopic}`);
      console.log(`- Sentinel Agent ID: ${options.sentinelId}`);
      console.log(`- Sentinel Outbound Topic: ${options.sentinelTopic}`);
      console.log(`- Log Level: ${options.logLevel}`);
      
      // Initialize the HCS10 client
      const { HCS10Client } = await import('../../src/hcs10/HCS10Client');
      const client = new HCS10Client(
        options.accountId,
        options.privateKey,
        validNetwork,
        { useEncryption: false }
      );
      
      console.log('HCS10 Client initialized');
      
      console.log('Initializing Rebalancer Agent...');
      const agent = new RebalancerAgent({
        client,
        accountId: options.accountId,
        inboundTopicId: options.inboundTopic || '0.0.0', // Will be discovered during initialization
        outboundTopicId: options.outboundTopic,
        sentinelAgentId: options.sentinelId,
        sentinelOutboundTopicId: options.sentinelTopic,
        logLevel: options.logLevel as 'debug' | 'info' | 'warn' | 'error',
        openAiApiKey: options.openAiApiKey,
        openAiModel: options.openAiModel
      });
      
      await agent.initialize();
      console.log('Starting Rebalancer Agent...');
      await agent.start();
      
      console.log('\nRebalancer Agent is now running.');
      console.log('Press Ctrl+C to stop the agent.');
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\nShutting down Rebalancer Agent...');
        await agent.stop();
        console.log('Rebalancer Agent stopped.');
        process.exit(0);
      });
      
      // Keep the process running
      setInterval(() => {}, 1000);
    } catch (error) {
      console.error('Error starting Rebalancer Agent:', error);
      process.exit(1);
    }
  });

// Command to start the governance agent
program
  .command('start-governance')
  .description('Start the Lynx Governance Agent for DAO parameter management')
  .option('-a, --account-id <accountId>', 'Hedera account ID', process.env.GOVERNANCE_ACCOUNT_ID)
  .option('-k, --private-key <privateKey>', 'Hedera private key', process.env.GOVERNANCE_PRIVATE_KEY)
  .option('-n, --network <network>', 'Hedera network', process.env.HEDERA_NETWORK || 'testnet')
  .option('-i, --inbound-topic <inboundTopic>', 'Inbound HCS topic ID (Optional - will be discovered from profile)', process.env.GOVERNANCE_INBOUND_TOPIC_ID)
  .option('-o, --outbound-topic <outboundTopic>', 'Outbound HCS topic ID', process.env.GOVERNANCE_OUTBOUND_TOPIC_ID)
  .option('-r, --rebalancer-id <rebalancerId>', 'Rebalancer agent account ID', process.env.REBALANCER_AGENT_ID)
  .option('-c, --contract-id <contractId>', 'Governance contract ID', process.env.GOVERNANCE_CONTRACT_ID)
  .option('--vault-address <vaultAddress>', 'Vault contract address for executing parameter changes', process.env.VAULT_CONTRACT_ADDRESS)
  .option('--agent-key <agentKey>', 'Agent private key for vault contract interactions', process.env.AGENT_PRIVATE_KEY)
  .option('-l, --log-level <logLevel>', 'Log level (debug, info, warn, error)', process.env.LOG_LEVEL || 'info')
  .option('--openai-api-key <openAiApiKey>', 'OpenAI API key', process.env.OPENAI_API_KEY)
  .option('--openai-model <openAiModel>', 'OpenAI model to use', process.env.OPENAI_MODEL || 'gpt-4o')
  .action(async (options) => {
    await startGovernanceAgent(options);
  });

/**
 * Start the Governance Agent
 */
async function startGovernanceAgent(options: any): Promise<void> {
  try {
    // Import the GovernanceAgent class
    const { GovernanceAgent } = await import('./GovernanceAgent');
    
    // Validate required options
    if (!options.accountId) {
      console.error('Error: Missing required option "account-id" or GOVERNANCE_ACCOUNT_ID environment variable');
      process.exit(1);
    }
    
    if (!options.privateKey) {
      console.error('Error: Missing required option "private-key" or GOVERNANCE_PRIVATE_KEY environment variable');
      process.exit(1);
    }
    
    if (!options.outboundTopic) {
      console.error('Error: Missing required option "outbound-topic" or GOVERNANCE_OUTBOUND_TOPIC_ID environment variable');
      process.exit(1);
    }
    
    if (!options.rebalancerId) {
      console.error('Error: Missing required option "rebalancer-id" or REBALANCER_AGENT_ID environment variable');
      process.exit(1);
    }
    
    // Validate network type
    const validNetwork = options.network === 'mainnet' ? 'mainnet' : 'testnet';
    
    console.log('\n=== Starting Lynx Governance Agent ===');
    console.log(`- Account ID: ${options.accountId}`);
    console.log(`- Network: ${validNetwork}`);
    console.log(`- Inbound Topic: ${options.inboundTopic || 'Will be discovered from profile'}`);
    console.log(`- Outbound Topic: ${options.outboundTopic}`);
    console.log(`- Rebalancer Agent ID: ${options.rebalancerId}`);
    if (options.contractId) {
      console.log(`- Governance Contract ID: ${options.contractId}`);
    }
    if (options.vaultAddress) {
      console.log(`- Vault Contract Address: ${options.vaultAddress}`);
    }
    if (options.agentKey) {
      console.log(`- Agent Private Key: [REDACTED]`);
    }
    console.log(`- Log Level: ${options.logLevel}`);
    
    // Initialize the HCS10 client
    const { HCS10Client } = await import('../../src/hcs10/HCS10Client');
    const client = new HCS10Client(
      options.accountId,
      options.privateKey,
      validNetwork,
      { useEncryption: false }
    );
    
    console.log('HCS10 Client initialized');
    
    console.log('Initializing Governance Agent...');
    const agent = new GovernanceAgent({
      client,
      accountId: options.accountId,
      inboundTopicId: options.inboundTopic || '0.0.0', // Will be discovered during initialization
      outboundTopicId: options.outboundTopic,
      rebalancerAgentId: options.rebalancerId,
      governanceContractId: options.contractId,
      vaultContractAddress: options.vaultAddress,
      agentPrivateKey: options.agentKey,
      logLevel: options.logLevel as 'debug' | 'info' | 'warn' | 'error',
      openAiApiKey: options.openAiApiKey,
      openAiModel: options.openAiModel
    });
    
    await agent.initialize();
    console.log('Starting Governance Agent...');
    await agent.start();
    
    console.log('\nGovernance Agent is now running.');
    console.log('Press Ctrl+C to stop the agent.');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down Governance Agent...');
      await agent.stop();
      console.log('Governance Agent stopped.');
      process.exit(0);
    });
    
    // Keep the process running
    setInterval(() => {}, 1000);
  } catch (error) {
    console.error('Error starting Governance Agent:', error);
    process.exit(1);
  }
}

// Command to start the advisor agent
program
  .command('start-advisor')
  .description('Start the Lynx Advisor Agent for strategic intelligence and recommendations')
  .option('-a, --account-id <accountId>', 'Hedera account ID', process.env.ADVISOR_ACCOUNT_ID)
  .option('-k, --private-key <privateKey>', 'Hedera private key', process.env.ADVISOR_KEY)
  .option('-n, --network <network>', 'Hedera network', process.env.HEDERA_NETWORK || 'testnet')
  .option('-i, --inbound-topic <inboundTopic>', 'Inbound HCS topic ID (Optional - will be discovered from profile)', process.env.ADVISOR_INBOUND_TOPIC_ID)
  .option('-o, --outbound-topic <outboundTopic>', 'Outbound HCS topic ID', process.env.ADVISOR_OUTBOUND_TOPIC_ID)
  .option('-l, --log-level <logLevel>', 'Log level (debug, info, warn, error)', process.env.LOG_LEVEL || 'info')
  .option('--openai-api-key <openAiApiKey>', 'OpenAI API key', process.env.OPENAI_API_KEY)
  .option('--openai-model <openAiModel>', 'OpenAI model to use', process.env.OPENAI_MODEL || 'gpt-4o')
  .action(async (options) => {
    await startAdvisorAgent(options);
  });

/**
 * Start the Advisor Agent
 */
async function startAdvisorAgent(options: any): Promise<void> {
  try {
    // Import the AdvisorAgent class (assuming it exists or will be created)
    const { AdvisorAgent } = await import('./AdvisorAgent');
    
    // Validate required options
    if (!options.accountId) {
      console.error('Error: Missing required option "account-id" or ADVISOR_ACCOUNT_ID environment variable');
      process.exit(1);
    }
    
    if (!options.privateKey) {
      console.error('Error: Missing required option "private-key" or ADVISOR_KEY environment variable');
      process.exit(1);
    }
    
    if (!options.outboundTopic) {
      console.error('Error: Missing required option "outbound-topic" or ADVISOR_OUTBOUND_TOPIC_ID environment variable');
      process.exit(1);
    }
    
    // Validate network type
    const validNetwork = options.network === 'mainnet' ? 'mainnet' : 'testnet';
    
    console.log('\n=== Starting Lynx Advisor Agent ===');
    console.log(`- Account ID: ${options.accountId}`);
    console.log(`- Network: ${validNetwork}`);
    console.log(`- Inbound Topic: ${options.inboundTopic || 'Will be discovered from profile'}`);
    console.log(`- Outbound Topic: ${options.outboundTopic}`);
    console.log(`- Log Level: ${options.logLevel}`);
    
    // Initialize the HCS10 client
    const { HCS10Client } = await import('../../src/hcs10/HCS10Client');
    const client = new HCS10Client(
      options.accountId,
      options.privateKey,
      validNetwork,
      { useEncryption: false }
    );
    
    console.log('HCS10 Client initialized');
    
    console.log('Initializing Advisor Agent...');
    const agent = new AdvisorAgent({
      client,
      accountId: options.accountId,
      inboundTopicId: options.inboundTopic || '0.0.0', // Will be discovered during initialization
      outboundTopicId: options.outboundTopic,
      logLevel: options.logLevel as 'debug' | 'info' | 'warn' | 'error',
      openAiApiKey: options.openAiApiKey,
      openAiModel: options.openAiModel
    });
    
    await agent.initialize();
    console.log('Starting Advisor Agent...');
    await agent.start();
    
    console.log('\nAdvisor Agent is now running.');
    console.log('Press Ctrl+C to stop the agent.');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down Advisor Agent...');
      await agent.stop();
      console.log('Advisor Agent stopped.');
      process.exit(0);
    });
    
    // Keep the process running
    setInterval(() => {}, 1000);
  } catch (error) {
    console.error('Error starting Advisor Agent:', error);
    process.exit(1);
  }
}

// Parse command-line arguments
program.parse();

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
} 
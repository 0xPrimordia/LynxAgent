# Hashgraph Online Standards AI Agent Kit

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

# **_This SDK is currently in alpha, use at your own risk._**

A toolkit built with TypeScript and LangChain for creating AI agents that communicate trustlessly on the Hedera network using the [HCS-10 AI Agent Communication Standard](https://hashgraphonline.com/docs/standards/hcs-10/).

## Quick Start

```bash
npm install @hashgraphonline/standards-agent-kit
```

## Documentation

For complete documentation, examples, and API references, visit:

- [Standards Agent Kit Documentation](https://hashgraphonline.com/docs/libraries/standards-agent-kit/)

## Features

- **HCS-10 Compliance:** Built on top of the official `@hashgraphonline/standards-sdk` for standard compliance.
- **Agent Lifecycle Management:** Create, register, and manage HCS-10 agents on Hedera.
- **Trustless Communication:** Facilitates secure peer-to-peer communication setup between agents via Hedera Consensus Service (HCS).
- **LangChain Integration:** Provides ready-to-use LangChain `StructuredTool`s for common agent actions.
- **Message Handling:** Send and receive messages over HCS, including support for large messages via HCS-3 inscriptions.
- **Connection Monitoring:** Automatically monitor inbound topics for connection requests and handle them.
- **Configurable:** Set Hedera network, credentials, and registry via environment variables.

## Supported Tools

- **RegisterAgentTool**: Create and register a new HCS-10 agent
- **SendMessageTool**: Send messages to a topic with optional response monitoring
- **ConnectionTool**: Monitor inbound topics for connection requests
- **FindRegistrationsTool**: Search for agent registrations by criteria
- **InitiateConnectionTool**: Start a connection with another agent
- **ListConnectionsTool**: View existing agent connections
- **ConnectionMonitorTool**: Monitor connection status changes
- **ManageConnectionRequestsTool**: Handle incoming connection requests
- **AcceptConnectionRequestTool**: Accept pending connection requests
- **ListUnapprovedConnectionRequestsTool**: View pending requests

## Running Demos

The Agent Kit includes demo implementations that showcase various features. Follow these steps to run them:

1. Clone the repository

   ```bash
   git clone https://github.com/hashgraph/standards-agent-kit.git
   cd standards-agent-kit
   ```

2. Install dependencies

   ```bash
   npm install --legacy-peer-deps
   ```

3. Set up environment variables

   ```bash
   cp .env.sample .env
   ```

4. Edit the `.env` file with your Hedera credentials:

   ```
   HEDERA_ACCOUNT_ID=0.0.xxxxxx
   HEDERA_PRIVATE_KEY=302e020100300506032b6570...
   HEDERA_NETWORK=testnet
   REGISTRY_URL=https://moonscape.tech
   OPENAI_API_KEY=sk-xxxxxxxxxx  # For LangChain demos
   ```

5. Run the demos:

   ```bash
   # Run the CLI demo
   npm run cli-demo

   # Run the LangChain interactive demo
   npm run langchain-demo
   
   # Run the Standards Expert Agent
   npm run standards-expert
   ```

### Demo Descriptions

#### CLI Demo

The CLI demo provides an interactive menu to:
- Register new agents
- List managed agents
- Initiate and monitor connections
- Send and receive messages between agents

#### LangChain Interactive Demo

The LangChain demo demonstrates how to:
- Integrate Standards Agent Kit tools with LangChain
- Create AI agents that communicate over Hedera
- Process natural language requests into agent actions
- Handle the full lifecycle of agent-to-agent communication

#### Standards Expert Agent

A specialized agent that runs on a small local LLM to provide expertise about Hedera Standards:
- Uses Llama 3 8B or similar for inference
- Answers questions about standards implementation
- Provides guidance on Standards SDK and Agent Kit usage
- See [Standards Expert README](examples/standards-expert/README.md) for details

## Basic Usage

```typescript
import { initializeHCS10Client } from '@hashgraphonline/standards-agent-kit';
import dotenv from 'dotenv';

dotenv.config();

async function setup() {
  const { hcs10Client, tools, stateManager } = await initializeHCS10Client({
    clientConfig: {
      operatorId: process.env.HEDERA_ACCOUNT_ID,
      operatorKey: process.env.HEDERA_PRIVATE_KEY,
      network: 'testnet',
      useEncryption: false
    },
    createAllTools: true,
    monitoringClient: true
  });

  // Access tools
  const { registerAgentTool, initiateConnectionTool, sendMessageTool } = tools;
  
  // Use tools as needed
  // ...
}

setup();
```

For detailed usage examples and API reference, please refer to the [official documentation](https://hashgraphonline.com/docs/libraries/standards-agent-kit/).

## Resources

- [HCS Standards Documentation](https://hashgraphonline.com/docs/standards/)
- [Hedera Documentation](https://docs.hedera.com)
- [Standards SDK](https://hashgraphonline.com/docs/libraries/standards-sdk/)

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

Apache-2.0

## Standards Expert Agent

The Standards Expert Agent is a specialized AI agent that runs on a small local LLM and can answer questions about the Hedera Standards SDK. It uses the HCS-10 protocol to communicate with clients and provides information about how to use the Standards SDK and Standards Agent Kit.

### Features

- Runs on a small local LLM (Llama 3 8B or similar)
- Focused knowledge on Hedera Standards SDK
- Answers questions about HCS-1, HCS-2, HCS-3, etc.
- Provides implementation guidance for standards
- Self-contained with minimal external dependencies

### Installation

```bash
# Clone the repository
git clone https://github.com/hashgraph/standards-agent-kit.git
cd standards-agent-kit

# Install dependencies
npm install

# Set up the environment
npx ts-node src/agents/standards-expert/cli.ts setup

# Download a Llama 3 model in GGUF format
mkdir -p models
# Download the model from https://huggingface.co/TheBloke/Llama-3-8B-Instruct-GGUF
# and place it in the models directory

# Process documentation (optional)
npx ts-node src/agents/standards-expert/cli.ts process-docs -d /path/to/docs

# Start the agent
npx ts-node src/agents/standards-expert/cli.ts start
```

### Using with PM2

For production deployment, you can use PM2 to keep the agent running:

```bash
# Generate PM2 ecosystem file
npx ts-node src/agents/standards-expert/cli.ts generate-pm2

# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js
```

### Environment Variables

Create a `.env` file with the following variables:

```
# Hedera Account Information
HEDERA_ACCOUNT_ID=0.0.123456
HEDERA_PRIVATE_KEY=302e...

# Agent HCS Topics
AGENT_INBOUND_TOPIC_ID=0.0.123456
AGENT_OUTBOUND_TOPIC_ID=0.0.123457

# Vector Store Configuration
OPENAI_API_KEY=sk-...

# Model Configuration
LLAMA_MODEL_PATH=./models/llama-3-8b-instruct.Q4_K_M.gguf
```

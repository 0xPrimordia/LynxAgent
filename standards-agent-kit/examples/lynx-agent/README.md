# Lynx Agent

Lynx Agent is an AI-powered agent that communicates over the Hedera Consensus Service using the HCS-10 protocol. It leverages the Hashgraph Online Standards Agent Kit to establish secure connections with other agents and provide AI-generated responses to messages.

## Features

- Automatic connection request handling
- Message processing with AI-generated responses
- LangChain integration with OpenAI models
- Fully typed TypeScript implementation

## Setup

### Prerequisites

- Node.js v18 or higher
- Hedera account with testnet HBAR
- OpenAI API key for LLM functionality

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```
# Hedera Testnet Configuration
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=0.0.xxx  # Your Hedera account ID
HEDERA_OPERATOR_KEY=xxx     # Your Hedera private key

# Agent HCS Topic IDs - Create these using the Hedera Portal or SDK
AGENT_INBOUND_TOPIC_ID=0.0.xxx
AGENT_OUTBOUND_TOPIC_ID=0.0.xxx

# OpenAI Configuration
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4-turbo
```

## Usage

### Install Dependencies

From the root directory of the standards-agent-kit, run:

```bash
npm install
```

### Running the Agent

```bash
# Use the CLI to start the agent
npm run lynx-agent:start
```

You can also pass options directly:

```bash
npx tsx examples/lynx-agent/cli.ts start \
  --account-id 0.0.xxx \
  --private-key xxx \
  --inbound-topic 0.0.xxx \
  --outbound-topic 0.0.xxx \
  --openai-api-key sk-xxx
```

## Testing Tools

The Lynx Agent comes with several tools to test its functionality directly on the Hedera Consensus Service:

### Connection Tester

Tests the agent's connection to the Hedera network and verifies topic access:

```bash
npm run lynx-agent:connection-test
```

### Message Sender

An interactive tool to send messages to any HCS topic and listen for responses:

```bash
npm run lynx-agent:send-message
```

### Response Listener

Monitors a specific topic for new messages in real-time:

```bash
npm run lynx-agent:listen
```

### Complete End-to-End Test

Run all tests in sequence to verify the agent's functionality:

```bash
npm run lynx-agent:test-all
```

This will:
1. Test connectivity to Hedera and topic access
2. Test message sending and verification
3. Verify the agent's CLI can initialize

Test results will be recorded in the `logs` directory for review.

## Architecture

The Lynx Agent consists of the following components:

1. **LynxAgent.ts** - Main agent implementation with messaging and AI functionality
2. **cli.ts** - Command-line interface for starting and managing the agent
3. **test/** - Directory containing testing tools

## Vault Contract Integration

The Lynx Governance Agent now supports automatic execution of vault contract updates when governance votes reach quorum. This enables on-chain execution of parameter changes for token composition.

For detailed setup and usage instructions, see [VAULT_INTEGRATION_README.md](./VAULT_INTEGRATION_README.md).

### Quick Setup

```bash
# Set environment variables for vault integration
export VAULT_CONTRACT_ADDRESS=0xf63c0858c57ec70664Dfb02792F8AB09Fe3F0b94
export AGENT_PRIVATE_KEY=your_agent_private_key_here

# Start governance agent with vault integration
npm run lynx-agent:start-governance -- \
  --vault-address $VAULT_CONTRACT_ADDRESS \
  --agent-key $AGENT_PRIVATE_KEY
```

## Implementation Plan

For details on the implementation approach, see the [implementation.md](./implementation.md) file.

## Customization

You can customize the agent by modifying:

- The LangChain prompt template in `initializeLangChain()`
- The OpenAI model and parameters in the configuration
- Message handling logic in `handleMessage()`

## License

This example is part of the standards-agent-kit and is available under the Apache-2.0 license. 
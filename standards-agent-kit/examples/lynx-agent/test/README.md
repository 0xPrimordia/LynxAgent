# Lynx Agent Test Tools

This directory contains test tools for Lynx Agent that implement the proper connection topic approach following the HCS-10 protocol.

## Tools Overview

1. **message-sender.ts**: Interactive tool to establish connections and send messages to an agent
2. **connection-tester.ts**: Automated test for validating connection topic functionality
3. **response-listener.ts**: Tool for monitoring incoming messages on specific topics
4. **run-all-tests.ts**: Comprehensive test suite for all agent functionality

## Connection Topic Approach

These tools implement the connection topic approach from the HCS-10 protocol where:

1. Agents establish connections through a handshake process via inbound topics
2. Once a connection is established, all subsequent messages flow through the dedicated connection topic
3. The connection topic is discovered and tracked by the ConnectionsManager
4. All state is properly managed through the OpenConvaiState component

## How to Use

### Prerequisites

Create a `.env` file in the project root with the following variables:

```
# Hedera Account Information
HEDERA_OPERATOR_ID=0.0.123456
HEDERA_PRIVATE_KEY=302e...
HEDERA_NETWORK=testnet

# Agent's inbound/outbound topics (optional, can be discovered automatically)
AGENT_INBOUND_TOPIC_ID=0.0.123456
AGENT_OUTBOUND_TOPIC_ID=0.0.123457

# Target agent for testing
TARGET_AGENT_ID=0.0.4340026
```

### Run the Message Sender

Use this interactive tool to connect to an agent and send messages:

```bash
npm run lynx-agent:send-message
# or directly:
npx tsx examples/lynx-agent/test/message-sender.ts
```

### Run the Connection Tester

Use this tool to test if you can establish connections and exchange messages:

```bash
npm run lynx-agent:connection-test
# or directly:
npx tsx examples/lynx-agent/test/connection-tester.ts
```

### Run the Response Listener 

Use this tool to monitor incoming messages:

```bash
npm run lynx-agent:listen
# or directly:
npx tsx examples/lynx-agent/test/response-listener.ts
```

### Run All Tests

Run a comprehensive test suite:

```bash
npm run lynx-agent:test-all
# or directly:
npx tsx examples/lynx-agent/test/run-all-tests.ts
```

## How It Works

### Connection Establishment

1. The client initializes an OpenConvaiState and ConnectionsManager
2. The InitiateConnectionTool establishes a connection to the target agent
3. The connection is registered in state with a dedicated connection topic

### Message Exchange

1. Messages are sent using SendMessageToConnectionTool (preferred) or directly via SendMessageTool
2. Messages are always sent to the connection topic, not the inbound or outbound topics
3. Messages are received through the same connection topic

### Error Handling

1. Connection errors trigger reconnection attempts
2. Message sending failures provide diagnostic information
3. Rate limiting is handled with exponential backoff and jitter

## Troubleshooting

If you encounter issues:

1. **Connection not established**: Verify the target agent ID is correct and accessible
2. **Messages not sent**: Check that the connection topic is valid and your account has permission
3. **No responses received**: Verify the agent is properly handling messages and configured to respond
4. **Rate limiting errors**: Adjust test frequency or implement backoff strategy

## Implementation Notes

The key improvements in these tools include:

1. Proper ConnectionsManager initialization
2. Consistent use of connection topics for message exchange
3. Error handling with diagnostics and recovery
4. State management using the standards-agent-kit patterns

These align with the best practices seen in the standards-expert implementation. 
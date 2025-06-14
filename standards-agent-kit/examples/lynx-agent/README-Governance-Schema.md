# Lynx DAO Governance Schema System

This directory contains a comprehensive standardized message schema system for parameterized DAO governance using the Hedera Standards SDK and HCS-10 protocol.

## Overview

The Lynx DAO operates as a **parameterized DAO** that uses predefined "dials" for member voting rather than traditional proposals. This system provides:

- **Standardized message validation** using Zod schemas
- **HCS-10 protocol compliance** for agent communication
- **Real-time parameter state tracking** with integrity verification
- **Predefined parameter constraints** to ensure system stability
- **Type-safe governance operations** with comprehensive validation

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Governance Message Schema                     │
├─────────────────────────────────────────────────────────────────┤
│  • HCS-10 Message Validation                                    │
│  • Parameter Option Schemas                                     │
│  • Vote & Result Message Types                                  │
│  • State Snapshot Management                                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  GovernanceMessageHandler                       │
├─────────────────────────────────────────────────────────────────┤
│  • Message Processing & Validation                              │
│  • State Management & Integrity                                 │
│  • HCS-10 Protocol Integration                                  │
│  • Standards SDK Compliance                                     │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Standards SDK (HCS-10)                       │
├─────────────────────────────────────────────────────────────────┤
│  • Hedera Topic Management                                      │
│  • Message Encryption/Decryption                                │
│  • Agent Registration & Discovery                               │
│  • Connection Management                                        │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Governance Schema (`governance-schema.ts`)

Defines comprehensive Zod schemas for all governance message types:

#### Message Types
- **`governance_vote`** - Member votes on parameter changes
- **`governance_result`** - Vote outcome and parameter updates
- **`governance_state`** - Complete parameter state snapshots
- **`governance_proposal`** - New parameter change proposals

#### Parameter Categories
- **Rebalancing** - Frequency, thresholds, cooldown periods
- **Treasury** - Token weights, slippage limits, swap sizes, sectors
- **Fees** - Minting, burning, operational fees
- **Governance** - Quorum, voting periods, proposal thresholds

#### Validation Features
- Type-safe parameter definitions with constraints
- Predefined option lists (the "dials")
- Cross-parameter dependency validation
- Schema version compatibility

### 2. Message Handler (`GovernanceMessageHandler.ts`)

Provides standardized message processing and state management:

#### Core Features
- **Message Validation** - Validates all incoming messages against schemas
- **State Tracking** - Maintains current parameter state with integrity hashes
- **Parameter Updates** - Applies approved changes with validation
- **Message Broadcasting** - Sends governance messages via HCS-10

#### Integration
- Uses Standards SDK HCS10Client for Hedera communication
- Implements proper HCS-10 message formatting
- Provides utility methods for vote and result creation

### 3. Example Implementation (`governance-example.ts`)

Demonstrates complete usage patterns:

#### Parameterized DAO Setup
```typescript
// Initialize with predefined parameter "dials"
const parameters = example.initializeDAOParameters();

// Display available voting options
example.displayAvailableParameters();
```

#### Member Voting
```typescript
// Process a vote on a specific parameter dial
await example.processParameterVote(
  '0.0.654321',                    // Voter account ID
  'rebalancing.thresholds.normal', // Parameter path
  15,                              // Selected value from predefined options
  1000,                            // Voting power (token weight)
  'Increase for better stability'  // Optional reason
);
```

#### State Management
```typescript
// Publish current state to the network
await example.publishCurrentState();

// Validate parameter constraints
example.validateParameterConstraints();
```

## DAO Parameters

The system implements all parameters defined in `Lynx_DAO_Parameters.md`:

### Functional Parameters
- **Rebalancing Frequency** - `[4, 6, 12, 24, 48]` hours
- **Rebalancing Thresholds** - Normal `[5, 7, 10, 15]%`, Emergency `[10, 15, 20, 25]%`
- **Token Weights** - Predefined percentages for each supported token
- **Governance Quorum** - `[10, 15, 20, 25, 30]%` of total supply
- **Voting Period** - `[48, 72, 96, 168]` hours
- **Fee Rates** - Minting/Burning `[0.1, 0.2, 0.3, 0.5]%`

### State Parameters
- **Current Token List** - Active tokens in the index
- **Current Ratios** - Live allocation percentages
- **Sector Assignments** - Token categorization with weight constraints
- **Active Policies** - Current governance rules

### Sector Definitions
1. **Core Hedera** - HBAR (20-50% weight)
2. **DeFi & DEX** - SAUCE, HELI (10-40% weight)
3. **Enterprise & Utility** - HTS, HSUITE, HASHPACK (5-30% weight)

## Message Format Examples

### Vote Message
```json
{
  "p": "hcs-10",
  "op": "governance_vote",
  "operator_id": "0.0.789101@0.0.123456",
  "data": {
    "parameterPath": "rebalancing.thresholds.normal",
    "newValue": 15,
    "voterAccountId": "0.0.654321",
    "votingPower": 1000,
    "timestamp": "2024-01-15T10:30:00Z",
    "reason": "Increase threshold for better stability"
  },
  "m": "Vote on rebalancing.thresholds.normal"
}
```

### Result Message
```json
{
  "p": "hcs-10",
  "op": "governance_result",
  "operator_id": "0.0.789101@0.0.123456",
  "data": {
    "type": "PARAMETER_UPDATE",
    "parameterPath": "rebalancing.thresholds.normal",
    "oldValue": 10,
    "newValue": 15,
    "votesInFavor": 25,
    "totalVotingPower": 16500,
    "quorumPercentage": 15,
    "quorumReached": true,
    "effectiveTimestamp": "2024-01-15T12:00:00Z",
    "executionStatus": "executed"
  }
}
```

### State Snapshot Message
```json
{
  "p": "hcs-10",
  "op": "governance_state",
  "operator_id": "0.0.789101@0.0.123456",
  "data": {
    "parameters": { /* Complete parameter structure */ },
    "activeVotes": [
      {
        "parameterPath": "treasury.weights.HBAR",
        "proposedValue": 35,
        "votingEnds": "2024-01-16T12:00:00Z",
        "currentVotes": 8500,
        "requiredVotes": 15000
      }
    ],
    "recentChanges": [
      {
        "parameterPath": "rebalancing.thresholds.normal",
        "oldValue": 10,
        "newValue": 15,
        "timestamp": "2024-01-15T12:00:00Z",
        "txId": "0.0.123456@1234567890.123456789"
      }
    ],
    "timestamp": "2024-01-15T14:30:00Z",
    "hash": "a1b2c3d4e5f6"
  }
}
```

## Usage Guide

### 1. Setup

```typescript
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { GovernanceMessageHandler } from './GovernanceMessageHandler';

// Initialize the client and handler
const client = new HCS10Client(/* config */);
const handler = new GovernanceMessageHandler({
  client,
  accountId: '0.0.123456',
  inboundTopicId: '0.0.789101',
  outboundTopicId: '0.0.789102',
  stateValidation: true
});
```

### 2. Process Incoming Messages

```typescript
// Process messages from the governance topic
const result = await handler.processMessage(messageData);

if (result.isValid) {
  console.log(`Processed: ${result.message?.op}`);
  // Handle based on message type
  switch (result.message?.op) {
    case 'governance_vote':
      // Process vote
      break;
    case 'governance_result':
      // Update local state
      break;
    case 'governance_state':
      // Sync state
      break;
  }
} else {
  console.error('Invalid message:', result.errors);
}
```

### 3. Send Governance Messages

```typescript
// Send a vote
await handler.sendGovernanceMessage('VOTE', {
  parameterPath: 'fees.mintingFee',
  newValue: 0.3,
  voterAccountId: '0.0.654321',
  votingPower: 2500,
  timestamp: new Date(),
  reason: 'Adjust fee for market conditions'
});

// Publish state snapshot
await handler.publishStateSnapshot(currentParameters);
```

### 4. Validate Parameters

```typescript
// Validate parameter change
const validation = validateParameterChange(
  'treasury.weights.HBAR',
  currentValue,
  proposedValue,
  currentParameters
);

if (!validation.isValid) {
  console.error('Invalid change:', validation.errors);
}

// Validate complete state
const stateValidation = handler.validateCurrentState();
```

## Integration with Standards SDK

The system leverages the Standards SDK for:

1. **HCS-10 Protocol Compliance** - All messages follow HCS-10 standards
2. **Topic Management** - Uses SDK for topic creation and message handling
3. **Agent Registration** - Integrates with agent discovery and profiles
4. **Message Encryption** - Supports encrypted governance communications
5. **Connection Management** - Manages agent-to-agent connections

## Benefits

### For DAO Members
- **Simple Voting** - Choose from predefined options rather than complex proposals
- **Real-time State** - Always see current parameter values and active votes
- **Transparent Process** - All governance activity recorded on Hedera

### For Developers
- **Type Safety** - Comprehensive TypeScript types prevent errors
- **Schema Validation** - Automatic validation of all governance messages
- **Standards Compliance** - Full integration with Hedera ecosystem tools
- **Extensible** - Easy to add new parameters and voting mechanisms

### For the DAO
- **Parameter Integrity** - Constraints prevent invalid configurations
- **Audit Trail** - Complete history of all parameter changes
- **Cross-Parameter Validation** - Ensures consistent system state
- **Emergency Procedures** - Built-in emergency override mechanisms

## Security Considerations

1. **Message Validation** - All messages validated against schemas before processing
2. **Parameter Constraints** - Predefined limits prevent dangerous configurations
3. **State Integrity** - Hash verification ensures state consistency
4. **Voting Power Verification** - Token balances verified before vote acceptance
5. **Replay Protection** - Timestamp and sequence number validation

## Future Enhancements

- **Multi-signature Governance** - Support for multi-agent approvals
- **Dynamic Constraints** - Parameter constraints that adapt based on market conditions
- **Delegation Support** - Allow token holders to delegate voting power
- **Governance Analytics** - Rich reporting on voting patterns and outcomes
- **Integration Testing** - Comprehensive test suite for all governance scenarios

---

This governance schema system provides a robust foundation for parameterized DAO governance on Hedera, combining the flexibility of the Standards SDK with the reliability of strongly-typed validation and the transparency of on-chain governance. 
# Lynx Agent

A Hedera-based agent system for managing governance, rebalancing, and sentinel operations.

## Overview

This project implements a suite of agents for the Lynx system, including:
- Governance Agent: Handles parameter voting and governance operations
- Rebalancing Agent: Manages portfolio rebalancing
- Sentinel Agent: Monitors and maintains system health

## Prerequisites

- Node.js (v16 or higher)
- npm
- Access to Hedera Network (Mainnet/Testnet)

## Installation

1. Clone the repository:
```bash
git clone [your-repo-url]
cd LynxAgent
```

2. Install dependencies:
```bash
npm install
cd standards-agent-kit
npm install
```

3. Create a `.env` file based on `.env.example` and configure your environment variables.

## Usage

The project provides several npm scripts for different operations:

### Starting Agents
```bash
# Start Governance Agent
npm run start-governance

# Start Rebalancing Agent
npm run start-rebalancer

# Start Sentinel Agent
npm run start-sentinel
```

### Registration
```bash
# Register Governance Agent
npm run register-governance

# Register Rebalancing Agent
npm run register-rebalancer

# Register Sentinel Agent
npm run register-sentinel
```

### Testing
```bash
# Test connection
npm run connection-test

# Run all tests
npm run test-all
```

## Configuration

Environment variables should be configured in the `.env` file. See `.env.example` for required variables.

## License

[Your License]

## Contributing

[Your Contributing Guidelines] 
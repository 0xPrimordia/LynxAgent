# Governance Contract Testing Documentation

## Overview

This testing suite validates the end-to-end governance workflow from vote submission to contract execution. The tests run **locally** against your **deployed governance agent** on Heroku.

## Architecture

```
Local Test Scripts  →  Heroku Governance Agent  →  Hedera Contract
     ↓                        ↓                        ↓
 Send Vote Message    Process & Validate Vote    Execute updateRatios()
 Monitor Results      Check Quorum & Execute     Update Token Ratios
```

### Components

1. **Local Test Scripts** - Run on your machine, send votes and monitor results
2. **Deployed Governance Agent** - Runs on Heroku, processes votes and executes contracts
3. **Hedera Contract** - Smart contract at `0.0.6216949` that stores token ratios

## Prerequisites

### 1. Environment Setup

**Required Environment Variables:**
```bash
export TEST_ACCOUNT="0.0.4372449"
export TEST_KEY="your-private-key-here"
```

### 2. Deployed Infrastructure

**Governance Agent on Heroku:**
- App: `lynx-agents`
- Environment variable: `GOVERNANCE_CONTRACT_ID=0.0.6216949`
- Monitoring topic: `0.0.6110235` (inbound)
- Response topic: `0.0.6110236` (outbound)

**Hedera Contract:**
- Contract ID: `0.0.6216949`
- Function: `updateRatios(uint256,uint256,uint256,uint256,uint256,uint256)`
- Network: Testnet

## Test Scripts

### Individual Components

#### 1. Check Contract Ratios
```bash
npm run lynx-agent:check-contract
```

**Purpose:** Query current token ratios from the contract
**Output:** Table showing current HBAR, WBTC, SAUCE, USDC, JAM, HEADSTART ratios

#### 2. Send Test Vote  
```bash
npm run lynx-agent:send-test-vote
```

**Purpose:** Send a multi-ratio vote with sufficient voting power
**Vote Format:**
```json
{
  "type": "MULTI_RATIO_VOTE",
  "ratioChanges": [
    { "token": "USDC", "newRatio": 22 },
    { "token": "SAUCE", "newRatio": 18 },
    { "token": "HBAR", "newRatio": 48 }
  ],
  "voterAccountId": "0.0.4372449",
  "votingPower": 250000,
  "timestamp": "2025-01-24T...",
  "reason": "Contract execution test"
}
```

#### 3. Monitor Contract Execution
```bash
npm run lynx-agent:test-contract-execution
```

**Purpose:** Monitor mirror node for contract execution transactions
**Monitors:** Recent calls to contract `0.0.6216949`

### Complete Workflow

#### 4. Full End-to-End Test
```bash
npm run lynx-agent:run-contract-test
```

**Complete workflow:**
1. ✅ Check initial contract ratios
2. 🗳️ Send test vote to governance agent
3. 👁️ Display Heroku monitoring instructions
4. ⏳ Monitor for contract execution (5 minutes)
5. 🔍 Verify transaction on HashScan
6. 📊 Check final contract ratios

## Test Workflow

### Step 1: Setup Environment
```bash
# Set your credentials
export TEST_ACCOUNT="0.0.4372449"
export TEST_KEY="your-private-key-here"

# Navigate to project root
cd /path/to/LynxAgent/standards-agent-kit
```

### Step 2: Start Monitoring (Separate Terminal)
```bash
# Monitor Heroku logs for governance agent activity
heroku logs --tail --app lynx-agents
```

### Step 3: Run Complete Test
```bash
npm run lynx-agent:run-contract-test
```

### Step 4: Watch for Success Indicators

**In Heroku Logs:**
```
✅ Found MULTI_RATIO_VOTE message with 3 ratio changes
✅ Processing multi-ratio vote from 0.0.4372449 with 3 ratio changes
✅ Processing ratio change for USDC: 22
✅ Processing ratio change for SAUCE: 18
✅ Processing ratio change for HBAR: 48
✅ Quorum reached for treasury.weights.USDC: 250000 / 15000
✅ Contract updateRatios executed successfully. Transaction ID: 1750xxxxx.xxxxxx
```

**In Test Output:**
```
🎉 SUCCESS! Contract execution test completed successfully!
🔗 Transaction: https://hashscan.io/testnet/transaction/1750xxxxx.xxxxxx
🔗 Contract: https://hashscan.io/testnet/contract/0.0.6216949
```

## Deployment Requirements

### Can Tests Run Locally?
**YES** - The test scripts run locally and connect to:
- Your deployed governance agent on Heroku
- Hedera testnet via mirror node APIs
- Hedera testnet for contract queries

### What Needs to be Deployed?
Only the **governance agent** needs to be deployed on Heroku with:
```bash
# Required Heroku environment variables
heroku config:set GOVERNANCE_CONTRACT_ID=0.0.6216949 -a lynx-agents
```

## Troubleshooting

### Vote Not Detected
**Symptoms:** Heroku logs show no "Found MULTI_RATIO_VOTE message"
**Solutions:**
- Verify governance agent is running: `heroku ps -a lynx-agents`
- Check topic ID is correct: `0.0.6110235`
- Ensure vote has enough voting power (250,000)

### Contract Execution Fails
**Symptoms:** Logs show "Transaction ID: undefined"
**Solutions:**
- Verify `GOVERNANCE_CONTRACT_ID` is set on Heroku
- Check Hedera client access in governance agent
- Ensure account has sufficient HBAR for fees

### Transaction Not Found
**Symptoms:** Test can't find contract execution transaction
**Solutions:**
- Check HashScan manually for recent contract calls
- Verify contract ID is correct (`0.0.6216949`)
- Contract execution may be delayed

### Environment Variable Issues
**Symptoms:** "TEST_KEY environment variable is required"
**Solutions:**
```bash
# Check variables are set
echo $TEST_ACCOUNT
echo $TEST_KEY

# Set if missing
export TEST_ACCOUNT="0.0.4372449"
export TEST_KEY="your-private-key-here"
```

## Expected Test Results

### Successful Test Output
```
🚀 Complete Contract Execution Test
===================================

📊 Step 1: Checking initial contract ratios...
🔍 Checking Contract Ratios
============================
📋 Contract: 0.0.6216949
🌐 Network: testnet

📊 Current Token Ratios:
Token      | Ratio | Symbol
-----------|-------|-------
HBAR       | 50    | ♦️
WBTC       | 4     | ₿
SAUCE      | 30    | 🥫
USDC       | 30    | 💵
JAM        | 30    | 🍯
HEADSTART  | 20    | 🚀

🗳️  Step 2: Sending test vote...
🚀 Sending Test Vote to Governance Agent
=========================================
📝 Vote Details: [vote JSON]
📨 Sending vote to topic: 0.0.6110235
✅ Vote sent successfully!
📋 Sequence number: 16

⏳ Step 4: Monitoring for contract execution...
🎯 Found recent contract execution: 1750xxxxx.xxxxxx

🔍 Step 5: Verifying transaction...
📋 Transaction Details:
  Transaction ID: 1750xxxxx.xxxxxx
  Result: SUCCESS
  Timestamp: 2025-01-24T...
  Fee: 1234567 tinybars
✅ Transaction executed successfully!

==================================================
🏁 TEST RESULTS SUMMARY
==================================================
✅ Initial Ratios Read: Success
✅ Vote Sent: Success (seq: 16)
✅ Contract Execution: Found (tx: 1750xxxxx.xxxxxx)
✅ Transaction Verified: Success
✅ Final Ratios Read: Success

🎉 SUCCESS! Contract execution test completed successfully!
🔗 Transaction: https://hashscan.io/testnet/transaction/1750xxxxx.xxxxxx
🔗 Contract: https://hashscan.io/testnet/contract/0.0.6216949
```

## File Structure

```
standards-agent-kit/examples/lynx-agent/
├── send-test-vote.js              # Send multi-ratio vote
├── check-contract-ratios.js       # Query contract ratios  
├── test-contract-execution.js     # Monitor contract execution
├── run-contract-test.js           # Complete test workflow
├── CONTRACT_TESTING.md            # Basic usage guide
└── GOVERNANCE_CONTRACT_TESTING.md # This comprehensive guide
```

## Links & Resources

- **Contract**: https://hashscan.io/testnet/contract/0.0.6216949
- **Governance Topic**: https://hashscan.io/testnet/topic/0.0.6110235
- **Heroku App**: https://dashboard.heroku.com/apps/lynx-agents
- **Mirror Node API**: https://testnet.mirrornode.hedera.com

## Contract Interface

The governance agent calls this contract function:
```solidity
function updateRatios(
    uint256 hbarRatio,
    uint256 wbtcRatio, 
    uint256 sauceRatio,
    uint256 usdcRatio,
    uint256 jamRatio,
    uint256 headstartRatio
) external;
```

Ratio values are in the range 1-100, representing the relative weights of each token in the index. 
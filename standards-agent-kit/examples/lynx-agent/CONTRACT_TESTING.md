# Contract Execution Testing

This directory contains scripts to test the governance agent's contract execution functionality.

## Prerequisites

1. **Environment Variables**: Set your test account credentials:
   ```bash
   export TEST_ACCOUNT="0.0.4372449"
   export TEST_KEY="your-private-key-here"
   ```

2. **Governance Agent**: Ensure the governance agent is deployed and running on Heroku with:
   - Contract ID configured: `0.0.6216949`
   - Monitoring topic: `0.0.6110235`

## Available Scripts

### 1. Check Contract Ratios
```bash
npm run lynx-agent:check-contract
```
Queries the contract to display current token ratios.

### 2. Send Test Vote
```bash
npm run lynx-agent:send-test-vote
```
Sends a `MULTI_RATIO_VOTE` message to the governance agent with enough voting power to reach quorum.

### 3. Monitor Contract Execution
```bash
npm run lynx-agent:test-contract-execution
```
Monitors the contract for recent execution transactions and verifies results.

### 4. Complete Test (Recommended)
```bash
npm run lynx-agent:run-contract-test
```
Runs the complete workflow:
1. ✅ Checks initial contract ratios
2. 🗳️ Sends test vote
3. 👁️ Shows how to monitor Heroku logs
4. ⏳ Monitors for contract execution
5. 🔍 Verifies transaction results
6. 📊 Checks final contract ratios

## Test Workflow

1. **Start monitoring Heroku logs** (in separate terminal):
   ```bash
   heroku logs --tail --app lynx-agents
   ```

2. **Run the complete test**:
   ```bash
   npm run lynx-agent:run-contract-test
   ```

3. **Watch for these log messages**:
   - ✅ `Found MULTI_RATIO_VOTE message`
   - ✅ `Processing multi-ratio vote`
   - ✅ `Quorum reached`
   - ✅ `Contract updateRatios executed successfully`
   - ✅ `Transaction ID: [actual-transaction-id]`

## Expected Results

If everything works correctly, you should see:
- ✅ Vote sent successfully
- ✅ Contract execution detected
- ✅ Transaction verified on HashScan
- ✅ Contract ratios updated

## Troubleshooting

### Vote not detected
- Check Heroku logs for processing messages
- Verify governance agent is running
- Ensure vote has enough voting power (250,000)

### Contract execution fails
- Check that `GOVERNANCE_CONTRACT_ID` is set on Heroku
- Verify Hedera client access in governance agent
- Check transaction fees and account balance

### Transaction not found
- Contract execution may be delayed
- Check HashScan for pending transactions
- Verify contract ID is correct (`0.0.6216949`)

## Links

- **Contract**: https://hashscan.io/testnet/contract/0.0.6216949
- **Governance Topic**: https://hashscan.io/testnet/topic/0.0.6110235
- **Heroku App**: https://dashboard.heroku.com/apps/lynx-agents

## Test Vote Format

The test sends this message format:
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
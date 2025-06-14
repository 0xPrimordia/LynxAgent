# Vault Contract Integration for Governance Agent

The Lynx Governance Agent now supports automatic execution of vault contract updates when quorum is reached for token composition changes.

## Overview

When the governance agent detects that quorum has been reached for a parameter change related to token weights (`treasury.weights.*`), it will automatically call the vault contract's `setComposition` function to update the token composition on-chain.

## Configuration

### Environment Variables

Add these environment variables to configure vault contract integration:

```bash
# Vault contract address on Hashio testnet
VAULT_CONTRACT_ADDRESS=0xf63c0858c57ec70664Dfb02792F8AB09Fe3F0b94

# Private key for the governance agent (should have admin rights on vault contract)  
AGENT_PRIVATE_KEY=your_agent_private_key_here
```

### CLI Options

When starting the governance agent, use these new options:

```bash
npm run lynx-agent:start-governance -- \
  --account-id 0.0.YOUR_ACCOUNT \
  --private-key YOUR_HEDERA_PRIVATE_KEY \
  --outbound-topic 0.0.YOUR_OUTBOUND_TOPIC \
  --rebalancer-id 0.0.YOUR_REBALANCER_ACCOUNT \
  --vault-address 0xf63c0858c57ec70664Dfb02792F8AB09Fe3F0b94 \
  --agent-key YOUR_AGENT_PRIVATE_KEY \
  --log-level info
```

## Contract Interface

The governance agent interacts with the vault contract using this interface:

```solidity
struct Asset {
    address token;
    uint16 weight; // in basis points (e.g., 5000 = 50%)
}

function setComposition(Asset[] calldata _composition) external onlyAdmin
```

## Token Address Mapping

The agent currently uses placeholder addresses for tokens. Update the `TOKEN_ADDRESSES` mapping in `GovernanceAgent.ts`:

```typescript
const TOKEN_ADDRESSES: Record<string, string> = {
  'HBAR': '0x0000000000000000000000000000000000000000', // WHBAR address
  'HSUITE': '0x0000000000000000000000000000000000000001', // Replace with actual address
  'SAUCERSWAP': '0x0000000000000000000000000000000000000002', // Replace with actual address
  'HTS': '0x0000000000000000000000000000000000000003', // Replace with actual address
  'HELI': '0x0000000000000000000000000000000000000004', // Replace with actual address
  'KARATE': '0x0000000000000000000000000000000000000005', // Replace with actual address
  'HASHPACK': '0x0000000000000000000000000000000000000006', // Replace with actual address
};
```

## How It Works

1. **Vote Processing**: The governance agent monitors for parameter votes on the inbound topic
2. **Quorum Check**: When votes are submitted, the agent checks if quorum has been reached
3. **Parameter Update**: If quorum is reached, the agent updates the governance parameters
4. **Vault Contract Call**: For token weight changes, the agent automatically calls `setComposition` on the vault contract
5. **Transaction Recording**: The transaction hash is recorded in the parameter change history
6. **Result Publishing**: The vote result is published to the outbound topic

## Error Handling

- If the vault contract call fails, the governance parameter change still proceeds
- Errors are logged and the agent continues operating
- The transaction ID is only included if the vault contract call succeeds

## Security Considerations

- The agent private key should have admin privileges on the vault contract
- The private key should be kept secure and not exposed in logs
- Contract interactions use the Hashio testnet endpoint: `https://testnet.hashio.io/api`

## Testing

To test the vault contract integration:

1. Deploy a vault contract with the governance agent as admin
2. Start the governance agent with vault configuration
3. Submit a vote for a token weight parameter change
4. Verify that the vault contract is updated when quorum is reached

## Supported Parameter Types

Currently, the vault contract integration only triggers for parameters starting with `treasury.weights`, such as:

- `treasury.weights.HBAR`
- `treasury.weights.HSUITE`
- `treasury.weights.SAUCERSWAP`
- etc.

Other parameter types (fees, rebalancing settings, etc.) will only update the governance state without triggering vault contract calls. 
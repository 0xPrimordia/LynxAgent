/**
 * Example configuration for test tokens used in the Lynx Governance Agent
 * Copy this file to test-token-config.ts and update with your actual token addresses
 */

import { TokenMetadata } from './GovernanceAgent';

export const testTokenConfig: TokenMetadata[] = [
  // HBAR (Native testnet token)
  {
    symbol: 'HBAR',
    name: 'HBAR (Testnet)',
    tokenId: 'HBAR', // Native token
    decimals: 8,
    isTestToken: true,
    description: 'Native Hedera token on testnet'
  },
  // SAUCE (Existing testnet token - we didn't create this one)
  {
    symbol: 'SAUCE',
    name: 'SaucerSwap Token (Testnet)',
    tokenId: '0.0.1183558',
    decimals: 6,
    isTestToken: true,
    description: 'SaucerSwap DEX token on testnet'
  },
  // WBTC (Test token we created)
  {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin (Test)',
    tokenId: '0.0.6212930',
    decimals: 8,
    isTestToken: true,
    description: 'Test WBTC token for development'
  },
  // USDC (Test token we created)
  {
    symbol: 'USDC',
    name: 'USD Coin (Test)',
    tokenId: '0.0.6212931',
    decimals: 6,
    isTestToken: true,
    description: 'Test USDC token for development'
  },
  // JAM (Test token we created)
  {
    symbol: 'JAM',
    name: 'Jam Token (Test)',
    tokenId: '0.0.6212932',
    decimals: 8,
    isTestToken: true,
    description: 'Test JAM token for development'
  },
  // HEADSTART (Test token we created)
  {
    symbol: 'HEADSTART',
    name: 'HeadStarter (Test)',
    tokenId: '0.0.6212933',
    decimals: 8,
    isTestToken: true,
    description: 'Test HEADSTART token for development'
  },
  // LYNX (Main token - target for minting)
  {
    symbol: 'LYNX',
    name: 'Lynx Index Token',
    tokenId: '0.0.6200902',
    decimals: 8,
    isTestToken: true, // Since we're on testnet
    description: 'Lynx Index Token - the main token for the index fund'
  }
];

/**
 * Example usage in governance agent initialization:
 * 
 * import { testTokenConfig } from './test-token-config';
 * 
 * const governanceAgent = new GovernanceAgent({
 *   client: hcs10Client,
 *   accountId: '0.0.123456',
 *   // ... other config
 *   testTokens: testTokenConfig
 * });
 */ 
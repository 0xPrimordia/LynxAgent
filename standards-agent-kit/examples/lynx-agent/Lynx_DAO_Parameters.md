# Lynx DAO Parameters

## Functional Parameters

* **Rebalancing Frequency**: How often rebalancing checks occur.
* **Rebalancing Thresholds**: Tolerance for ratio deviation before triggering rebalance.
* **Eligible Token Criteria**: Requirements a token must meet to be considered.
* **Governance Quorum**: % of staked LYNX needed for a decision to pass.
* **Voting Period**: Duration of each governance vote.
* **Sector Definitions**: Categorization of tokens by industry.
* **Token Ratio Rules**: Constraints or caps on how much a single token or sector can dominate.
* **Max Number of Tokens**: Maximum number of tokens allowed in the index.
* **Min/Max Sector Weights**: Boundaries for how much weight a sector can have.
* **Minting/Burning Fees**: Fee rates charged for entering or exiting the index.
* **Rewards Allocation Policy**: How any protocol fees are distributed.
* **Staking Lock Period**: How long staked LYNX must be held.
* **Reward Multiplier Parameters**: How multipliers for staking or governance work.
* **Rebalancing Method**: Whether rebalances are gradual, all-at-once, etc.
* **Emergency Override Parameters**: DAO ability to pause or intervene.
* **Treasury Allocation Rules**: How treasury funds are used or allocated.

## State Parameters

* **Current Token List**: All tokens in the index.
* **Current Token Ratios**: Current target allocations of each token.
* **Current Sector Assignments**: Which token belongs to which sector.
* **Current Sector Weights**: Proportional importance of each sector.
* **Active DAO Policies**: Current governance rules in effect.
* **Stakeholder Voting Records**: Historical or active votes.

## Default Sectors

Lynx will launch with the following predefined sectors:

1. **Core Hedera**

   * Token(s): HBAR only
2. **Smart Contract Platforms**

   * Example: Wrapped BTC (e.g. wBTC)
3. **DeFi & DEX Tokens**

   * Example: SAUCE, HELI, etc.
4. **Stablecoins**

   * Example: USDC, USDT, DAI
5. **Enterprise & Utility Tokens**

   * Example: JAM, DOVU
6. **GameFi & NFT Infrastructure**

   * Example: ASH, HEADSTART, etc.

Each sector will be populated based on market cap and liquidity-adjusted ratios.

## Index Composition Formula

Token weights at launch and during rebalancing are calculated as:

```
Weight(token) = (MarketCap(token_wrapped) / TotalSectorMarketCap) * SectorWeight
```

Where:

* `token_wrapped` is used in place of native asset market cap if token is wrapped.
* `TotalSectorMarketCap` = Sum of market caps for all tokens in that sector.
* `SectorWeight` = Predefined weight for the sector (default is equal weighting unless overridden).
* Liquidity Adjustment: If applicable, a multiplier based on the relative liquidity score from SaucerSwap (e.g., pool size, slippage tolerance) can reduce weight slightly for less liquid tokens.

### Example Adjustment with Liquidity:

```
LiquidityFactor(token) = min(1, Liquidity(token) / AvgLiquidity(sector))
AdjustedWeight = Weight(token) * LiquidityFactor(token)
```

## Recommendations Agent Guidelines

The agent will use the above formula to:

* Monitor market cap and liquidity changes via price oracles and SaucerSwap APIs.
* Detect when token weights deviate from calculated targets beyond a threshold (e.g. 5% drift).
* Suggest token additions/removals based on eligibility criteria.
* Recommend new sector weights or token ratios following trends or fundamental shifts.
* Propose rebalancing triggers when DAO parameters are violated (e.g. if a sector breaches min/max bounds).

Inputs to the agent:

* Token market caps (wrapped on Hedera)
* Sector assignments
* Liquidity data from SaucerSwap (e.g., pool size, volume)
* DAO-set policies like min/max bounds, rebalancing frequency

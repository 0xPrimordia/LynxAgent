# Lynx Advisor Agent

The **Lynx Advisor Agent** is a strategic intelligence module that complements the Sentinel, Rebalancer, and Governance agents by providing data-driven recommendations, educational content, and optimal parameter suggestions for the Lynx DAO.

## Overview

The Advisor Agent serves three primary roles:

1. **Strategic Intelligence Module** - Analyzes market data and provides optimal parameter recommendations
2. **Educational Assistant** - Converts complex recommendations into natural language tips for DAO members  
3. **Recommender System** - Suggests initial launch parameters and evaluates ongoing DAO settings

## Key Responsibilities

### 1. Launch Parameter Recommendations

- **Token Data Analysis**: Pulls market cap, liquidity, and volume data from sources like SaucerSwap, HashScan, and Hedera Mirror Nodes
- **Lynx Formula Application**: Applies the formula from `Lynx_DAO_Parameters.md` to compute optimal token ratios and sector weights
- **Sector Selection**: Recommends top token from each sector (max 1 token per sector for launch)
- **Risk Assessment**: Evaluates portfolio risk and provides confidence scores

### 2. DAO Settings Evaluation

- **Parameter Monitoring**: Continuously compares current DAO parameters to "ideal" values under current market conditions
- **Drift Detection**: Flags when parameters deviate from optimal ranges
- **Efficiency Analysis**: Identifies outdated or inefficient parameter configurations
- **Market Adaptation**: Recommends adjustments based on changing market conditions

### 3. Educational Guidance

- **Natural Language Tips**: Converts technical recommendations into accessible guidance for DAO members
- **Parameter Education**: Explains the impact and importance of different DAO parameters
- **Strategic Insights**: Provides context and reasoning behind recommendations
- **Dashboard Guidance**: Offers user-friendly explanations for complex concepts

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Advisor Agent                              │
├─────────────────────────────────────────────────────────────────┤
│  Market Analysis Engine                                         │
│  • SaucerSwap API Integration                                   │
│  • HashScan Data Fetching                                       │
│  • Hedera Mirror Node Queries                                   │
│  • Lynx Formula Implementation                                  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Recommendation Engine                           │
├─────────────────────────────────────────────────────────────────┤
│  • Parameter Optimization                                       │
│  • Risk Assessment                                              │
│  • Confidence Scoring                                           │
│  • Educational Content Generation                               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                 HCS-10 Integration                              │
├─────────────────────────────────────────────────────────────────┤
│  • Governance State Monitoring                                  │
│  • Recommendation Publishing                                    │
│  • Standards SDK Compliance                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### Market Data Integration

- **Real-time Analysis**: Continuous monitoring of token markets and liquidity
- **Multi-source Data**: Integrates data from SaucerSwap, HashScan, and Mirror Nodes
- **Sector-based Analysis**: Organizes tokens by sector for balanced portfolio construction
- **Liquidity Scoring**: Evaluates token liquidity for rebalancing efficiency

### Intelligent Recommendations

- **Launch Parameters**: Suggests optimal initial DAO configuration
- **Dynamic Adjustments**: Recommends parameter changes based on market conditions
- **Confidence Scoring**: Provides reliability metrics for each recommendation
- **Impact Assessment**: Categorizes recommendations by urgency and impact level

### Educational Support

- **Parameter Explanations**: Natural language descriptions of DAO parameters
- **Strategy Guidance**: Insights into effective DAO governance strategies
- **Risk Education**: Explanations of portfolio and governance risks
- **Best Practices**: Recommendations for optimal DAO participation

## Launch Configuration

### Sector Definitions (Launch Constraints)

Based on `Lynx_DAO_Parameters.md`, the advisor uses predefined sectors with **maximum 1 token per sector** for launch:

1. **Core Hedera** (35% weight)
   - Tokens: HBAR
   - Rationale: Foundation of the Hedera ecosystem

2. **Stablecoins** (20% weight)  
   - Tokens: USDC, USDT, DAI
   - Rationale: Stability and reduced volatility

3. **DeFi & DEX** (20% weight)
   - Tokens: SAUCE, HELI
   - Rationale: Exposure to DeFi growth

4. **Enterprise & Utility** (15% weight)
   - Tokens: HTS, HSUITE, HASHPACK, JAM, DOVU
   - Rationale: Real-world utility and adoption

5. **GameFi & NFT** (10% weight)
   - Tokens: ASH, HEADSTART
   - Rationale: Emerging gaming and NFT markets

### Lynx Formula Implementation

The advisor applies the formula from the DAO parameters document:

```
Weight(token) = (MarketCap(token) / TotalSectorMarketCap) * SectorWeight

LiquidityFactor(token) = min(1, Liquidity(token) / AvgLiquidity(sector))
AdjustedWeight = Weight(token) * LiquidityFactor(token)
```

## Message Types

The Advisor Agent publishes several message types to its outbound topic:

### Launch Recommendations
```json
{
  "type": "LAUNCH_RECOMMENDATIONS",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "recommendations": [ParameterRecommendation[]],
    "sectorAnalysis": [SectorAnalysis[]],
    "selectedTokens": [TokenData[]],
    "estimatedTVL": 150000000,
    "riskAssessment": "Risk Level: Low..."
  }
}
```

### Parameter Evaluation
```json
{
  "type": "PARAMETER_EVALUATION", 
  "timestamp": "2024-01-15T10:30:00Z",
  "recommendations": [ParameterRecommendation[]],
  "summary": {
    "totalRecommendations": 5,
    "highUrgency": 1,
    "highImpact": 2
  }
}
```

### Educational Tips
```json
{
  "type": "EDUCATIONAL_TIPS",
  "timestamp": "2024-01-15T10:30:00Z", 
  "tips": [EducationalTip[]],
  "summary": {
    "totalTips": 3,
    "highRelevance": 2,
    "categories": ["parameter", "strategy", "risk"]
  }
}
```

## Usage

### Registration

```bash
# Set environment variables
export ADVISOR_ACCOUNT=0.0.123456
export ADVISOR_KEY=your-private-key
export HEDERA_NETWORK=testnet
export GOVERNANCE_OUTBOUND_TOPIC=0.0.789102  # Optional

# Register the agent
npx tsx register-advisor.ts
```

### Basic Usage

```typescript
import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { AdvisorAgent } from './AdvisorAgent';

// Create client and agent
const client = new HCS10Client(accountId, privateKey, 'testnet');
const advisor = new AdvisorAgent({
  client,
  accountId,
  inboundTopicId,
  outboundTopicId,
  governanceTopicId, // Optional: to monitor governance state
  updateFrequency: 60, // Minutes between analyses
});

// Initialize and start
await advisor.initialize();
await advisor.start();

// Generate launch recommendations
const launchParams = await advisor.generateLaunchRecommendations();
```

### Integration with Other Agents

The Advisor Agent integrates seamlessly with other Lynx agents:

- **Governance Agent**: Monitors governance state via HCS topics
- **Rebalancer Agent**: Provides optimal rebalancing parameters  
- **Sentinel Agent**: Offers risk assessment for monitoring thresholds

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ADVISOR_ACCOUNT` | Hedera account ID for the advisor agent | Yes |
| `ADVISOR_KEY` | Private key for the advisor agent | Yes |
| `ADVISOR_INBOUND_TOPIC` | Topic ID for incoming messages | Yes |
| `ADVISOR_OUTBOUND_TOPIC` | Topic ID for publishing recommendations | Yes |
| `GOVERNANCE_OUTBOUND_TOPIC` | Governance agent's outbound topic (for monitoring) | No |
| `HEDERA_NETWORK` | Network to connect to (testnet/mainnet) | No |
| `OPENAI_API_KEY` | OpenAI API key for AI-powered analysis | No |

### Update Frequency

The advisor can be configured with different analysis frequencies:

- **Launch Phase**: High frequency (every 30 minutes) for rapid optimization
- **Stable Operation**: Standard frequency (every 2-4 hours) for efficiency
- **Low Activity**: Reduced frequency (daily) to minimize costs

## Data Sources

### Market Data APIs

1. **SaucerSwap API**
   - Pool liquidity data
   - Trading volume metrics
   - Slippage calculations

2. **HashScan API**
   - Token information and metadata
   - Historical price data
   - Market cap calculations

3. **Hedera Mirror Nodes**
   - Transaction volume analysis
   - Token holder distributions
   - Network activity metrics

### Governance Data

- **HCS-10 Messages**: Monitors governance state from governance agent
- **Parameter History**: Tracks changes over time
- **Voting Patterns**: Analyzes DAO member preferences

## Benefits

### For the DAO
- **Optimal Launch**: Data-driven parameter selection for successful launch
- **Continuous Optimization**: Ongoing parameter refinement based on market conditions
- **Risk Management**: Proactive identification of potential issues
- **Member Education**: Improved participation through better understanding

### For DAO Members  
- **Informed Decisions**: Clear explanations of parameter impacts
- **Strategic Guidance**: Understanding of optimal governance strategies
- **Simplified Interface**: Complex analysis presented in accessible format
- **Confidence Building**: Evidence-based recommendations with confidence scores

### For the Ecosystem
- **Market Efficiency**: Parameters aligned with current market conditions
- **Reduced Risk**: Systematic approach to parameter management
- **Transparency**: Open analysis and recommendation process
- **Innovation**: Continuous improvement through data-driven insights

## Future Enhancements

- **Advanced AI Integration**: Machine learning models for prediction
- **Multi-chain Analysis**: Cross-chain market data integration
- **Real-time Alerts**: Immediate notifications for critical parameter drifts
- **Custom Strategies**: User-defined analysis and recommendation strategies
- **Historical Analysis**: Long-term trend analysis and pattern recognition

---

The Advisor Agent represents a sophisticated approach to DAO parameter management, combining market intelligence with educational support to optimize the Lynx DAO's performance and member experience. 
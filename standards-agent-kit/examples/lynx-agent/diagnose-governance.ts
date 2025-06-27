/**
 * Comprehensive governance system diagnostics
 */

import { config } from 'dotenv';

// Load environment variables
config();

interface DiagnosticResult {
  component: string;
  status: 'WORKING' | 'ISSUE' | 'UNKNOWN';
  details: string[];
  recommendations?: string[];
}

async function runDiagnostics(): Promise<void> {
  console.log('🔍 Governance System Diagnostics');
  console.log('=================================');
  console.log('');

  const results: DiagnosticResult[] = [];

  // 1. Check Heroku app status
  console.log('1️⃣  Checking Heroku app status...');
  try {
    // We can't directly check Heroku status, but we can check if the governance agent is responding
    results.push({
      component: 'Heroku App',
      status: 'UNKNOWN',
      details: ['Run: heroku ps --app lynx-agents to check if worker is running'],
      recommendations: ['If not running: heroku restart --app lynx-agents']
    });
  } catch (error) {
    results.push({
      component: 'Heroku App',
      status: 'ISSUE',
      details: [`Error: ${error}`]
    });
  }

  // 2. Check governance account exists
  console.log('2️⃣  Checking governance account...');
  try {
    const response = await fetch('https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.6110233');
    if (response.ok) {
      const data = await response.json();
      const recentTxs = data.transactions?.length || 0;
      results.push({
        component: 'Governance Account',
        status: 'WORKING',
        details: [
          `Account: 0.0.6110233`,
          `Balance: ${(data.balance?.balance / 100000000).toFixed(2)} HBAR`,
          `Recent transactions: ${recentTxs}`
        ]
      });
    } else {
      results.push({
        component: 'Governance Account',
        status: 'ISSUE',
        details: [`Mirror node error: ${response.status}`]
      });
    }
  } catch (error) {
    results.push({
      component: 'Governance Account',
      status: 'ISSUE',
      details: [`Error: ${error}`]
    });
  }

  // 3. Check inbound topic for votes
  console.log('3️⃣  Checking inbound topic for recent votes...');
  try {
    const response = await fetch('https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.6110235/messages?limit=10');
    if (response.ok) {
      const data = await response.json();
      const messages = data.messages || [];
      let voteCount = 0;
      
      for (const msg of messages) {
        try {
          const decoded = Buffer.from(msg.message, 'base64').toString('utf-8');
          if (decoded.includes('MULTI_RATIO_VOTE') || decoded.includes('PARAMETER_VOTE')) {
            voteCount++;
          }
        } catch (e) {
          // Ignore decode errors
        }
      }
      
      results.push({
        component: 'Inbound Topic (Votes)',
        status: voteCount > 0 ? 'WORKING' : 'UNKNOWN',
        details: [
          `Topic: 0.0.6110235`,
          `Total messages: ${messages.length}`,
          `Vote messages found: ${voteCount}`,
          `Latest message: ${messages[0]?.consensus_timestamp || 'None'}`
        ]
      });
    } else {
      results.push({
        component: 'Inbound Topic',
        status: 'ISSUE',
        details: [`Mirror node error: ${response.status}`]
      });
    }
  } catch (error) {
    results.push({
      component: 'Inbound Topic',
      status: 'ISSUE',
      details: [`Error: ${error}`]
    });
  }

  // 4. Check outbound topic for governance responses
  console.log('4️⃣  Checking outbound topic for governance responses...');
  try {
    const response = await fetch('https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.6110234/messages?limit=10');
    if (response.ok) {
      const data = await response.json();
      const messages = data.messages || [];
      let responseCount = 0;
      
      for (const msg of messages) {
        try {
          const decoded = Buffer.from(msg.message, 'base64').toString('utf-8');
          if (decoded.includes('state_snapshot') || decoded.includes('vote_result')) {
            responseCount++;
          }
        } catch (e) {
          // Ignore decode errors
        }
      }
      
      results.push({
        component: 'Outbound Topic (Responses)',
        status: responseCount > 0 ? 'WORKING' : 'ISSUE',
        details: [
          `Topic: 0.0.6110234`,
          `Total messages: ${messages.length}`,
          `Response messages found: ${responseCount}`,
          `Latest message: ${messages[0]?.consensus_timestamp || 'None'}`
        ],
        recommendations: responseCount === 0 ? ['Agent may not be publishing responses due to INVALID_SIGNATURE errors'] : undefined
      });
    } else {
      results.push({
        component: 'Outbound Topic',
        status: 'ISSUE',
        details: [`Mirror node error: ${response.status}`]
      });
    }
  } catch (error) {
    results.push({
      component: 'Outbound Topic',
      status: 'ISSUE',
      details: [`Error: ${error}`]
    });
  }

  // 5. Check contract execution history
  console.log('5️⃣  Checking contract execution history...');
  try {
    const response = await fetch('https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.6216949/results?limit=5');
    if (response.ok) {
      const data = await response.json();
      const results_data = data.results || [];
      
      // Check for recent executions (last 24 hours)
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const recentExecutions = results_data.filter((r: any) => 
        new Date(r.timestamp).getTime() > oneDayAgo
      );
      
      results.push({
        component: 'Contract Execution',
        status: recentExecutions.length > 0 ? 'WORKING' : 'ISSUE',
        details: [
          `Contract: 0.0.6216949`,
          `Total executions: ${results_data.length}`,
          `Recent executions (24h): ${recentExecutions.length}`,
          `Latest execution: ${results_data[0]?.timestamp || 'None'}`
        ],
        recommendations: recentExecutions.length === 0 ? ['No recent contract executions - check if votes are reaching quorum'] : undefined
      });
    } else {
      results.push({
        component: 'Contract Execution',
        status: 'ISSUE',
        details: [`Mirror node error: ${response.status}`]
      });
    }
  } catch (error) {
    results.push({
      component: 'Contract Execution',
      status: 'ISSUE',
      details: [`Error: ${error}`]
    });
  }

  // 6. Check current contract ratios
  console.log('6️⃣  Checking current contract ratios...');
  try {
    const checkContractRatiosModule = await import('./check-contract-ratios');
    const checkContractRatios = checkContractRatiosModule.default;
    const ratios = await checkContractRatios();
    
    if (ratios) {
      const total = Object.values(ratios).reduce((sum: number, val: any) => sum + (typeof val === 'number' ? val : 0), 0);
      results.push({
        component: 'Contract State',
        status: 'WORKING',
        details: [
          `Contract readable: Yes`,
          `Total ratios: ${total}`,
          `HBAR: ${ratios.HBAR}, WBTC: ${ratios.WBTC}, SAUCE: ${ratios.SAUCE}`,
          `USDC: ${ratios.USDC}, JAM: ${ratios.JAM}, HEADSTART: ${ratios.HEADSTART}`
        ]
      });
    } else {
      results.push({
        component: 'Contract State',
        status: 'ISSUE',
        details: ['Unable to read contract ratios']
      });
    }
  } catch (error) {
    results.push({
      component: 'Contract State',
      status: 'ISSUE',
      details: [`Error: ${error}`]
    });
  }

  // Display results
  console.log('');
  console.log('📋 Diagnostic Results:');
  console.log('======================');
  
  for (const result of results) {
    const statusIcon = result.status === 'WORKING' ? '✅' : result.status === 'ISSUE' ? '❌' : '⚠️';
    console.log(`${statusIcon} ${result.component}: ${result.status}`);
    
    for (const detail of result.details) {
      console.log(`   ${detail}`);
    }
    
    if (result.recommendations) {
      console.log(`   💡 Recommendations:`);
      for (const rec of result.recommendations) {
        console.log(`      - ${rec}`);
      }
    }
    console.log('');
  }

  // Summary
  const workingCount = results.filter(r => r.status === 'WORKING').length;
  const issueCount = results.filter(r => r.status === 'ISSUE').length;
  const unknownCount = results.filter(r => r.status === 'UNKNOWN').length;

  console.log('📊 Summary:');
  console.log(`   ✅ Working: ${workingCount}`);
  console.log(`   ❌ Issues: ${issueCount}`);
  console.log(`   ⚠️  Unknown: ${unknownCount}`);
  console.log('');

  if (issueCount === 0) {
    console.log('🎉 All systems appear to be working correctly!');
  } else if (workingCount > issueCount) {
    console.log('⚠️  System is mostly functional with some issues to address.');
  } else {
    console.log('❌ System has significant issues that need attention.');
  }

  console.log('');
  console.log('🔧 Next Steps:');
  console.log('1. Check Heroku logs: heroku logs --tail --app lynx-agents');
  console.log('2. Send a test vote: npm run lynx-agent:send-test-vote');
  console.log('3. Monitor contract execution: npm run lynx-agent:test-contract-execution');
  console.log('4. Run full test: npm run lynx-agent:run-contract-test');
}

// Run diagnostics
runDiagnostics().catch(console.error); 
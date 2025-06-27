#!/usr/bin/env tsx

/**
 * Complete Contract Test Runner
 * 
 * This script runs the complete end-to-end test:
 * 1. Checks initial contract state
 * 2. Sends a test vote
 * 3. Monitors for contract execution
 * 4. Verifies the final state
 */

import { config } from 'dotenv';
import sendTestVote from './send-test-vote.js';
import checkContractRatios from './check-contract-ratios.js';
import ContractExecutionTester from './test-contract-execution.js';

// Load environment variables
config();

// Test configuration interface
interface TestRunConfig {
  WAIT_BEFORE_CHECK: number;
  WAIT_AFTER_VOTE: number;
  MAX_RETRIES: number;
}

const CONFIG: TestRunConfig = {
  WAIT_BEFORE_CHECK: 5000,   // 5 seconds
  WAIT_AFTER_VOTE: 30000,    // 30 seconds  
  MAX_RETRIES: 3
};

/**
 * Complete contract test runner
 */
class ContractTestRunner {
  private executionTester: ContractExecutionTester;

  constructor() {
    this.executionTester = new ContractExecutionTester();
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Run the complete test workflow
   */
  async runCompleteTest(): Promise<boolean> {
    console.log('🚀 Starting Complete Contract Test');
    console.log('==================================');
    console.log('This test will:');
    console.log('1. Check initial contract ratios');
    console.log('2. Send a MULTI_RATIO_VOTE');
    console.log('3. Wait for governance agent processing');
    console.log('4. Verify contract execution');
    console.log('5. Check final contract ratios');
    console.log('');

    try {
      // Step 1: Check initial contract state
      console.log('📊 Step 1: Checking initial contract ratios...');
      const initialRatios = await checkContractRatios();
      
      if (!initialRatios) {
        console.error('❌ Could not read initial contract state');
        return false;
      }
      
      console.log('✅ Initial contract state recorded');
      await this.sleep(CONFIG.WAIT_BEFORE_CHECK);

      // Step 2: Send test vote
      console.log('\n🗳️  Step 2: Sending test vote...');
      const voteSequence = await sendTestVote();
      
      if (!voteSequence) {
        console.error('❌ Failed to send test vote');
        return false;
      }
      
      console.log(`✅ Vote sent successfully (sequence: ${voteSequence})`);

      // Step 3: Wait for processing
      console.log(`\n⏳ Step 3: Waiting ${CONFIG.WAIT_AFTER_VOTE / 1000} seconds for governance agent processing...`);
      await this.sleep(CONFIG.WAIT_AFTER_VOTE);

      // Step 4: Monitor for contract execution
      console.log('\n👁️  Step 4: Monitoring for contract execution...');
      const executionResult = await this.executionTester.monitorContractExecution(180000); // 3 minutes
      
      let contractExecuted = false;
      if (executionResult) {
        console.log(`✅ Contract execution detected: ${executionResult}`);
        
        // Verify the transaction
        const txVerified = await this.executionTester.verifyTransaction(executionResult);
        if (txVerified) {
          console.log('✅ Transaction verified successfully');
          contractExecuted = true;
        } else {
          console.log('❌ Transaction verification failed');
        }
      } else {
        console.log('⏰ No contract execution detected within timeout');
      }

      // Step 5: Check final contract state
      console.log('\n📊 Step 5: Checking final contract ratios...');
      const finalRatios = await checkContractRatios();
      
      if (!finalRatios) {
        console.error('❌ Could not read final contract state');
        return false;
      }

      // Step 6: Compare results
      console.log('\n📈 Step 6: Comparing results...');
      const changesDetected = this.compareRatios(initialRatios, finalRatios);
      
      // Final assessment
      console.log('\n🏁 Test Results Summary:');
      console.log('========================');
      console.log(`Vote Sent: ✅`);
      console.log(`Contract Execution: ${contractExecuted ? '✅' : '❌'}`);
      console.log(`Ratio Changes: ${changesDetected ? '✅' : '❌'}`);
      
      const overallSuccess = contractExecuted && changesDetected;
      
      if (overallSuccess) {
        console.log('\n🎉 SUCCESS: Complete contract test passed!');
        console.log('The governance agent successfully:');
        console.log('  - Detected the MULTI_RATIO_VOTE');
        console.log('  - Processed the vote and reached quorum');
        console.log('  - Executed the contract updateRatios function');
        console.log('  - Updated the on-chain token ratios');
        
        if (executionResult) {
          console.log(`\n🔗 Transaction: https://hashscan.io/testnet/transaction/${executionResult}`);
        }
        console.log(`🔗 Contract: https://hashscan.io/testnet/contract/0.0.6216949`);
      } else {
        console.log('\n⚠️  PARTIAL SUCCESS: Some issues detected');
        
        if (!contractExecuted) {
          console.log('❌ Contract execution was not detected');
          console.log('   This could mean:');
          console.log('   - Governance agent is not running');
          console.log('   - Vote didn\'t reach quorum');
          console.log('   - Contract execution failed');
          console.log('   - Network delays');
        }
        
        if (!changesDetected) {
          console.log('❌ No ratio changes detected');
          console.log('   This could mean:');
          console.log('   - Contract execution didn\'t complete');
          console.log('   - Changes are still propagating');
          console.log('   - Test ratios were same as existing');
        }
        
        console.log('\n📋 Troubleshooting:');
        console.log('1. Check Heroku logs: heroku logs --tail --app lynx-agents');
        console.log('2. Verify environment variables are set');
        console.log('3. Check network connectivity');
        console.log('4. Try running individual test components');
      }
      
      return overallSuccess;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('\n💥 Test failed with error:', errorMessage);
      return false;
    }
  }

  /**
   * Compare initial and final ratios to detect changes
   */
  private compareRatios(initial: Record<string, number | string>, final: Record<string, number | string>): boolean {
    let changesFound = false;
    
    console.log('Ratio Comparison:');
    console.log('Token      | Before | After  | Changed');
    console.log('-----------|--------|--------|--------');
    
    const allTokens = Array.from(new Set([...Object.keys(initial), ...Object.keys(final)]));
    
    for (const token of allTokens) {
      const beforeValue = initial[token] || 'N/A';
      const afterValue = final[token] || 'N/A';
      
      const changed = beforeValue !== afterValue;
      if (changed && typeof beforeValue === 'number' && typeof afterValue === 'number') {
        changesFound = true;
      }
      
      const beforeStr = String(beforeValue).padEnd(6);
      const afterStr = String(afterValue).padEnd(6);
      const changedStr = changed ? '✅' : '❌';
      
      console.log(`${token.padEnd(10)} | ${beforeStr} | ${afterStr} | ${changedStr}`);
    }
    
    return changesFound;
  }

  /**
   * Run individual test components for debugging
   */
  async runDebugTests(): Promise<void> {
    console.log('🔧 Running Debug Tests');
    console.log('======================');
    
    try {
      console.log('\n1. Testing contract ratio reading...');
      const ratios = await checkContractRatios();
      console.log(ratios ? '✅ Contract reading works' : '❌ Contract reading failed');
      
      console.log('\n2. Testing vote preparation...');
      const voteSequence = await sendTestVote();
      console.log(voteSequence ? '✅ Vote preparation works' : '❌ Vote preparation failed');
      
      console.log('\n3. Testing contract monitoring...');
      console.log('(This will timeout quickly for testing)');
      const execution = await this.executionTester.monitorContractExecution(10000); // 10 seconds
      console.log(execution ? `✅ Found execution: ${execution}` : '⏰ No recent executions (normal for test)');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Debug test error:', errorMessage);
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const runner = new ContractTestRunner();
  
  // Check command line arguments
  const args = process.argv.slice(2);
  const isDebugMode = args.includes('--debug') || args.includes('-d');
  
  if (isDebugMode) {
    console.log('🔧 Running in debug mode...');
    await runner.runDebugTests();
  } else {
    console.log('🚀 Running complete test...');
    const success = await runner.runCompleteTest();
    
    console.log('\n' + '='.repeat(50));
    console.log(success ? '✅ Complete test PASSED' : '❌ Complete test FAILED');
    console.log('='.repeat(50));
    
    process.exit(success ? 0 : 1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Unhandled error:', errorMessage);
    process.exit(1);
  });
}

export default ContractTestRunner; 
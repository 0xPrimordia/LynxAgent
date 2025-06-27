#!/usr/bin/env node

/**
 * Complete Contract Execution Test Runner
 * 
 * This script runs the complete workflow:
 * 1. Check current contract ratios
 * 2. Send a test vote
 * 3. Monitor for contract execution
 * 4. Verify the results
 */

const checkContractRatios = require('./check-contract-ratios');
const sendTestVote = require('./send-test-vote');
const ContractExecutionTester = require('./test-contract-execution');

async function runCompleteTest() {
  console.log('🚀 Complete Contract Execution Test');
  console.log('===================================');
  
  try {
    // Step 1: Check initial contract state
    console.log('\n📊 Step 1: Checking initial contract ratios...');
    const initialRatios = await checkContractRatios();
    
    // Step 2: Send test vote
    console.log('\n🗳️  Step 2: Sending test vote...');
    const voteSequence = await sendTestVote();
    
    // Step 3: Monitor Heroku logs
    console.log('\n👁️  Step 3: Monitor governance agent activity');
    console.log('Run this command in another terminal:');
    console.log('heroku logs --tail --app lynx-agents');
    console.log('');
    console.log('Look for these messages:');
    console.log('  ✅ "Found MULTI_RATIO_VOTE message"');
    console.log('  ✅ "Processing multi-ratio vote"');
    console.log('  ✅ "Quorum reached"');
    console.log('  ✅ "Contract updateRatios executed successfully"');
    console.log('  ✅ "Transaction ID: [actual-transaction-id]"');
    
    // Step 4: Monitor contract execution
    console.log('\n⏳ Step 4: Monitoring for contract execution...');
    const tester = new ContractExecutionTester();
    const contractTxId = await tester.monitorContractExecution(300000); // 5 minutes
    
    // Step 5: Verify transaction if found
    let txVerified = false;
    if (contractTxId) {
      console.log('\n🔍 Step 5: Verifying transaction...');
      txVerified = await tester.verifyTransaction(contractTxId);
    }
    
    // Step 6: Check final contract state
    console.log('\n📊 Step 6: Checking final contract ratios...');
    const finalRatios = await checkContractRatios();
    
    // Results summary
    console.log('\n' + '='.repeat(50));
    console.log('🏁 TEST RESULTS SUMMARY');
    console.log('='.repeat(50));
    
    console.log(`✅ Initial Ratios Read: ${initialRatios ? 'Success' : 'Failed'}`);
    console.log(`✅ Vote Sent: ${voteSequence ? 'Success' : 'Failed'} ${voteSequence ? `(seq: ${voteSequence})` : ''}`);
    console.log(`${contractTxId ? '✅' : '❌'} Contract Execution: ${contractTxId ? 'Found' : 'Not Found'} ${contractTxId ? `(tx: ${contractTxId})` : ''}`);
    console.log(`${txVerified ? '✅' : '❌'} Transaction Verified: ${txVerified ? 'Success' : 'Failed'}`);
    console.log(`✅ Final Ratios Read: ${finalRatios ? 'Success' : 'Failed'}`);
    
    if (contractTxId && txVerified) {
      console.log('\n🎉 SUCCESS! Contract execution test completed successfully!');
      console.log(`🔗 Transaction: https://hashscan.io/testnet/transaction/${contractTxId}`);
      console.log(`🔗 Contract: https://hashscan.io/testnet/contract/0.0.6216949`);
      return true;
    } else {
      console.log('\n⏰ Test completed but contract execution not detected');
      console.log('This could mean:');
      console.log('  - Governance agent is still processing the vote');
      console.log('  - Contract execution is pending');
      console.log('  - There was an error in the governance agent');
      console.log('  - The vote didn\'t reach quorum');
      console.log('\nCheck Heroku logs for more details:');
      console.log('heroku logs --app lynx-agents');
      return false;
    }
    
  } catch (error) {
    console.error('\n💥 Test failed with error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure TEST_KEY environment variable is set');
    console.error('2. Check that the governance agent is running on Heroku');
    console.error('3. Verify the contract ID is correct (0.0.6216949)');
    console.error('4. Ensure you have enough HBAR for transaction fees');
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  runCompleteTest()
    .then(success => {
      console.log('\n' + '='.repeat(50));
      console.log(success ? '🎉 Test completed successfully!' : '⚠️  Test completed with issues');
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n💥 Unhandled error:', error.message);
      process.exit(1);
    });
}

module.exports = runCompleteTest; 
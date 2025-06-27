#!/usr/bin/env tsx

/**
 * Governance Agent Log Checker
 * 
 * This script helps diagnose governance agent issues by:
 * 1. Checking Heroku app status
 * 2. Showing recent logs
 * 3. Monitoring for specific log patterns
 * 4. Providing diagnostic recommendations
 */

import { config } from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

// Load environment variables
config();

const execAsync = promisify(exec);

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source: string;
}

interface DiagnosticResult {
  status: 'healthy' | 'warning' | 'error';
  message: string;
  details?: string[];
}

export class GovernanceLogChecker {
  private appName: string;
  private expectedPatterns: string[];
  private errorPatterns: string[];

  constructor() {
    this.appName = 'lynx-agents';
    
    // Patterns that indicate healthy operation
    this.expectedPatterns = [
      'Governance Agent initialized successfully',
      'Starting to monitor governance inbound topic',
      'Governance monitoring started successfully',
      'Found MULTI_RATIO_VOTE message',
      'Processing multi-ratio vote',
      'Quorum reached',
      'Contract updateRatios executed successfully',
      'Transaction ID:'
    ];
    
    // Patterns that indicate problems
    this.errorPatterns = [
      'Failed to initialize',
      'Error checking parameter votes',
      'Failed to execute Hedera contract update',
      'Unable to access Hedera client',
      'Mirror node request failed',
      'Transaction ID: undefined',
      'Vote rejected',
      'Invalid vote data'
    ];
  }

  /**
   * Check if Heroku CLI is available
   */
  async checkHerokuCLI(): Promise<boolean> {
    try {
      await execAsync('heroku --version');
      return true;
    } catch (error) {
      console.error('❌ Heroku CLI not found. Please install it:');
      console.error('   npm install -g heroku');
      console.error('   # or');
      console.error('   brew install heroku/brew/heroku');
      return false;
    }
  }

  /**
   * Check Heroku app status
   */
  async checkAppStatus(): Promise<DiagnosticResult> {
    try {
      const { stdout } = await execAsync(`heroku ps --app ${this.appName}`);
      
      if (stdout.includes('up')) {
        return {
          status: 'healthy',
          message: 'Governance agent is running on Heroku',
          details: stdout.split('\n').filter(line => line.trim())
        };
      } else {
        return {
          status: 'error',
          message: 'Governance agent is not running',
          details: stdout.split('\n').filter(line => line.trim())
        };
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to check app status',
        details: [String(error)]
      };
    }
  }

  /**
   * Get recent logs from Heroku
   */
  async getRecentLogs(lines: number = 100): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`heroku logs --num ${lines} --app ${this.appName}`);
      return stdout.split('\n').filter(line => line.trim());
    } catch (error) {
      console.error('❌ Failed to fetch logs:', error);
      return [];
    }
  }

  /**
   * Parse log entries
   */
  parseLogEntry(logLine: string): LogEntry | null {
    try {
      // Heroku log format: timestamp app[dyno]: level message
      const match = logLine.match(/^(\S+)\s+(\S+)\[(\S+)\]:\s+(.+)$/);
      
      if (!match) {
        return null;
      }
      
      const [, timestamp, app, dyno, message] = match;
      
      // Extract log level from message if present
      let level = 'info';
      if (message.includes('[ERROR]') || message.includes('ERROR:')) {
        level = 'error';
      } else if (message.includes('[WARN]') || message.includes('WARN:')) {
        level = 'warn';
      } else if (message.includes('[DEBUG]') || message.includes('DEBUG:')) {
        level = 'debug';
      }
      
      return {
        timestamp,
        level,
        message,
        source: `${app}[${dyno}]`
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Analyze logs for diagnostic patterns
   */
  analyzeLogs(logs: string[]): DiagnosticResult[] {
    const results: DiagnosticResult[] = [];
    const recentLogs = logs.slice(-50); // Focus on recent logs
    
    // Check for healthy patterns
    const healthyPatterns = this.expectedPatterns.filter(pattern =>
      recentLogs.some(log => log.includes(pattern))
    );
    
    if (healthyPatterns.length > 0) {
      results.push({
        status: 'healthy',
        message: `Found ${healthyPatterns.length} healthy operation indicators`,
        details: healthyPatterns
      });
    }
    
    // Check for error patterns
    const errorPatterns = this.errorPatterns.filter(pattern =>
      recentLogs.some(log => log.includes(pattern))
    );
    
    if (errorPatterns.length > 0) {
      results.push({
        status: 'error',
        message: `Found ${errorPatterns.length} error indicators`,
        details: errorPatterns
      });
    }
    
    // Check for vote processing
    const voteProcessingLogs = recentLogs.filter(log =>
      log.includes('MULTI_RATIO_VOTE') || 
      log.includes('Processing multi-ratio vote') ||
      log.includes('Found PARAMETER_VOTE')
    );
    
    if (voteProcessingLogs.length > 0) {
      results.push({
        status: 'healthy',
        message: 'Vote processing activity detected',
        details: voteProcessingLogs.map(log => log.substring(log.indexOf(']:') + 2).trim())
      });
    } else {
      results.push({
        status: 'warning',
        message: 'No recent vote processing activity found',
        details: ['Agent may not be receiving votes or may be idle']
      });
    }
    
    // Check for contract execution
    const contractLogs = recentLogs.filter(log =>
      log.includes('updateRatios') ||
      log.includes('Contract execution') ||
      log.includes('Transaction ID:')
    );
    
    if (contractLogs.length > 0) {
      results.push({
        status: 'healthy',
        message: 'Contract execution activity detected',
        details: contractLogs.map(log => log.substring(log.indexOf(']:') + 2).trim())
      });
    } else {
      results.push({
        status: 'warning',
        message: 'No recent contract execution activity',
        details: ['Votes may not be reaching quorum or contract calls may be failing']
      });
    }
    
    return results;
  }

  /**
   * Monitor logs in real-time
   */
  async monitorLogs(duration: number = 300000): Promise<void> {
    console.log(`🔍 Monitoring governance agent logs for ${duration / 1000} seconds...`);
    console.log('Press Ctrl+C to stop monitoring');
    console.log('');
    
    try {
      // Start log monitoring
      const logProcess = exec(`heroku logs --tail --app ${this.appName}`);
      
      logProcess.stdout?.on('data', (data: string) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          const entry = this.parseLogEntry(line);
          
          if (entry) {
            // Highlight important messages
            let prefix = '📋';
            if (entry.level === 'error') {
              prefix = '❌';
            } else if (entry.level === 'warn') {
              prefix = '⚠️';
            } else if (entry.message.includes('MULTI_RATIO_VOTE') || 
                      entry.message.includes('updateRatios') ||
                      entry.message.includes('Transaction ID:')) {
              prefix = '🎯';
            }
            
            console.log(`${prefix} ${entry.timestamp} ${entry.message}`);
          } else {
            console.log(`📋 ${line}`);
          }
        }
      });
      
      logProcess.stderr?.on('data', (data: string) => {
        console.error(`❌ Log error: ${data}`);
      });
      
      // Stop after duration
      setTimeout(() => {
        logProcess.kill();
        console.log('\n⏰ Monitoring stopped');
      }, duration);
      
    } catch (error) {
      console.error('❌ Failed to monitor logs:', error);
    }
  }

  /**
   * Get environment configuration
   */
  async getEnvironmentConfig(): Promise<DiagnosticResult> {
    try {
      const { stdout } = await execAsync(`heroku config --app ${this.appName}`);
      
      const requiredVars = [
        'GOVERNANCE_CONTRACT_ID',
        'GOVERNANCE_ACCOUNT_ID',
        'GOVERNANCE_KEY',
        'OPENAI_API_KEY'
      ];
      
      const missingVars = requiredVars.filter(varName => !stdout.includes(varName));
      
      if (missingVars.length === 0) {
        return {
          status: 'healthy',
          message: 'All required environment variables are set',
          details: stdout.split('\n').filter(line => line.includes('='))
        };
      } else {
        return {
          status: 'error',
          message: `Missing required environment variables: ${missingVars.join(', ')}`,
          details: missingVars.map(v => `Set with: heroku config:set ${v}=<value> --app ${this.appName}`)
        };
      }
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to check environment configuration',
        details: [String(error)]
      };
    }
  }

  /**
   * Run complete diagnostic check
   */
  async runDiagnostics(): Promise<void> {
    console.log('🔍 Governance Agent Diagnostics');
    console.log('===============================');
    
    // Check Heroku CLI
    const hasHeroku = await this.checkHerokuCLI();
    if (!hasHeroku) {
      return;
    }
    
    // Check app status
    console.log('\n📊 App Status:');
    const appStatus = await this.checkAppStatus();
    this.printDiagnosticResult(appStatus);
    
    // Check environment configuration
    console.log('\n🔧 Environment Configuration:');
    const envConfig = await this.getEnvironmentConfig();
    this.printDiagnosticResult(envConfig);
    
    // Get and analyze recent logs
    console.log('\n📋 Log Analysis:');
    console.log('Fetching recent logs...');
    
    const logs = await this.getRecentLogs(200);
    if (logs.length === 0) {
      console.log('❌ No logs found');
      return;
    }
    
    console.log(`Found ${logs.length} log entries`);
    
    const logAnalysis = this.analyzeLogs(logs);
    logAnalysis.forEach(result => this.printDiagnosticResult(result));
    
    // Show recent relevant logs
    console.log('\n📝 Recent Relevant Logs:');
    const relevantLogs = logs.filter(log =>
      this.expectedPatterns.some(pattern => log.includes(pattern)) ||
      this.errorPatterns.some(pattern => log.includes(pattern)) ||
      log.includes('MULTI_RATIO_VOTE') ||
      log.includes('updateRatios')
    ).slice(-10);
    
    if (relevantLogs.length > 0) {
      relevantLogs.forEach(log => {
        const entry = this.parseLogEntry(log);
        if (entry) {
          console.log(`  ${entry.timestamp}: ${entry.message}`);
        } else {
          console.log(`  ${log}`);
        }
      });
    } else {
      console.log('  No relevant logs found in recent entries');
    }
    
    // Provide recommendations
    console.log('\n💡 Recommendations:');
    
    if (appStatus.status === 'error') {
      console.log('  1. Restart the governance agent: heroku restart --app lynx-agents');
    }
    
    if (envConfig.status === 'error') {
      console.log('  2. Set missing environment variables (see above)');
    }
    
    const hasVoteProcessing = logAnalysis.some(r => 
      r.message.includes('Vote processing activity detected')
    );
    
    if (!hasVoteProcessing) {
      console.log('  3. Send a test vote to verify the agent is listening');
      console.log('     npm run lynx-agent:send-test-vote');
    }
    
    const hasContractExecution = logAnalysis.some(r =>
      r.message.includes('Contract execution activity detected')
    );
    
    if (!hasContractExecution) {
      console.log('  4. Check if votes are reaching quorum (15,000+ voting power)');
      console.log('  5. Verify contract ID and governance account permissions');
    }
    
    console.log('\n🔍 For real-time monitoring, run:');
    console.log('  npm run lynx-agent:monitor-logs');
  }

  /**
   * Print diagnostic result with appropriate formatting
   */
  private printDiagnosticResult(result: DiagnosticResult): void {
    const statusIcon = {
      healthy: '✅',
      warning: '⚠️',
      error: '❌'
    }[result.status];
    
    console.log(`${statusIcon} ${result.message}`);
    
    if (result.details && result.details.length > 0) {
      result.details.forEach(detail => {
        console.log(`   ${detail}`);
      });
    }
  }
}

// Command line interface
const command = process.argv[2];

async function main() {
  const checker = new GovernanceLogChecker();
  
  switch (command) {
    case 'monitor':
      await checker.monitorLogs();
      break;
    case 'status':
      await checker.runDiagnostics();
      break;
    default:
      console.log('Usage:');
      console.log('  npm run lynx-agent:check-logs         # Run full diagnostics');
      console.log('  npm run lynx-agent:monitor-logs       # Monitor logs in real-time');
      break;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
}

export default GovernanceLogChecker; 
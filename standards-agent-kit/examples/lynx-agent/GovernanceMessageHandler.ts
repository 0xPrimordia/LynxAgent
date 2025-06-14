import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { Logger } from '@hashgraphonline/standards-sdk';
import {
  GovernanceMessageSchema,
  GovernanceParametersFullSchema,
  ParameterStateSnapshotSchema,
  validateGovernanceMessage,
  validateParameterChange,
  GOVERNANCE_OPERATIONS,
  GovernanceVoteMessageSchema,
  GovernanceResultMessageSchema,
  GovernanceStateMessageSchema,
  GovernanceProposalMessageSchema,
  type GovernanceMessage,
  type GovernanceParameters,
  type ParameterStateSnapshot,
  type ParameterVote,
  type VoteResultMessage,
} from './governance-schema';
import { z } from 'zod';

export interface GovernanceMessageHandlerConfig {
  client: HCS10Client;
  accountId: string;
  inboundTopicId: string;
  outboundTopicId: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  stateValidation?: boolean;
}

/**
 * GovernanceMessageHandler provides standardized message validation, parsing,
 * and state management for DAO governance messages following HCS-10 standards.
 */
export class GovernanceMessageHandler {
  private logger: Logger;
  private client: HCS10Client;
  private accountId: string;
  private inboundTopicId: string;
  private outboundTopicId: string;
  private stateValidation: boolean;
  private currentState: GovernanceParameters | null = null;
  private stateHash: string | null = null;

  constructor(config: GovernanceMessageHandlerConfig) {
    this.logger = new Logger({
      module: 'GovernanceMessageHandler',
      level: config.logLevel || 'info',
      prettyPrint: true,
    });

    this.client = config.client;
    this.accountId = config.accountId;
    this.inboundTopicId = config.inboundTopicId;
    this.outboundTopicId = config.outboundTopicId;
    this.stateValidation = config.stateValidation ?? true;
  }

  /**
   * Process and validate a raw HCS message according to governance schemas
   */
  public async processMessage(messageData: string): Promise<{
    isValid: boolean;
    message?: GovernanceMessage;
    errors?: string[];
    processed?: boolean;
  }> {
    try {
      // Parse the raw message data
      let parsedMessage: unknown;
      
      try {
        parsedMessage = JSON.parse(messageData);
      } catch (error) {
        return {
          isValid: false,
          errors: ['Invalid JSON format'],
          processed: false,
        };
      }

      // Validate against governance message schema
      const validation = validateGovernanceMessage(parsedMessage);
      
      if (!validation.isValid) {
        const errorMessages = validation.errors?.issues.map(
          issue => `${issue.path.join('.')}: ${issue.message}`
        ) || ['Unknown validation error'];
        
        this.logger.warn('Message validation failed', { errors: errorMessages });
        return {
          isValid: false,
          errors: errorMessages,
          processed: false,
        };
      }

      const message = validation.data!;
      this.logger.info(`Processing governance message: ${message.op}`);

      // Process the message based on operation type
      const processed = await this.handleGovernanceOperation(message);

      return {
        isValid: true,
        message,
        processed,
      };
    } catch (error) {
      this.logger.error('Error processing message', error);
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        processed: false,
      };
    }
  }

  /**
   * Handle different types of governance operations
   */
  private async handleGovernanceOperation(message: GovernanceMessage): Promise<boolean> {
    switch (message.op) {
      case GOVERNANCE_OPERATIONS.VOTE:
        return await this.handleVoteMessage(message as z.infer<typeof GovernanceVoteMessageSchema>);
        
      case GOVERNANCE_OPERATIONS.RESULT:
        return await this.handleResultMessage(message as z.infer<typeof GovernanceResultMessageSchema>);
        
      case GOVERNANCE_OPERATIONS.STATE:
        return await this.handleStateMessage(message as z.infer<typeof GovernanceStateMessageSchema>);
        
      case GOVERNANCE_OPERATIONS.PROPOSAL:
        return await this.handleProposalMessage(message as z.infer<typeof GovernanceProposalMessageSchema>);
        
      default:
        this.logger.warn(`Unknown governance operation: ${(message as any).op}`);
        return false;
    }
  }

  /**
   * Handle vote messages
   */
  private async handleVoteMessage(message: z.infer<typeof GovernanceVoteMessageSchema>): Promise<boolean> {
    const vote = message.data;
    
    this.logger.info(`Processing vote for parameter: ${vote.parameterPath}`);
    
    // Validate the parameter exists and the new value is valid
    if (this.currentState && this.stateValidation) {
      const validation = validateParameterChange(
        vote.parameterPath,
        this.getParameterValue(vote.parameterPath),
        vote.newValue,
        this.currentState
      );
      
      if (!validation.isValid) {
        this.logger.warn(`Invalid parameter change`, { 
          path: vote.parameterPath, 
          errors: validation.errors 
        });
        return false;
      }
    }

    // Log the vote details
    this.logger.info('Vote processed successfully', {
      voter: vote.voterAccountId,
      parameter: vote.parameterPath,
      newValue: vote.newValue,
      votingPower: vote.votingPower,
      reason: vote.reason,
    });

    return true;
  }

  /**
   * Handle vote result messages
   */
  private async handleResultMessage(message: z.infer<typeof GovernanceResultMessageSchema>): Promise<boolean> {
    const result = message.data;
    
    this.logger.info(`Processing vote result for parameter: ${result.parameterPath}`);
    
    // Update local state if the vote passed
    if (result.type === 'PARAMETER_UPDATE' && result.quorumReached && this.currentState) {
      this.updateParameterInState(result.parameterPath, result.newValue);
      this.logger.info(`Parameter updated locally: ${result.parameterPath} = ${result.newValue}`);
    }

    // Log the result details
    this.logger.info('Vote result processed', {
      type: result.type,
      parameter: result.parameterPath,
      quorumReached: result.quorumReached,
      totalVotingPower: result.totalVotingPower,
      status: result.executionStatus,
    });

    return true;
  }

  /**
   * Handle state snapshot messages
   */
  private async handleStateMessage(message: z.infer<typeof GovernanceStateMessageSchema>): Promise<boolean> {
    const stateSnapshot = message.data;
    
    this.logger.info('Processing governance state snapshot');
    
    // Validate the state snapshot
    try {
      ParameterStateSnapshotSchema.parse(stateSnapshot);
    } catch (error) {
      this.logger.error('Invalid state snapshot format', error);
      return false;
    }

    // Update current state
    this.currentState = stateSnapshot.parameters;
    this.stateHash = stateSnapshot.hash || null;
    
    this.logger.info('State updated from snapshot', {
      timestamp: stateSnapshot.timestamp,
      activeVotes: stateSnapshot.activeVotes.length,
      recentChanges: stateSnapshot.recentChanges.length,
      hash: this.stateHash,
    });

    return true;
  }

  /**
   * Handle proposal messages
   */
  private async handleProposalMessage(message: z.infer<typeof GovernanceProposalMessageSchema>): Promise<boolean> {
    const proposal = message.data;
    
    this.logger.info(`Processing governance proposal for parameter: ${proposal.parameterPath}`);
    
    // Validate the proposal against current state
    if (this.currentState && this.stateValidation) {
      const validation = validateParameterChange(
        proposal.parameterPath,
        proposal.currentValue,
        proposal.proposedValue,
        this.currentState
      );
      
      if (!validation.isValid) {
        this.logger.warn(`Invalid proposal`, { 
          path: proposal.parameterPath, 
          errors: validation.errors 
        });
        return false;
      }
    }

    // Log the proposal details
    this.logger.info('Proposal processed successfully', {
      proposer: proposal.proposerAccountId,
      parameter: proposal.parameterPath,
      currentValue: proposal.currentValue,
      proposedValue: proposal.proposedValue,
      reasoning: proposal.reasoning,
      impact: proposal.impact,
    });

    return true;
  }

  /**
   * Create and send a governance message to the outbound topic
   */
  public async sendGovernanceMessage(
    operation: keyof typeof GOVERNANCE_OPERATIONS,
    data: any,
    memo?: string
  ): Promise<number | undefined> {
    try {
      // Create the HCS-10 formatted message
      const operatorId = `${this.inboundTopicId}@${this.accountId}`;
      const message = {
        p: 'hcs-10',
        op: GOVERNANCE_OPERATIONS[operation],
        operator_id: operatorId,
        data,
        m: memo,
      };

      // Validate the message before sending
      const validation = validateGovernanceMessage(message);
      if (!validation.isValid) {
        const errorMessages = validation.errors?.issues.map(
          issue => `${issue.path.join('.')}: ${issue.message}`
        ) || ['Unknown validation error'];
        
        throw new Error(`Message validation failed: ${errorMessages.join(', ')}`);
      }

      // Send the message
      const sequenceNumber = await this.client.sendMessage(
        this.outboundTopicId,
        JSON.stringify(message),
        memo || `Governance ${operation.toLowerCase()}`
      );

      this.logger.info(`Governance message sent`, {
        operation,
        sequenceNumber,
        topicId: this.outboundTopicId,
      });

      return sequenceNumber;
    } catch (error) {
      this.logger.error(`Failed to send governance message`, error);
      throw error;
    }
  }

  /**
   * Create and send a parameter state snapshot
   */
  public async publishStateSnapshot(
    parameters: GovernanceParameters,
    activeVotes: Array<{
      parameterPath: string;
      proposedValue: any;
      votingEnds: Date;
      currentVotes: number;
      requiredVotes: number;
    }> = [],
    recentChanges: Array<{
      parameterPath: string;
      oldValue: any;
      newValue: any;
      timestamp: Date;
      txId?: string;
    }> = []
  ): Promise<number | undefined> {
    try {
      // Create state snapshot
      const snapshot: ParameterStateSnapshot = {
        parameters,
        activeVotes,
        recentChanges,
        timestamp: new Date(),
        hash: this.generateStateHash(parameters),
      };

      // Validate the snapshot
      ParameterStateSnapshotSchema.parse(snapshot);

      // Send the snapshot
      return await this.sendGovernanceMessage('STATE', snapshot, 'Parameter state snapshot');
    } catch (error) {
      this.logger.error('Failed to publish state snapshot', error);
      throw error;
    }
  }

  /**
   * Validate current state against schema
   */
  public validateCurrentState(): { isValid: boolean; errors?: string[] } {
    if (!this.currentState) {
      return { isValid: false, errors: ['No current state loaded'] };
    }

    try {
      GovernanceParametersFullSchema.parse(this.currentState);
      return { isValid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues.map(
          issue => `${issue.path.join('.')}: ${issue.message}`
        );
        return { isValid: false, errors: errorMessages };
      }
      return { isValid: false, errors: [String(error)] };
    }
  }

  /**
   * Get current governance state
   */
  public getCurrentState(): GovernanceParameters | null {
    return this.currentState;
  }

  /**
   * Set the current governance state
   */
  public setCurrentState(state: GovernanceParameters): void {
    this.currentState = state;
    this.stateHash = this.generateStateHash(state);
    this.logger.info('Governance state updated manually');
  }

  /**
   * Get a specific parameter value by path
   */
  private getParameterValue(parameterPath: string): unknown {
    if (!this.currentState) return undefined;
    
    const pathParts = parameterPath.split('.');
    let value: any = this.currentState;
    
    for (const part of pathParts) {
      if (!value[part]) return undefined;
      value = value[part];
    }
    
    return value?.value || value;
  }

  /**
   * Update a parameter value in the current state
   */
  private updateParameterInState(parameterPath: string, newValue: any): void {
    if (!this.currentState) return;
    
    const pathParts = parameterPath.split('.');
    let current: any = this.currentState;
    
    // Navigate to the parent object
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (!current[pathParts[i]]) return;
      current = current[pathParts[i]];
    }
    
    const lastKey = pathParts[pathParts.length - 1];
    
    // Update the value and timestamp
    if (current[lastKey] && typeof current[lastKey] === 'object' && 'value' in current[lastKey]) {
      current[lastKey].value = newValue;
      current[lastKey].lastChanged = new Date();
    } else {
      current[lastKey] = newValue;
    }
    
    // Update state hash
    this.stateHash = this.generateStateHash(this.currentState);
  }

  /**
   * Generate a hash for state integrity verification
   */
  private generateStateHash(state: GovernanceParameters): string {
    // Simple hash implementation - in production you might use a more robust solution
    const stateString = JSON.stringify(state, null, 0);
    let hash = 0;
    for (let i = 0; i < stateString.length; i++) {
      const char = stateString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get current state hash
   */
  public getStateHash(): string | null {
    return this.stateHash;
  }

  /**
   * Utility method to create a parameter vote message
   */
  public createVoteMessage(
    parameterPath: string,
    newValue: any,
    voterAccountId: string,
    votingPower: number,
    reason?: string
  ): ParameterVote {
    return {
      parameterPath,
      newValue,
      voterAccountId,
      votingPower,
      timestamp: new Date(),
      reason,
    };
  }

  /**
   * Utility method to create a vote result message
   */
  public createVoteResultMessage(
    parameterPath: string,
    oldValue: any,
    newValue: any,
    votesInFavor: number,
    totalVotingPower: number,
    quorumPercentage: number,
    quorumReached: boolean,
    votesAgainst?: number
  ): VoteResultMessage {
    return {
      type: quorumReached ? 'PARAMETER_UPDATE' : 'VOTE_FAILED',
      parameterPath,
      oldValue,
      newValue: quorumReached ? newValue : undefined,
      votesInFavor,
      votesAgainst,
      totalVotingPower,
      quorumPercentage,
      quorumReached,
      effectiveTimestamp: new Date(),
      executionStatus: 'pending',
    };
  }
} 
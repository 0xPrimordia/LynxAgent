import { z } from 'zod';

// Base HCS-10 message schema according to the standards
export const HCS10MessageSchema = z.object({
  p: z.literal('hcs-10').describe('Protocol identifier, always "hcs-10"'),
  op: z.string().describe('Operation identifier'),
  operator_id: z.string().describe('Identifier for the sending entity in format inboundTopicId@accountId'),
  data: z.any().describe('The message content or data'),
  m: z.string().optional().describe('Optional memo providing context'),
});

// Schema for parameter option values with constraints
export const ParamOptionSchema = z.object({
  value: z.union([z.number(), z.string(), z.boolean()]).describe('Current parameter value'),
  options: z.array(z.union([z.number(), z.string(), z.boolean()])).describe('Available value options'),
  lastChanged: z.date().describe('When this parameter was last modified'),
  minQuorum: z.number().min(0).max(100).describe('Special quorum percentage required for this parameter'),
  description: z.string().describe('Human-readable description of the parameter'),
  constraints: z.object({
    min: z.number().optional().describe('Minimum allowed value for numeric parameters'),
    max: z.number().optional().describe('Maximum allowed value for numeric parameters'),
    pattern: z.string().optional().describe('Regex pattern for string validation'),
    dependencies: z.array(z.string()).optional().describe('Other parameters that must be considered together'),
  }).optional().describe('Additional validation constraints for the parameter'),
});

// Schema for individual parameter votes
export const ParameterVoteSchema = z.object({
  parameterPath: z.string().describe('Dot-notation path to parameter (e.g., "rebalancing.thresholds.normal")'),
  newValue: z.union([z.number(), z.string(), z.boolean()]).describe('Proposed new value'),
  voterAccountId: z.string().regex(/^0\.0\.\d+$/).describe('Hedera account ID of the voter'),
  votingPower: z.number().min(0).describe('Token weight/power of this vote'),
  timestamp: z.date().describe('When the vote was cast'),
  txId: z.string().optional().describe('Optional Hedera transaction ID'),
  reason: z.string().optional().describe('Optional explanation for the vote'),
});

// Schema for governance parameter structure - Rebalancing
export const RebalancingParametersSchema = z.object({
  frequencyHours: ParamOptionSchema.describe('How often rebalancing checks occur'),
  thresholds: z.object({
    normal: ParamOptionSchema.describe('Deviation percentage that triggers normal rebalance'),
    emergency: ParamOptionSchema.describe('Deviation percentage that triggers emergency rebalance'),
  }),
  cooldownPeriods: z.object({
    normal: ParamOptionSchema.describe('Hours to wait between normal rebalances'),
    emergency: ParamOptionSchema.describe('Hours to wait between emergency rebalances'),
  }),
  methods: z.object({
    gradual: ParamOptionSchema.describe('Enable gradual rebalancing approach'),
    maxSlippageTolerance: ParamOptionSchema.describe('Maximum allowed slippage during rebalancing'),
  }).optional(),
});

// Schema for treasury parameters
export const TreasuryParametersSchema = z.object({
  weights: z.record(z.string(), ParamOptionSchema).describe('Token weight percentages by symbol'),
  maxSlippage: z.record(z.string(), ParamOptionSchema).describe('Maximum slippage percentages by token'),
  maxSwapSize: z.record(z.string(), ParamOptionSchema).describe('Maximum swap size limits by token (in USD)'),
  sectors: z.object({
    definitions: z.record(z.string(), z.object({
      tokens: z.array(z.string()).describe('Token symbols in this sector'),
      maxWeight: ParamOptionSchema.describe('Maximum weight this sector can have'),
      minWeight: ParamOptionSchema.describe('Minimum weight this sector must have'),
    })).describe('Sector definitions and constraints'),
  }).optional(),
});

// Schema for fee parameters
export const FeeParametersSchema = z.object({
  mintingFee: ParamOptionSchema.describe('Fee charged when minting Lynx tokens (percentage)'),
  burningFee: ParamOptionSchema.describe('Fee charged when burning Lynx tokens (percentage)'),
  operationalFee: ParamOptionSchema.describe('Annual operational fee (percentage)'),
  rewardsAllocation: ParamOptionSchema.describe('How protocol fees are distributed').optional(),
});

// Schema for governance parameters
export const GovernanceParametersSchema = z.object({
  quorumPercentage: ParamOptionSchema.describe('Default percentage of total supply needed for valid vote'),
  votingPeriodHours: ParamOptionSchema.describe('Hours that a parameter vote remains open'),
  proposalThreshold: ParamOptionSchema.describe('Minimum LYNX tokens needed to propose a parameter change'),
  stakingLockPeriod: ParamOptionSchema.describe('How long staked LYNX must be held').optional(),
  emergencyOverride: z.object({
    enabled: ParamOptionSchema.describe('Whether emergency override is enabled'),
    threshold: ParamOptionSchema.describe('Emergency quorum threshold'),
    timeLimit: ParamOptionSchema.describe('Time limit for emergency actions'),
  }).optional(),
});

// Complete governance parameters schema
export const GovernanceParametersFullSchema = z.object({
  rebalancing: RebalancingParametersSchema,
  treasury: TreasuryParametersSchema,
  fees: FeeParametersSchema,
  governance: GovernanceParametersSchema,
  metadata: z.object({
    version: z.string().describe('Schema version'),
    lastUpdated: z.date().describe('When parameters were last updated'),
    totalSupply: z.number().describe('Total LYNX token supply for quorum calculations'),
    contractAddress: z.string().optional().describe('Governance contract address if applicable'),
  }),
});

// Vote result message schema
export const VoteResultMessageSchema = z.object({
  type: z.enum(['PARAMETER_UPDATE', 'VOTE_RESULT', 'VOTE_FAILED']).describe('Type of vote result'),
  parameterPath: z.string().describe('Path to the parameter that was voted on'),
  oldValue: z.union([z.number(), z.string(), z.boolean()]).describe('Previous parameter value'),
  newValue: z.union([z.number(), z.string(), z.boolean()]).optional().describe('New parameter value (if vote passed)'),
  votesInFavor: z.number().min(0).describe('Number of votes in favor'),
  votesAgainst: z.number().min(0).optional().describe('Number of votes against'),
  totalVotingPower: z.number().min(0).describe('Total voting power exercised'),
  quorumPercentage: z.number().min(0).max(100).describe('Required quorum percentage'),
  quorumReached: z.boolean().describe('Whether quorum was reached'),
  effectiveTimestamp: z.date().describe('When the change takes effect'),
  expiresTimestamp: z.date().optional().describe('When this result expires'),
  executionStatus: z.enum(['pending', 'executed', 'failed']).optional().describe('Execution status'),
});

// Parameter state snapshot schema for current state messages
export const ParameterStateSnapshotSchema = z.object({
  parameters: GovernanceParametersFullSchema,
  activeVotes: z.array(z.object({
    parameterPath: z.string(),
    proposedValue: z.union([z.number(), z.string(), z.boolean()]),
    votingEnds: z.date(),
    currentVotes: z.number(),
    requiredVotes: z.number(),
  })).describe('Currently active voting sessions'),
  recentChanges: z.array(z.object({
    parameterPath: z.string(),
    oldValue: z.union([z.number(), z.string(), z.boolean()]),
    newValue: z.union([z.number(), z.string(), z.boolean()]),
    timestamp: z.date(),
    txId: z.string().optional(),
  })).describe('Recent parameter changes'),
  timestamp: z.date().describe('When this snapshot was created'),
  blockHeight: z.number().optional().describe('Blockchain height at snapshot time'),
  hash: z.string().optional().describe('Hash of the parameter state for integrity verification'),
});

// HCS-10 Governance operation schemas
export const GovernanceVoteMessageSchema = HCS10MessageSchema.extend({
  op: z.literal('governance_vote'),
  data: ParameterVoteSchema,
});

export const GovernanceResultMessageSchema = HCS10MessageSchema.extend({
  op: z.literal('governance_result'),
  data: VoteResultMessageSchema,
});

export const GovernanceStateMessageSchema = HCS10MessageSchema.extend({
  op: z.literal('governance_state'),
  data: ParameterStateSnapshotSchema,
});

export const GovernanceProposalMessageSchema = HCS10MessageSchema.extend({
  op: z.literal('governance_proposal'),
  data: z.object({
    parameterPath: z.string(),
    currentValue: z.union([z.number(), z.string(), z.boolean()]),
    proposedValue: z.union([z.number(), z.string(), z.boolean()]),
    proposerAccountId: z.string().regex(/^0\.0\.\d+$/),
    reasoning: z.string(),
    votingPeriodHours: z.number().min(1).max(168).optional(),
    requiredQuorum: z.number().min(0).max(100).optional(),
    dependencies: z.array(z.string()).optional().describe('Other parameters affected by this change'),
    impact: z.object({
      risk: z.enum(['low', 'medium', 'high']),
      stakeholders: z.array(z.string()),
      description: z.string(),
    }).optional(),
  }),
});

// Union of all governance message types for validation
export const GovernanceMessageSchema = z.discriminatedUnion('op', [
  GovernanceVoteMessageSchema,
  GovernanceResultMessageSchema,
  GovernanceStateMessageSchema,
  GovernanceProposalMessageSchema,
]);

// Utility function to validate governance messages
export function validateGovernanceMessage(message: unknown): {
  isValid: boolean;
  data?: z.infer<typeof GovernanceMessageSchema>;
  errors?: z.ZodError;
} {
  try {
    const validatedData = GovernanceMessageSchema.parse(message);
    return { isValid: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { isValid: false, errors: error };
    }
    throw error;
  }
}

// Utility function to validate parameter changes against constraints
export function validateParameterChange(
  parameterPath: string,
  currentValue: unknown,
  newValue: unknown,
  parameters: z.infer<typeof GovernanceParametersFullSchema>
): {
  isValid: boolean;
  errors?: string[];
} {
  const errors: string[] = [];
  
  // Navigate to the parameter definition
  const pathParts = parameterPath.split('.');
  let paramDef: any = parameters;
  
  for (const part of pathParts) {
    if (!paramDef[part]) {
      errors.push(`Parameter path ${parameterPath} not found`);
      return { isValid: false, errors };
    }
    paramDef = paramDef[part];
  }
  
  // Check if the new value is in the allowed options
  if (paramDef.options && !paramDef.options.includes(newValue)) {
    errors.push(`Value ${newValue} is not in allowed options: ${paramDef.options.join(', ')}`);
  }
  
  // Check constraints if they exist
  if (paramDef.constraints) {
    const constraints = paramDef.constraints;
    
    if (typeof newValue === 'number') {
      if (constraints.min !== undefined && newValue < constraints.min) {
        errors.push(`Value ${newValue} is below minimum ${constraints.min}`);
      }
      if (constraints.max !== undefined && newValue > constraints.max) {
        errors.push(`Value ${newValue} is above maximum ${constraints.max}`);
      }
    }
    
    if (typeof newValue === 'string' && constraints.pattern) {
      const regex = new RegExp(constraints.pattern);
      if (!regex.test(newValue)) {
        errors.push(`Value "${newValue}" does not match required pattern ${constraints.pattern}`);
      }
    }
  }
  
  return { isValid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
}

// Type exports for use in other files
export type GovernanceParameters = z.infer<typeof GovernanceParametersFullSchema>;
export type ParameterVote = z.infer<typeof ParameterVoteSchema>;
export type VoteResultMessage = z.infer<typeof VoteResultMessageSchema>;
export type ParameterStateSnapshot = z.infer<typeof ParameterStateSnapshotSchema>;
export type GovernanceMessage = z.infer<typeof GovernanceMessageSchema>;
export type ParamOption<T = any> = z.infer<typeof ParamOptionSchema>;

// Constants for governance operations
export const GOVERNANCE_OPERATIONS = {
  VOTE: 'governance_vote',
  RESULT: 'governance_result',
  STATE: 'governance_state',
  PROPOSAL: 'governance_proposal',
} as const;

// Default parameter constraints
export const DEFAULT_CONSTRAINTS = {
  PERCENTAGE: { min: 0, max: 100 },
  HOURS: { min: 1, max: 8760 }, // 1 hour to 1 year
  QUORUM: { min: 1, max: 100 },
  VOTING_POWER: { min: 0, max: Number.MAX_SAFE_INTEGER },
} as const; 
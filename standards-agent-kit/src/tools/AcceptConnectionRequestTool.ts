import { StructuredTool, ToolParams } from '@langchain/core/tools';
import { z } from 'zod';
import { HCS10Client } from '../hcs10/HCS10Client';
import { IStateManager, ActiveConnection } from '../state/state-types';
import { Logger, FeeConfigBuilder } from '@hashgraphonline/standards-sdk';

export interface AcceptConnectionRequestToolParams extends ToolParams {
  hcsClient: HCS10Client;
  stateManager: IStateManager;
}

/**
 * A tool specifically for accepting incoming connection requests.
 */
export class AcceptConnectionRequestTool extends StructuredTool {
  name = 'accept_connection_request';
  description =
    'Accepts a specific pending connection request from another agent, establishing a communication channel.';
  schema = z.object({
    requestKey: z
      .string()
      .describe(
        'The unique request key of the specific request to accept. Use the "manage_connection_requests" tool with action="list" first to get valid keys.'
      ),
    hbarFee: z
      .number()
      .optional()
      .describe(
        'Optional HBAR fee amount to charge the connecting agent per message on the new connection topic.'
      ),
    exemptAccountIds: z
      .array(z.string())
      .optional()
      .describe(
        'Optional list of account IDs to exempt from any configured fees on the new connection topic.'
      ),
  });

  private hcsClient: HCS10Client;
  private stateManager: IStateManager;
  private logger: Logger;

  constructor({
    hcsClient,
    stateManager,
    ...rest
  }: AcceptConnectionRequestToolParams) {
    super(rest);
    this.hcsClient = hcsClient;
    this.stateManager = stateManager;
    this.logger = Logger.getInstance({
      module: 'AcceptConnectionRequestTool',
    });
  }

  protected async _call({
    requestKey,
    hbarFee,
    exemptAccountIds,
  }: z.infer<this['schema']>): Promise<string> {
    const currentAgent = this.stateManager.getCurrentAgent();
    if (!currentAgent) {
      return 'Error: Cannot accept connection request. No agent is currently active. Please register or select an agent first.';
    }

    const connectionsManager = this.stateManager.getConnectionsManager();
    if (!connectionsManager) {
      return 'Error: ConnectionsManager not initialized';
    }

    await connectionsManager.fetchConnectionData(currentAgent.accountId);

    // Find the request with the matching unique key or fallback to sequence number
    const allRequests = [
      ...connectionsManager.getPendingRequests(),
      ...connectionsManager.getConnectionsNeedingConfirmation()
    ];

    const request = allRequests.find(
      (r) => (r.uniqueRequestKey === requestKey) ||
        (r.connectionRequestId?.toString() === requestKey) ||
        (r.inboundRequestId?.toString() === requestKey)
    );

    if (!request) {
      return `Error: Request with key ${requestKey} not found or no longer pending. Use the manage_connection_requests tool with action="list" to verify.`;
    }

    // Get the numeric request ID from the request for the SDK call
    const numericRequestId = request.connectionRequestId || request.inboundRequestId;
    if (!numericRequestId) {
      return `Error: Could not determine a valid request ID for the request with key ${requestKey}.`;
    }

    try {
      const inboundTopicId = await this.hcsClient.getInboundTopicId();
      let feeConfigBuilder = undefined;

      if (hbarFee && hbarFee > 0) {
        const collectorId = this.hcsClient.getAccountAndSigner().accountId;
        try {
          feeConfigBuilder = new FeeConfigBuilder({
            network: this.hcsClient.getNetwork(),
            logger: this.logger,
            defaultCollectorAccountId: collectorId,
          });

          const finalExemptions = [
            ...(exemptAccountIds || []),
            currentAgent.accountId,
          ];
          feeConfigBuilder.addHbarFee(hbarFee, collectorId, finalExemptions);
          this.logger.info(
            `Setting HBAR fee: ${hbarFee} HBAR to be collected by ${collectorId}`
          );
        } catch (feeConfigError) {
          this.logger.error(
            `Error creating fee configuration: ${feeConfigError}`
          );

          feeConfigBuilder = undefined;
          this.logger.warn(
            'Proceeding to accept request without fees due to configuration error.'
          );
        }
      }

      this.logger.info(
        `Attempting to accept request Key: ${requestKey} (ID: ${numericRequestId}) from ${request.targetAccountId}`
      );
      const result = await this.hcsClient.handleConnectionRequest(
        inboundTopicId,
        request.targetAccountId,
        numericRequestId,
        feeConfigBuilder
      );

      if (!result?.connectionTopicId) {
        return `Error: Failed to accept connection request with key ${requestKey}. The SDK did not return a connection topic ID.`;
      }
      this.logger.info(
        `Successfully created connection topic: ${result.connectionTopicId}`
      );

      const connectionTopicId = result.connectionTopicId;

      let targetInboundTopic = '';
      try {
        const targetProfileData = await this.hcsClient.standardClient.retrieveProfile(request.targetAccountId);
        targetInboundTopic =
          targetProfileData?.topicInfo?.inboundTopic || '';
        if (!targetInboundTopic) {
          this.logger.warn(
            `Could not resolve target inbound topic for ${request.targetAccountId}`
          );
        }
      } catch (e) {
        this.logger.warn(
          `Error fetching target profile/topic for ${request.targetAccountId}: ${e}`
        );
      }

      const name = request.profileInfo?.display_name || request.profileInfo?.alias || `Agent ${request.targetAccountId}`;
      const newConnection: ActiveConnection = {
        targetAccountId: request.targetAccountId,
        targetAgentName: name,
        targetInboundTopicId: targetInboundTopic,
        connectionTopicId,
        profileInfo: request.profileInfo,
        created: new Date(),
        status: 'established',
      };

      this.stateManager.addActiveConnection(newConnection);
      connectionsManager.fetchConnectionData(request.targetAccountId);

      this.logger.info(`Removed request ${requestKey} from pending requests`);

      let feeMessage = '';
      if (hbarFee && hbarFee > 0 && feeConfigBuilder) {
        feeMessage = ` with a ${hbarFee} HBAR fee per message`;
      }

      const displayKey = request.uniqueRequestKey || requestKey;
      return `Successfully accepted connection request ${displayKey} from ${name} ${feeMessage}. Connection established on topic: ${connectionTopicId}.`;
    } catch (error) {
      this.logger.error(
        `Error accepting connection request ${requestKey}: ${error}`
      );

      return `Error accepting connection request ${requestKey}: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }
}

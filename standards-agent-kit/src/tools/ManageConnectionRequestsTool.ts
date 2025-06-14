import { StructuredTool, ToolParams } from '@langchain/core/tools';
import { z } from 'zod';
import { HCS10Client } from '../hcs10/HCS10Client';
import { IStateManager } from '../state/state-types';
import { Logger } from '@hashgraphonline/standards-sdk';

export interface ManageConnectionRequestsToolParams extends ToolParams {
  hcsClient: HCS10Client;
  stateManager: IStateManager;
}

/**
 * A tool for managing incoming connection requests in a LangChain-compatible way.
 * This tool allows an agent to list, view details of, and accept/reject incoming connection requests.
 */
export class ManageConnectionRequestsTool extends StructuredTool {
  name = 'manage_connection_requests';
  description =
    'Manage incoming connection requests. List pending requests, view details about requesting agents, and reject connection requests. Use the separate "accept_connection_request" tool to accept.';
  schema = z.object({
    action: z
      .enum(['list', 'view', 'reject'])
      .describe(
        'The action to perform: list all requests, view details of a specific request, or reject a request'
      ),
    requestKey: z
      .string()
      .optional()
      .describe(
        'The unique request key to view or reject (required for view and reject actions)'
      ),
  });

  private hcsClient: HCS10Client;
  private stateManager: IStateManager;
  private logger: Logger;
  private lastRefreshTime: number = 0;
  private refreshIntervalMs = 30000;

  constructor({
    hcsClient,
    stateManager,
    ...rest
  }: ManageConnectionRequestsToolParams) {
    super(rest);
    this.hcsClient = hcsClient;
    this.stateManager = stateManager;
    this.logger = Logger.getInstance({
      module: 'ManageConnectionRequestsTool',
      level: 'debug',
    });
  }

  protected async _call({
    action,
    requestKey,
  }: z.infer<this['schema']>): Promise<string> {
    const currentAgent = this.stateManager.getCurrentAgent();
    if (!currentAgent) {
      return 'Error: Cannot manage connection requests. No agent is currently active. Please register or select an agent first.';
    }

    if ((action === 'view' || action === 'reject') && requestKey === undefined) {
      return `Error: Request key is required for the "${action}" action. Use the "list" action first to see available requests.`;
    }

    try {
      await this.refreshRequestsIfNeeded();

      switch (action) {
        case 'list':
          return this.listRequests();
        case 'view':
          return this.viewRequest(requestKey!);
        case 'reject':
          return this.rejectRequest(requestKey!);
        default:
          return `Error: Unsupported action: ${action}`;
      }
    } catch (error) {
      this.logger.error(`Error in ManageConnectionRequestsTool: ${error}`);
      return `Error managing connection requests: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  private async refreshRequestsIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefreshTime > this.refreshIntervalMs) {
      await this.refreshRequests();
      this.lastRefreshTime = now;
    }
  }

  private async refreshRequests(): Promise<void> {
    try {
      const { accountId } = this.hcsClient.getAccountAndSigner();
      if (!accountId) {
        throw new Error('Could not determine account ID for current agent');
      }

      const connectionManager = this.stateManager.getConnectionsManager();
      if (!connectionManager) {
        throw new Error('ConnectionsManager not initialized');
      }

      await connectionManager.fetchConnectionData(accountId);
    } catch (error) {
      this.logger.error(`Error refreshing connection requests: ${error}`);
      throw error;
    }
  }

  private listRequests(): string {
    const connectionsManager = this.stateManager.getConnectionsManager();
    if (!connectionsManager) {
      return 'Error: ConnectionsManager not initialized';
    }

    const pendingRequests = connectionsManager.getPendingRequests();
    const needsConfirmation =
      connectionsManager.getConnectionsNeedingConfirmation();

    const allRequests = [...pendingRequests, ...needsConfirmation];

    if (allRequests.length === 0) {
      console.log('No pending connection requests found.', allRequests);
      return 'No pending connection requests found.';
    }

    let output = `Found ${allRequests.length} pending connection request(s):\n\n`;
    const sortedRequests = [...allRequests].sort(
      (a, b) => b.created.getTime() - a.created.getTime()
    );

    sortedRequests.forEach((request, index) => {
      // Create a display ID for the connection request
      const requestType = request.needsConfirmation ? '🟠 Incoming' : '⚪️ Outgoing';
      const requestIdDisplay = request.uniqueRequestKey ||
        `${request.connectionRequestId || request.inboundRequestId || 'unknown'}`;

      output += `${index + 1}. ${requestType} - Key: ${requestIdDisplay}\n`;
      output += `   ${request.needsConfirmation ? 'From' : 'To'}: ${
        request.targetAgentName || `Agent ${request.targetAccountId}`
      } (${request.targetAccountId})\n`;
      output += `   Sent/Rcvd: ${request.created.toLocaleString()}\n`;

      if (request.memo) {
        output += `   Memo: ${request.memo}\n`;
      }

      if (request.profileInfo && request.profileInfo.bio) {
        output += `   Bio: ${request.profileInfo.bio}\n`;
      }

      output += '\n';
    });

    output +=
      'To view more details about a request, use action="view" with the specific requestKey.\n';
    output +=
      'To reject a request, use action="reject" with the specific requestKey.';
    return output;
  }

  private viewRequest(requestKey: string): string {
    const connectionsManager = this.stateManager.getConnectionsManager();
    if (!connectionsManager) {
      return 'Error: ConnectionsManager not initialized';
    }

    const pendingRequests = connectionsManager.getPendingRequests();
    const needsConfirmation =
      connectionsManager.getConnectionsNeedingConfirmation();

    const allRequests = [...pendingRequests, ...needsConfirmation];

    // Find the request with the matching unique key or fallback to sequence number
    const request = allRequests.find(
      (r) =>
        (r.uniqueRequestKey === requestKey) ||
        (r.connectionRequestId?.toString() === requestKey) ||
        (r.inboundRequestId?.toString() === requestKey)
    );

    if (!request) {
      return `Error: Request with key ${requestKey} not found or no longer pending.`;
    }

    // Create a display ID for the connection request
    const requestType = request.needsConfirmation ? 'Incoming' : 'Outgoing';
    const uniqueKey = request.uniqueRequestKey ||
      `${request.connectionRequestId || request.inboundRequestId || 'unknown'}`;

    let output = `Details for ${requestType} connection request: ${uniqueKey}\n\n`;
    output += `${request.needsConfirmation ? 'Requestor' : 'Target'} ID: ${request.targetAccountId}\n`;
    output += `${request.needsConfirmation ? 'Requestor' : 'Target'} Name: ${
      request.targetAgentName || `Agent ${request.targetAccountId}`
    }\n`;
    output += `Received: ${request.created.toLocaleString()}\n`;

    if (request.memo) {
      output += `Memo: ${request.memo}\n`;
    }

    if (request.profileInfo) {
      output += '\nAgent Profile Information:\n';

      if (request.profileInfo.display_name || request.profileInfo.alias) {
        output += `Name: ${
          request.profileInfo.display_name || request.profileInfo.alias
        }\n`;
      }

      if (request.profileInfo.type !== undefined) {
        output += `Type: ${request.profileInfo.type}\n`;
      }

      if (request.profileInfo.bio) {
        output += `Bio: ${request.profileInfo.bio}\n`;
      }
    }

    output += '\nActions:\n';
    output += `- To reject this request: action="reject", requestKey="${uniqueKey}"\n`;
    output +=
      'Use the separate "accept_connection_request" tool to accept requests.';
    return output;
  }

  private async rejectRequest(requestKey: string): Promise<string> {
    const connectionsManager = this.stateManager.getConnectionsManager();
    if (!connectionsManager) {
      return 'Error: ConnectionsManager not initialized';
    }

    const pendingRequests = connectionsManager.getPendingRequests();
    const needsConfirmation =
      connectionsManager.getConnectionsNeedingConfirmation();

    const allRequests = [...pendingRequests, ...needsConfirmation];

    // Find the request with the matching unique key or fallback to sequence number
    const request = allRequests.find(
      (r) =>
        (r.uniqueRequestKey === requestKey) ||
        (r.connectionRequestId?.toString() === requestKey) ||
        (r.inboundRequestId?.toString() === requestKey)
    );

    if (!request) {
      return `Error: Request with key ${requestKey} not found or no longer pending.`;
    }

    // Mark as processed in ConnectionsManager based on the appropriate ID
    if (request.inboundRequestId) {
      // For needs_confirmation requests
      connectionsManager.markConnectionRequestProcessed(
        request.targetInboundTopicId || '',
        request.inboundRequestId
      );
    } else if (request.connectionRequestId) {
      // For pending requests
      connectionsManager.markConnectionRequestProcessed(
        request.originTopicId || '',
        request.connectionRequestId
      );
    }

    return `Connection request from ${
      request.targetAgentName || `Agent ${request.targetAccountId}`
    } was rejected.`;
  }
}

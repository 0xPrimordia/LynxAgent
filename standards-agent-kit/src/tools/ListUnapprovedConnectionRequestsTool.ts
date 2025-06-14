import { StructuredTool, ToolParams } from '@langchain/core/tools';
import { z } from 'zod';
import {
  IStateManager,
} from '../state/state-types';
import { HCS10Client } from '../hcs10/HCS10Client';
import {
  Logger,
  Connection,
} from '@hashgraphonline/standards-sdk';


type ListPendingRequestsToolParams = ToolParams & {
  hcsClient: HCS10Client;
  stateManager: IStateManager;
};

export class ListUnapprovedConnectionRequestsTool extends StructuredTool {
  name = 'list_unapproved_connection_requests';
  description =
    'Lists all connection requests that are not fully established, including incoming requests needing approval and outgoing requests waiting for confirmation.';
  schema = z.object({
    sortBy: z
      .enum(['time_asc', 'time_desc', 'name_asc', 'name_desc'])
      .optional()
      .describe(
        'Optional sorting criteria for the requests list (default: time_desc, newest first)'
      ),
    limit: z
      .number()
      .optional()
      .describe(
        'Optional limit on the number of requests to return (default: all)'
      ),
  });

  private hcsClient: HCS10Client;
  private stateManager: IStateManager;
  private logger: Logger;

  constructor({
    hcsClient,
    stateManager,
    ...rest
  }: ListPendingRequestsToolParams) {
    super(rest);
    this.hcsClient = hcsClient;
    this.stateManager = stateManager;
    this.logger = Logger.getInstance({
      module: 'ListPendingRequestsTool',
      level: 'debug',
    });
  }

  protected async _call({
    sortBy = 'time_desc',
    limit,
  }: z.infer<this['schema']>): Promise<string> {
    const currentAgent = this.stateManager.getCurrentAgent();
    if (!currentAgent) {
      return 'Error: Cannot list pending requests. No agent is currently active. Please register or select an agent first.';
    }

    try {
      const pendingRequests = await this.findAllPendingRequests();
      return this.formatRequestsList(pendingRequests, sortBy, limit);
    } catch (error) {
      this.logger.error(`Error in ${this.name}: ${error}`);
      return `Error listing pending requests: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  /**
   * Processes the connection connectionMap to find all requests
   * that are not fully established (incoming unapproved and outgoing pending).
   */
  private async findAllPendingRequests(): Promise<Connection[]> {
    const connectionsManager = this.stateManager.getConnectionsManager();
    if (!connectionsManager) {
      return [];
    }
    const currentAgent = this.stateManager.getCurrentAgent();
    if (!currentAgent) {
      return [];
    }

    await connectionsManager.fetchConnectionData(currentAgent.accountId);
    const pendingRequests = connectionsManager.getPendingRequests();
    const connectionsNeedingConfirmation = connectionsManager.getConnectionsNeedingConfirmation();

    return [...pendingRequests, ...connectionsNeedingConfirmation];
  }

  /**
   * Formats the list of pending requests for display.
   */
  private formatRequestsList(
    requests: Connection[],
    sortBy: string,
    limit?: number
  ): string {
    if (requests.length === 0) {
      return 'No pending connection requests found (incoming or outgoing).';
    }

    const sortedRequests = this.sortRequests(requests, sortBy);
    const limitedRequests = limit
      ? sortedRequests.slice(0, limit)
      : sortedRequests;

    let output = `Found ${requests.length} pending connection request(s):\n\n`;

    limitedRequests.forEach((request, index) => {
      const statusIndicator =
        request.status === 'needs_confirmation'
          ? '🟠 Incoming'
          : '⚪️ Outgoing';
      output += `${index + 1}. ${statusIndicator} - ID: ${request.uniqueRequestKey}\n`;
      output += `   ${
        request.status === 'needs_confirmation' ? 'From:' : 'To:  '
      } ${request.targetAgentName} (${request.targetAccountId})\n`;
      output += `   Sent/Rcvd: ${request.created.toLocaleString()}\n`;
      if (request.memo) {
        output += `   Memo: ${request.memo}\n`;
      }
      if (request.profileInfo?.bio) {
        output += `   Bio: ${request.profileInfo.bio.substring(0, 100)}${
          request.profileInfo.bio.length > 100 ? '...' : ''
        }\n`;
      }
      output += '\n';
    });

    output +=
      'Use related tools (manage_requests, accept_request) to handle these items.';
    return output;
  }

  /**
   * Sorts connection requests based on the specified criteria.
   */
  private sortRequests(
    requests: Connection[],
    sortBy: string
  ): Connection[] {
    const requestsCopy = [...requests];

    switch (sortBy) {
      case 'time_asc':
        return requestsCopy.sort(
          (a, b) => a.created.getTime() - b.created.getTime()
        );
      case 'time_desc':
        return requestsCopy.sort(
          (a, b) => b.created.getTime() - a.created.getTime()
        );
      case 'name_asc':
        return requestsCopy.sort((a, b) =>
          a.targetAgentName?.localeCompare(b?.targetAgentName || '') || 0
        );
      case 'name_desc':
        return requestsCopy.sort((a, b) =>
          b.targetAgentName?.localeCompare(a?.targetAgentName || '') || 0
        );
      default:
        return requestsCopy.sort(
          (a, b) => b.created.getTime() - a.created.getTime()
        );
    }
  }
}

import { StructuredTool, ToolParams } from '@langchain/core/tools';
import { z } from 'zod';
import { IStateManager, ActiveConnection } from '../state/state-types';
import { HCS10Client } from '../hcs10/HCS10Client';
import { Connection, Logger } from '@hashgraphonline/standards-sdk';

export interface ListConnectionsToolParams extends ToolParams {
  stateManager: IStateManager;
  hcsClient?: HCS10Client;
}

/**
 * A tool to list currently active HCS-10 connections stored in the state manager.
 * Enhanced to show more details similar to moonscape's implementation.
 */
export class ListConnectionsTool extends StructuredTool {
  name = 'list_connections';
  description =
    'Lists the currently active HCS-10 connections with detailed information. Shows connection status, agent details, and recent activity. Use this to get a comprehensive view of all active connections.';
  schema = z.object({
    includeDetails: z
      .boolean()
      .optional()
      .describe(
        'Whether to include detailed information about each connection'
      ),
    showPending: z
      .boolean()
      .optional()
      .describe('Whether to include pending connection requests'),
  });

  private stateManager: IStateManager;
  private hcsClient?: HCS10Client;
  private logger: Logger;

  constructor({ stateManager, hcsClient, ...rest }: ListConnectionsToolParams) {
    super(rest);
    this.stateManager = stateManager;
    this.hcsClient = hcsClient;
    this.logger = new Logger({ module: 'ListConnectionsTool' });
  }

  protected async _call(args: z.infer<this['schema']>): Promise<string> {
    const includeDetails = args.includeDetails ?? true;
    const showPending = args.showPending ?? true;

    const connections = await this.getEnhancedConnections();

    if (connections.length === 0) {
      return 'There are currently no active connections.';
    }

    const activeConnections = connections.filter(
      (c) => c.status === 'established'
    );

    const pendingConnections = connections.filter((c) => c.isPending);

    const needsConfirmation = connections.filter((c) => c.needsConfirmation);

    let output = '';

    if (activeConnections.length > 0) {
      output += `🟢 Active Connections (${activeConnections.length}):\n`;
      activeConnections.forEach((conn, index) => {
        output += this.formatConnection(conn, index, includeDetails);
      });
      output += '\n';
    }

    if (showPending && needsConfirmation.length > 0) {
      output += `🟠 Connections Needing Confirmation (${needsConfirmation.length}):\n`;
      needsConfirmation.forEach((conn, index) => {
        output += this.formatConnection(conn, index, includeDetails);
      });
      output += '\n';
    }

    if (showPending && pendingConnections.length > 0) {
      output += `⚪ Pending Connection Requests (${pendingConnections.length}):\n`;
      pendingConnections.forEach((conn, index) => {
        output += this.formatConnection(conn, index, includeDetails);
      });
    }

    return output.trim();
  }

  private formatConnection(
    conn: Connection,
    index: number,
    includeDetails: boolean
  ): string {
    let output = `${index + 1}. ${
      conn.profileInfo?.display_name || conn.targetAgentName || 'Unknown Agent'
    } (${conn.targetAccountId})\n`;
    const displayTopicId = conn.isPending
      ? '(Pending Request)'
      : conn.connectionTopicId;
    output += `   Topic: ${displayTopicId}\n`;
    const statusText = conn.status || 'unknown';
    output += `   Status: ${statusText}\n`;

    if (includeDetails) {
      if (conn.profileInfo?.bio) {
        output += `   Bio: ${conn.profileInfo.bio.substring(0, 100)}${
          conn.profileInfo.bio.length > 100 ? '...' : ''
        }\n`;
      }

      if (conn.created) {
        const createdLabel = conn.isPending
          ? 'Request sent'
          : 'Connection established';
        output += `   ${createdLabel}: ${conn.created.toLocaleString()}\n`;
      }

      if (conn.lastActivity) {
        output += `   Last activity: ${conn.lastActivity.toLocaleString()}\n`;
      }
    }

    return output;
  }

  private async getEnhancedConnections(): Promise<Connection[]> {
    if (!this.hcsClient) {
      return this.stateManager.listConnections() as Connection[];
    }

    try {
      const { accountId } = this.hcsClient.getAccountAndSigner();
      if (!accountId) {
        return this.stateManager.listConnections() as Connection[];
      }

      const connectionManager = this.stateManager.getConnectionsManager();
      if (!connectionManager) {
        this.logger.error('ConnectionsManager not initialized');
        return this.stateManager.listConnections() as Connection[];
      }

      const connections = await connectionManager.fetchConnectionData(
        accountId
      );

      for (const connection of connections) {
        this.stateManager.updateOrAddConnection(connection as ActiveConnection);
      }

      return connections;
    } catch (error) {
      console.error('Error fetching connection data:', error);
      return this.stateManager.listConnections() as Connection[];
    }
  }
}

import { HCS10Client } from '../hcs10/HCS10Client';
import { StructuredTool, ToolParams } from '@langchain/core/tools';
import { z } from 'zod';
// Import FeeConfigBuilder if needed for explicit fee handling
// import { FeeConfigBuilder } from '@hashgraphonline/standards-sdk';
import { Logger } from '@hashgraphonline/standards-sdk';
import {
  IStateManager,
  ActiveConnection,
} from '../state/state-types'; // Corrected import path/name

export interface ConnectionToolParams extends ToolParams {
  client: HCS10Client;
  stateManager: IStateManager;
}

/**
 * ConnectionTool monitors the *current* agent's inbound topic for connection requests
 * and automatically handles them using the HCS-10 standard SDK flow.
 * Use this ONLY to passively LISTEN for other agents trying to connect TO YOU.
 * This tool takes NO arguments and does NOT start outgoing connections.
 */
export class ConnectionTool extends StructuredTool {
  name = 'monitor_connections';
  description =
    "Starts passively LISTENING on the current agent's own inbound topic for INCOMING HCS-10 connection requests. Handles received requests automatically. Takes NO arguments. DO NOT use this to start a new connection TO someone else.";
  public client: HCS10Client;
  public logger: Logger;
  private stateManager: IStateManager; // Renamed property
  private isMonitoring: boolean = false; // Flag to prevent multiple monitors
  private monitoringTopic: string | null = null;

  // Schema now takes NO arguments
  schema = z.object({});

  /**
   * @param client - Instance of HCS10Client.
   * @param stateManager - Instance of StateManager for shared state management.
   */
  constructor({ client, stateManager, ...rest }: ConnectionToolParams) {
    super(rest);
    this.client = client;
    this.stateManager = stateManager; // Renamed assignment
    this.logger = Logger.getInstance({
      module: 'ConnectionTool',
      level: 'info',
    });
  }

  /**
   * Initiates the connection request monitoring process in the background.
   * Gets the inbound topic ID from the configured client.
   */
  async _call(/* _input: z.infer<typeof this.schema> */): Promise<string> {
    // Get inboundTopicId from the client
    let inboundTopicId: string;
    try {
      // Assuming getInboundTopicId() is implemented and available
      inboundTopicId = await this.client.getInboundTopicId();
    } catch (error) {
      const errorMsg = `Error getting inbound topic ID for monitoring: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.logger.error(errorMsg);
      return errorMsg;
    }

    if (!inboundTopicId) {
      return 'Error: Could not determine the inbound topic ID for the current agent.';
    }

    if (this.isMonitoring) {
      if (this.monitoringTopic === inboundTopicId) {
        return `Already monitoring topic ${inboundTopicId}.`;
      } else {
        return `Error: Already monitoring a different topic (${this.monitoringTopic}). Stop the current monitor first.`;
        // TODO: Add a mechanism to stop the monitor if needed.
      }
    }

    this.isMonitoring = true;
    this.monitoringTopic = inboundTopicId;
    this.logger.debug(
      `Initiating connection request monitoring for topic ${inboundTopicId}...`
    );

    // Start the monitoring process asynchronously without awaiting it
    // This allows the tool call to return quickly.
    this.monitorIncomingRequests(inboundTopicId).catch((error) => {
      this.logger.error(
        `Monitoring loop for ${inboundTopicId} encountered an unrecoverable error:`,
        error
      );
      this.isMonitoring = false; // Reset flag on loop failure
      this.monitoringTopic = null;
    });

    return `Started monitoring inbound topic ${inboundTopicId} for connection requests in the background.`;
  }

  /**
   * The core monitoring loop.
   */
  private async monitorIncomingRequests(inboundTopicId: string): Promise<void> {
    this.logger.debug(`Monitoring inbound topic ${inboundTopicId}...`);

    let lastProcessedMessageSequence = 0;
    const processedRequestIds = new Set<number>(); // Track processed requests within this monitoring session

    // Main monitoring loop
    while (this.isMonitoring && this.monitoringTopic === inboundTopicId) {
      try {
        const messagesResult = await this.client.getMessages(inboundTopicId);

        const allMessages = messagesResult.messages;

        const connectionRequests = allMessages.filter(
          (msg) =>
            msg.op === 'connection_request' &&
            typeof msg.sequence_number === 'number' // Keep filtering by sequence number if needed, or remove if checking existing confirmations is sufficient
            // msg.sequence_number > lastProcessedMessageSequence // Temporarily remove or adjust this if checking confirmations is the primary method
        );

        // Filter out already processed connection requests
        const newConnectionRequests = connectionRequests.filter(msg => {
          if (msg.connection_request_id === undefined) {
            return true; // Keep requests without IDs
          }
          
          // Skip already processed requests
          const isProcessed = this.isConnectionRequestProcessed(msg.connection_request_id);
          if (isProcessed) {
            this.logger.debug(`Skipping already processed connection request #${msg.connection_request_id}`);
            return false;
          }
          
          return true;
        });
        
        // Process only new connection requests
        const processedCount = connectionRequests.length - newConnectionRequests.length;
        if (processedCount > 0) {
          this.logger.debug(`Skipped ${processedCount} already processed connection requests`);
        }
        
        // Process only new connection requests
        for (const request of newConnectionRequests) {
          // Update lastProcessedMessageSequence regardless of handling outcome to avoid re-checking handled/skipped messages in future loops
          lastProcessedMessageSequence = Math.max(
            lastProcessedMessageSequence,
            request.sequence_number || 0 // Use 0 if sequence_number is undefined (though filter should prevent this)
          );

          const connectionRequestId = request.sequence_number;
          if (!connectionRequestId) {
             continue; // Skip if sequence number is missing
          }

          // --- Check if already handled ---
          const alreadyHandled = allMessages.some(
            (m) => m.op === 'connection_created' && m.connection_id === connectionRequestId
          );

          if (alreadyHandled) {
            this.logger.debug(
              `Connection request #${connectionRequestId} already handled (found connection_created). Skipping.`
            );
            continue; // Skip to the next request
          }
          // --- End Check ---

          // Extract requesting account ID from the message's operator_id field (topic@account)
          const senderOperatorId = request.operator_id || '';
          const requestingAccountId = senderOperatorId.split('@')[1] || null;

          if (!requestingAccountId) {
            this.logger.warn(
              `Could not determine requesting account ID from operator_id '${senderOperatorId}' for request #${connectionRequestId}. Skipping.`
            );
            continue;
          }

          if (processedRequestIds.has(connectionRequestId)) {
            this.logger.info(
              `Connection request #${connectionRequestId} already processed in this session. Skipping.`
            );
            continue;
          }

          this.logger.info(
            `Processing connection request #${connectionRequestId} from account ${requestingAccountId}...`
          );

          try {
            // Handle the connection request using the HCS10Client wrapper
            const confirmation = await this.client.handleConnectionRequest(
              inboundTopicId,
              requestingAccountId,
              connectionRequestId
            );

            processedRequestIds.add(connectionRequestId);
            this.logger.info(
              `Connection confirmed for request #${connectionRequestId}. New connection topic: ${confirmation.connectionTopicId}`
            );

            // Use stateManager to add connection
            const newConnection: ActiveConnection = {
              targetAccountId: requestingAccountId,
              targetAgentName: `Agent ${requestingAccountId}`,
              targetInboundTopicId: 'N/A',
              connectionTopicId: confirmation.connectionTopicId,
            };
            this.stateManager.addActiveConnection(newConnection);
            this.logger.info(
              `Added new active connection to ${requestingAccountId} state.`
            );

            // Mark as processed after handling
            if (connectionRequestId !== undefined) {
              this.markConnectionRequestProcessed(connectionRequestId);
            }
          } catch (handleError) {
            this.logger.error(
              `Error handling connection request #${connectionRequestId} from ${requestingAccountId}:`,
              handleError
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Error fetching or processing messages for topic ${inboundTopicId}:`,
          error
        );
        // Implement backoff or error threshold if needed
      }

      // Wait before the next poll
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Poll every 5 seconds (adjust as needed)
    }

    this.logger.info(`Monitoring loop stopped for topic ${inboundTopicId}.`);
    this.isMonitoring = false; // Ensure flag is reset when loop exits
    this.monitoringTopic = null;
  }

  // Optional: Method to explicitly stop monitoring
  public stopMonitoring(): void {
    if (this.isMonitoring) {
      this.logger.info(
        `Stopping monitoring for topic ${this.monitoringTopic}...`
      );
      this.isMonitoring = false;
      this.monitoringTopic = null;
    } else {
      this.logger.info('Monitor is not currently running.');
    }
  }

  /**
   * Custom method to check if a connection request has already been processed
   * Helps prevent duplicate connections from being created
   */
  private isConnectionRequestProcessed(requestId: number): boolean {
    if (!this.stateManager) {
      return false;
    }
    
    // Check if the state manager has a processedConnectionRequests property
    // @ts-ignore - We're accessing a potential custom property
    const processedRequests = this.stateManager.processedConnectionRequests;
    if (processedRequests && processedRequests instanceof Set) {
      return processedRequests.has(requestId);
    }
    
    return false;
  }

  /**
   * Custom method to mark a connection request as processed
   */
  private markConnectionRequestProcessed(requestId: number): void {
    if (!this.stateManager) {
      return;
    }
    
    // Try to get or create the processed requests set
    // @ts-ignore - We're accessing/setting a potential custom property
    if (!this.stateManager.processedConnectionRequests) {
      // @ts-ignore
      this.stateManager.processedConnectionRequests = new Set<number>();
    }
    
    // @ts-ignore
    this.stateManager.processedConnectionRequests.add(requestId);
  }
}

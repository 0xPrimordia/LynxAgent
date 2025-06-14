/**
 * @jest-environment jsdom
 */
import { OpenConvaiState } from '../../src/state/open-convai-state';
import { ConnectionsManager, HCS10BaseClient } from '@hashgraphonline/standards-sdk';
import { ActiveConnection } from '../../src/state/state-types';

// Mock the updateEnvFile function
jest.mock('../../src/utils/state-tools', () => ({
  updateEnvFile: jest.fn().mockResolvedValue(undefined),
}));

describe('OpenConvaiState', () => {
  let state: OpenConvaiState;
  let mockBaseClient: HCS10BaseClient;
  let mockConnectionsManager: ConnectionsManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a simple mock base client
    mockBaseClient = {
      getMessages: jest.fn(),
      submitMessage: jest.fn(),
    } as unknown as HCS10BaseClient;

    // Create the state manager
    state = new OpenConvaiState();

    // Initialize ConnectionsManager and then mock its methods
    mockConnectionsManager = state.initializeConnectionsManager(mockBaseClient);

    // Mock the ConnectionsManager methods after it's been created
    mockConnectionsManager.clearAll = jest.fn();
    mockConnectionsManager.updateOrAddConnection = jest.fn();
    mockConnectionsManager.getAllConnections = jest.fn().mockReturnValue([]);
    mockConnectionsManager.getConnectionByTopicId = jest.fn();
    mockConnectionsManager.getConnectionByAccountId = jest.fn();
    mockConnectionsManager.fetchConnectionData = jest.fn().mockResolvedValue([]);
  });

  describe('setCurrentAgent', () => {
    it('should set the current agent and clear connections', () => {
      const agent = {
        name: 'Test Agent',
        accountId: '0.0.12345',
        inboundTopicId: '0.0.67890',
        outboundTopicId: '0.0.67891',
      };

      state.setCurrentAgent(agent);

      expect(state.getCurrentAgent()).toEqual(agent);
      expect(mockConnectionsManager.clearAll).toHaveBeenCalled();
    });
  });

  describe('connection management', () => {
    const testConnection: ActiveConnection = {
      targetAccountId: '0.0.54321',
      targetAgentName: 'Target Agent',
      targetInboundTopicId: '0.0.98765',
      connectionTopicId: '0.0.12345',
      status: 'established',
      created: new Date('2023-01-01'),
      metadata: {
        requestId: 12345,
      },
    };

    it('should add an active connection', () => {
      state.addActiveConnection(testConnection);

      expect(mockConnectionsManager.updateOrAddConnection).toHaveBeenCalled();

      // Verify conversion to SDK Connection format
      const calledWithArg = (mockConnectionsManager.updateOrAddConnection as jest.Mock).mock.calls[0][0];

      expect(calledWithArg).toMatchObject({
        connectionTopicId: testConnection.connectionTopicId,
        targetAccountId: testConnection.targetAccountId,
        status: 'established',
        connectionRequestId: testConnection.metadata?.requestId,
      });
    });

    it('should convert and return connections from ConnectionsManager', () => {
      const mockSdkConnection = {
        connectionTopicId: '0.0.12345',
        targetAccountId: '0.0.54321',
        targetAgentName: 'Target Agent',
        status: 'established',
        isPending: false,
        needsConfirmation: false,
        created: new Date('2023-01-01'),
        processed: true,
        connectionRequestId: 12345,
      };

      (mockConnectionsManager.getAllConnections as jest.Mock).mockReturnValue([mockSdkConnection]);

      const connections = state.listConnections();

      expect(connections.length).toBe(1);
      expect(connections[0]).toMatchObject({
        connectionTopicId: mockSdkConnection.connectionTopicId,
        targetAccountId: mockSdkConnection.targetAccountId,
        metadata: {
          requestId: mockSdkConnection.connectionRequestId,
        },
      });
    });

    it('should find connection by topic ID', () => {
      const mockSdkConnection = {
        connectionTopicId: '0.0.12345',
        targetAccountId: '0.0.54321',
        targetAgentName: 'Target Agent',
        status: 'established',
        isPending: false,
        needsConfirmation: false,
        created: new Date('2023-01-01'),
        processed: true,
      };

      (mockConnectionsManager.getConnectionByTopicId as jest.Mock).mockReturnValue(mockSdkConnection);

      const connection = state.getConnectionByIdentifier('0.0.12345');

      expect(connection).toBeDefined();
      expect(connection?.connectionTopicId).toBe('0.0.12345');
      expect(mockConnectionsManager.getConnectionByTopicId).toHaveBeenCalledWith('0.0.12345');
    });

    it('should find connection by account ID', () => {
      const mockSdkConnection = {
        connectionTopicId: '0.0.12345',
        targetAccountId: '0.0.54321',
        targetAgentName: 'Target Agent',
        status: 'established',
        isPending: false,
        needsConfirmation: false,
        created: new Date('2023-01-01'),
        processed: true,
      };

      (mockConnectionsManager.getConnectionByTopicId as jest.Mock).mockReturnValue(null);
      (mockConnectionsManager.getConnectionByAccountId as jest.Mock).mockReturnValue(mockSdkConnection);

      const connection = state.getConnectionByIdentifier('0.0.54321');

      expect(connection).toBeDefined();
      expect(connection?.targetAccountId).toBe('0.0.54321');
      expect(mockConnectionsManager.getConnectionByAccountId).toHaveBeenCalledWith('0.0.54321');
    });
  });

  describe('timestamp management', () => {
    it('should initialize and update timestamps', () => {
      const connectionTopicId = '0.0.12345';
      const initialTime = Date.now() * 1_000_000;
      const laterTime = initialTime + 1_000_000;

      // First check that uninitialized timestamps return 0
      const uninitializedTimestamp = state.getLastTimestamp(connectionTopicId);
      expect(uninitializedTimestamp).toBe(0);

      // We need to first initialize the timestamp by doing an addActiveConnection
      // because updateTimestamp only works on already initialized timestamps
      state.addActiveConnection({
        targetAccountId: '0.0.54321',
        targetAgentName: 'Test Agent',
        targetInboundTopicId: '0.0.98765',
        connectionTopicId: connectionTopicId,
        status: 'established'
      });

      // Now the timestamp should be initialized
      expect(state.getLastTimestamp(connectionTopicId)).not.toBe(0);

      // Update to a specific timestamp
      state.updateTimestamp(connectionTopicId, initialTime);
      expect(state.getLastTimestamp(connectionTopicId)).toBe(initialTime);

      // Update to later time
      state.updateTimestamp(connectionTopicId, laterTime);
      expect(state.getLastTimestamp(connectionTopicId)).toBe(laterTime);

      // Try to update to earlier time (should not update)
      state.updateTimestamp(connectionTopicId, initialTime);
      expect(state.getLastTimestamp(connectionTopicId)).toBe(laterTime);
    });
  });

  describe('connection request management', () => {
    it('should add, list, and remove connection requests', () => {
      const request = {
        id: 12345,
        requestorId: '0.0.54321',
        requestorName: 'Requestor',
        timestamp: new Date('2023-01-01'),
      };

      state.addConnectionRequest(request);

      const requests = state.listConnectionRequests();
      expect(requests.length).toBe(1);
      expect(requests[0]).toEqual(request);

      const foundRequest = state.getConnectionRequestById(12345);
      expect(foundRequest).toEqual(request);

      state.removeConnectionRequest(12345);
      expect(state.listConnectionRequests().length).toBe(0);

      state.addConnectionRequest(request);
      state.clearConnectionRequests();
      expect(state.listConnectionRequests().length).toBe(0);
    });
  });

  describe('status conversion', () => {
    it('should correctly convert between status formats', () => {
      // Create a connection with different status values
      const establishedConn = {
        connectionTopicId: '0.0.1',
        targetAccountId: '0.0.2',
        status: 'established',
        isPending: false,
        needsConfirmation: false,
        created: new Date(),
        processed: true
      };

      const pendingConn = {
        ...establishedConn,
        status: 'pending',
        isPending: true
      };

      const needsConfirmationConn = {
        ...establishedConn,
        status: 'needs_confirmation',
        needsConfirmation: true
      };

      const closedConn = {
        ...establishedConn,
        status: 'closed'
      };

      (mockConnectionsManager.getAllConnections as jest.Mock).mockReturnValue([
        establishedConn, pendingConn, needsConfirmationConn, closedConn
      ]);

      const connections = state.listConnections();

      expect(connections[0].status).toBe('established');
      expect(connections[1].status).toBe('pending');
      expect(connections[2].status).toBe('needs confirmation');
      expect(connections[3].status).toBe('established'); // closed maps to established
    });
  });
});
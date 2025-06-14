import { HCS10Client, StandardNetworkType } from './hcs10/HCS10Client';
import { RegisterAgentTool } from './tools/RegisterAgentTool';
import { SendMessageTool } from './tools/SendMessageTool';
import { ConnectionTool } from './tools/ConnectionTool';
import { IStateManager } from './state/state-types';
import { OpenConvaiState } from './state/open-convai-state';
import { FindRegistrationsTool } from './tools/FindRegistrationsTool';
import { InitiateConnectionTool } from './tools/InitiateConnectionTool';
import { ListConnectionsTool } from './tools/ListConnectionsTool';
import { SendMessageToConnectionTool } from './tools/SendMessageToConnectionTool';
import { CheckMessagesTool } from './tools/CheckMessagesTool';
import { ConnectionMonitorTool } from './tools/ConnectionMonitorTool';
import { ManageConnectionRequestsTool } from './tools/ManageConnectionRequestsTool';
import { AcceptConnectionRequestTool } from './tools/AcceptConnectionRequestTool';
import { RetrieveProfileTool } from './tools/RetrieveProfileTool';
import { ListUnapprovedConnectionRequestsTool } from './tools/ListUnapprovedConnectionRequestsTool';
import { Logger } from '@hashgraphonline/standards-sdk';
import { ENV_FILE_PATH } from './utils/state-tools';

export interface HCS10ClientConfig {
  operatorId?: string;
  operatorKey?: string;
  network?: StandardNetworkType;
  useEncryption?: boolean;
  registryUrl?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface HCS10InitializationOptions {
  clientConfig?: HCS10ClientConfig;
  stateManager?: IStateManager;
  createAllTools?: boolean;
  monitoringClient?: boolean;
}

/**
 * Tool collection containing all available tools from the standards-agent-kit
 */
export interface HCS10Tools {
  registerAgentTool: RegisterAgentTool;
  findRegistrationsTool: FindRegistrationsTool;
  retrieveProfileTool: RetrieveProfileTool;
  initiateConnectionTool: InitiateConnectionTool;
  listConnectionsTool: ListConnectionsTool;
  sendMessageToConnectionTool: SendMessageToConnectionTool;
  checkMessagesTool: CheckMessagesTool;
  sendMessageTool: SendMessageTool;
  connectionTool: ConnectionTool;
  connectionMonitorTool: ConnectionMonitorTool;
  manageConnectionRequestsTool: ManageConnectionRequestsTool;
  acceptConnectionRequestTool: AcceptConnectionRequestTool;
  listUnapprovedConnectionRequestsTool: ListUnapprovedConnectionRequestsTool;
}

/**
 * Initializes the HCS10 client and returns pre-registered LangChain tools.
 *
 * @param options - Initialization options
 * @returns Object containing hcs10Client and requested tools
 */
export function initializeHCS10Client(options?: HCS10InitializationOptions): {
  hcs10Client: HCS10Client;
  monitoringClient?: HCS10Client;
  tools: Partial<HCS10Tools>;
  stateManager: IStateManager;
} {
  // Set up the configuration
  const config = options?.clientConfig || {};

  // Use environment variables as fallbacks if not explicitly provided
  const operatorId = config.operatorId || process.env.HEDERA_OPERATOR_ID;
  const operatorPrivateKey =
    config.operatorKey || process.env.HEDERA_OPERATOR_KEY;

  // Get network from config or env, default to testnet
  const networkEnv = config.network || process.env.HEDERA_NETWORK || 'testnet';

  // Validate and cast network type
  let network: StandardNetworkType;
  if (networkEnv === 'mainnet') {
    network = 'mainnet';
  } else if (networkEnv === 'testnet') {
    network = 'testnet';
  } else {
    console.warn(
      `Unsupported network specified: '${networkEnv}'. Defaulting to 'testnet'.`
    );
    network = 'testnet'; // Default to testnet if invalid/unsupported
  }

  if (!operatorId || !operatorPrivateKey) {
    throw new Error(
      'Operator ID and private key must be provided either through options or environment variables.'
    );
  }

  // Set up logging
  const logger = Logger.getInstance({
    level: config.logLevel || 'info',
  });

  // Create or use provided state manager
  const stateManager =
    options?.stateManager ||
    new OpenConvaiState({
      defaultEnvFilePath: ENV_FILE_PATH,
      defaultPrefix: 'TODD', // Keep backward compatibility with existing demos
    });
  logger.info('State manager initialized');

  // Instantiate primary HCS10Client
  const hcs10Client = new HCS10Client(operatorId, operatorPrivateKey, network, {
    useEncryption: config.useEncryption,
    registryUrl: config.registryUrl,
  });
  logger.info(`HCS10Client initialized for ${operatorId} on ${network}`);

  // Create monitoring client if requested
  let monitoringClient: HCS10Client | undefined;
  if (options?.monitoringClient) {
    monitoringClient = new HCS10Client(
      operatorId,
      operatorPrivateKey,
      network,
      {
        useEncryption: config.useEncryption,
        registryUrl: config.registryUrl,
        logLevel: 'error', // Reduce logging noise for monitoring client
      }
    );
    logger.info('Monitoring client initialized');
  }

  // Initialize the tools object
  const tools: Partial<HCS10Tools> = {};

  // Always create these core tools
  tools.registerAgentTool = new RegisterAgentTool(hcs10Client, stateManager);
  tools.sendMessageTool = new SendMessageTool(hcs10Client);
  tools.connectionTool = new ConnectionTool({
    client: monitoringClient || hcs10Client,
    stateManager,
  });

  // Create all tools if requested
  if (options?.createAllTools) {
    tools.findRegistrationsTool = new FindRegistrationsTool({
      hcsClient: hcs10Client,
    });
    tools.retrieveProfileTool = new RetrieveProfileTool(hcs10Client);
    tools.initiateConnectionTool = new InitiateConnectionTool({
      hcsClient: hcs10Client,
      stateManager,
    });
    tools.listConnectionsTool = new ListConnectionsTool({
      hcsClient: hcs10Client,
      stateManager,
    });
    tools.sendMessageToConnectionTool = new SendMessageToConnectionTool({
      hcsClient: hcs10Client,
      stateManager,
    });
    tools.checkMessagesTool = new CheckMessagesTool({
      hcsClient: hcs10Client,
      stateManager,
    });
    tools.connectionMonitorTool = new ConnectionMonitorTool({
      hcsClient: monitoringClient || hcs10Client,
      stateManager,
    });
    tools.manageConnectionRequestsTool = new ManageConnectionRequestsTool({
      hcsClient: hcs10Client,
      stateManager,
    });
    tools.acceptConnectionRequestTool = new AcceptConnectionRequestTool({
      hcsClient: hcs10Client,
      stateManager,
    });
    tools.listUnapprovedConnectionRequestsTool =
      new ListUnapprovedConnectionRequestsTool({
        stateManager,
        hcsClient: hcs10Client,
      });

    logger.info('All tools initialized');
  }

  return {
    hcs10Client,
    monitoringClient,
    tools,
    stateManager,
  };
}

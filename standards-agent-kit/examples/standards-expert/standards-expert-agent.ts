import { HCS10Client } from '../../src/hcs10/HCS10Client';
import { VectorStore } from './vector-store';
import { Logger, IConnectionsManager } from '@hashgraphonline/standards-sdk';
import {
  ConnectionTool,
  AcceptConnectionRequestTool,
  SendMessageTool,
  CheckMessagesTool,
  ConnectionMonitorTool,
} from '../../src/tools';
import { IStateManager } from '../../src/state/state-types';
import { OpenConvaiState } from '../../src/state/open-convai-state';
import { DocumentProcessor } from './document-processor';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnableMap } from '@langchain/core/runnables';
import { GithubRepoLoader } from '@langchain/community/document_loaders/web/github';
import { AgentExecutor } from 'langchain/agents';

/**
 * Type definitions for retrieval functionality
 */
type Retriever = unknown;
type RetrievalTool = Record<string, unknown>;

export interface HCSMessage {
  op?: string;
  sequence_number?: number;
  created?: Date;
  data?: string;
  operator_id?: string;
  connection_topic_id?: string;
  connection_request_id?: number;
  uniqueRequestKey?: string;
}

export interface StandardsExpertConfig {
  /** HCS10 client configuration */
  client: HCS10Client;
  /** Account ID of the agent */
  accountId: string;
  /** Inbound topic ID for the agent */
  inboundTopicId: string;
  /** Outbound topic ID for the agent */
  outboundTopicId: string;
  /** Path to the vector store database directory */
  vectorStorePath?: string;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** OpenAI API key for embeddings and inference */
  openAiApiKey?: string;
  /** The model to use for generating responses */
  openAiModel?: string;
  /** Cohere API key for reranking */
  cohereApiKey?: string;
  /** Use in-memory vector store if true, or if Chroma is unreachable */
  useInMemoryVectorStore?: boolean;
  /** GitHub repos to load content from */
  githubRepos?: string[];
  /** LangChain configuration */
  langchainConfig?: {
    /** Model temperature */
    temperature?: number;
    /** Maximum tokens to generate */
    maxTokens?: number;
    /** Enable streaming responses */
    streaming?: boolean;
  };
}

export interface AgentConnection {
  agentId: string;
  topicId: string;
  timestamp: Date;
  requesterOperatorId: string;
  connectionRequestId: number;
  uniqueRequestKey?: string;
}

/**
 * StandardsExpertAgent class that implements a specialized agent for answering
 * questions about Hedera Standards
 */
export class StandardsExpertAgent {
  private logger: Logger;
  private client: HCS10Client;
  private accountId: string;
  private inboundTopicId: string;
  private outboundTopicId: string;
  private operatorId: string;
  private vectorStore: VectorStore | null = null;
  private vectorStorePath: string;
  private isRunning = false;
  private processedMessages: Map<string, Set<number>> = new Map();
  private lastProcessedTimestamps: Map<string, number> = new Map();
  private openAiApiKey: string;
  private openAiModel: string;
  private cohereApiKey: string;
  private stateManager: IStateManager;
  private connectionsManager: IConnectionsManager;
  private llmChain: RunnableSequence | null = null;
  private retriever: Retriever | null = null;
  private retrievalTool: RetrievalTool | null = null;
  private agentExecutor: AgentExecutor | null = null;
  private githubRepos: string[];
  private useInMemoryVectorStore: boolean;
  private langchainConfig: {
    temperature: number;
    maxTokens: number;
    streaming: boolean;
  };
  private messagesInProcess: Map<string, Set<number>> = new Map();

  private connectionTool: ConnectionTool;
  private acceptConnectionTool: AcceptConnectionRequestTool;
  private sendMessageTool: SendMessageTool;
  private checkMessagesTool: CheckMessagesTool;
  private connectionMonitorTool: ConnectionMonitorTool;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(config: StandardsExpertConfig) {
    this.logger = new Logger({
      module: 'StandardsExpertAgent',
      level: config.logLevel || 'info',
      prettyPrint: true,
    });

    this.client = config.client;
    this.accountId = config.accountId;
    this.inboundTopicId = config.inboundTopicId;
    this.outboundTopicId = config.outboundTopicId;
    this.operatorId = this.client.getAccountAndSigner().accountId;
    this.processedMessages = new Map();
    this.vectorStorePath = config.vectorStorePath || './vector-store';
    this.openAiApiKey = config.openAiApiKey || process.env.OPENAI_API_KEY || '';
    this.openAiModel = config.openAiModel || 'gpt-4o-mini';
    this.cohereApiKey = config.cohereApiKey || process.env.COHERE_API_KEY || '';
    this.githubRepos = config.githubRepos || [
      'hashgraph-online/standards-sdk',
      'hashgraph-online/standards-agent-kit',
      'hashgraph-online/hcs-improvement-proposals',
    ];
    this.useInMemoryVectorStore = config.useInMemoryVectorStore || false;
    this.langchainConfig = {
      temperature: config.langchainConfig?.temperature || 0.15,
      maxTokens: config.langchainConfig?.maxTokens || 800,
      streaming: config.langchainConfig?.streaming || true,
    };

    this.stateManager = new OpenConvaiState();

    this.stateManager.setCurrentAgent({
      name: 'Standards Expert',
      accountId: this.accountId,
      inboundTopicId: this.inboundTopicId,
      outboundTopicId: this.outboundTopicId,
      profileTopicId: '',
      privateKey: (
        this.client.getAccountAndSigner().signer || ''
      ).toStringRaw(),
    });

    this.connectionsManager = this.stateManager.initializeConnectionsManager(
      this.client.standardClient
    );

    this.connectionTool = new ConnectionTool({
      client: this.client,
      stateManager: this.stateManager,
    });

    this.acceptConnectionTool = new AcceptConnectionRequestTool({
      hcsClient: this.client,
      stateManager: this.stateManager,
    });

    this.sendMessageTool = new SendMessageTool(this.client);

    this.checkMessagesTool = new CheckMessagesTool({
      hcsClient: this.client,
      stateManager: this.stateManager,
    });

    this.connectionMonitorTool = new ConnectionMonitorTool({
      hcsClient: this.client,
      stateManager: this.stateManager,
    });
  }

  /**
   * Initialize the agent, loading configuration and preparing it for operation
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Standards Expert Agent');

      if (this.openAiApiKey) {
        this.vectorStore = new VectorStore({
          path: this.vectorStorePath,
          namespace: 'standards-expert',
          openAiApiKey: this.openAiApiKey,
        });

        const vectorStore = new VectorStore({
          path: this.vectorStorePath,
          namespace: 'standards-expert',
          openAiApiKey: this.openAiApiKey,
        });

        await vectorStore.initialize();

        const githubRepos = [
          'hashgraph-online/hcs-improvement-proposals',
          'hashgraph-online/standards-sdk',
          'hashgraph-online/standards-agent-kit',
        ];

        const processor = new DocumentProcessor({
          vectorStore,
          useGitHub: true,
          githubRepos,
          githubBranch: 'main',
          cacheTtlHours: 1,
        });

        await processor.processAllDocuments();

        await this.vectorStore.initialize();
        this.logger.info('Vector store initialized');
      } else {
        this.logger.warn(
          'OpenAI API key not provided, vector store and LLM will not be available'
        );
      }

      await this.loadConnectionsFromOutboundTopic();

      await this.initializeProcessedMessages();

      try {
        await this.loadGitHubDocs();
      } catch (error) {
        this.logger.error(`Error loading GitHub docs: ${error}`);
      }

      await this.initializeLangChain();

      this.logger.info('Standards Expert Agent initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize agent: ${error}`);
      throw error;
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('Agent is already running');
      return;
    }

    try {
      this.logger.info('Starting Standards Expert Agent');
      this.isRunning = true;

      await this.startMonitoring();

      this.logger.info('Standards Expert Agent started successfully');
    } catch (error) {
      this.isRunning = false;
      this.logger.error(`Failed to start agent: ${error}`);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.info('Agent is not running');
      return;
    }

    try {
      this.logger.info('Stopping Standards Expert Agent');

      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      this.isRunning = false;
      this.logger.info('Standards Expert Agent stopped successfully');
    } catch (error) {
      this.logger.error(`Failed to stop agent: ${error}`);
      throw error;
    }
  }

  private async loadConnectionsFromOutboundTopic(): Promise<void> {
    try {
      this.logger.info('Loading existing connections from connections manager');

      await this.connectionsManager.fetchConnectionData(this.accountId);

      const existingConnections = this.connectionsManager.getAllConnections();

      if (!existingConnections.length) {
        this.logger.info('No existing connections found');
        return;
      }

      for (const connection of existingConnections) {
        if (connection.connectionTopicId && connection.targetAccountId) {
          this.stateManager.addActiveConnection({
            targetAccountId: connection.targetAccountId,
            targetAgentName:
              connection.targetAgentName ||
              `Agent ${connection.targetAccountId}`,
            targetInboundTopicId: connection.targetInboundTopicId || '',
            connectionTopicId: connection.connectionTopicId,
            profileInfo: connection.profileInfo,
            created: connection.created,
            status: 'established',
            metadata: {
              requestId:
                connection.inboundRequestId || connection.connectionRequestId,
              uniqueRequestKey: connection.uniqueRequestKey,
            },
          });

          if (connection.connectionRequestId) {
            this.connectionsManager.markConnectionRequestProcessed(
              connection.originTopicId || this.inboundTopicId,
              connection.connectionRequestId
            );
            this.logger.info(
              `Marked request #${connection.connectionRequestId} as already processed`
            );
          }

          this.logger.info(
            `Loaded existing connection with ${connection.targetAccountId} on topic ${connection.connectionTopicId}`
          );
        }
      }

      this.logger.info(
        `Loaded ${existingConnections.length} connections from connections manager`
      );
    } catch (error) {
      this.logger.warn(
        `Failed to load connections from connections manager: ${error}`
      );
    }
  }

  private async initializeProcessedMessages(): Promise<void> {
    try {
      this.logger.info(
        'Pre-populating processed messages for existing connections'
      );
      const connections = this.stateManager
        .listConnections()
        .filter((conn) => conn.status === 'established');

      this.processedMessages.set(this.inboundTopicId, new Set<number>());
      this.messagesInProcess.set(this.inboundTopicId, new Set<number>());

      for (const conn of connections) {
        const topicId = conn.connectionTopicId;
        if (!topicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)) {
          this.logger.warn(`Skipping invalid topic ID format: ${topicId}`);
          continue;
        }

        const processedSet = new Set<number>();
        this.processedMessages.set(topicId, processedSet);
        this.messagesInProcess.set(topicId, new Set<number>());

        try {
          const history = await this.client.getMessageStream(topicId);

          for (const msg of history.messages) {
            if (msg?.operator_id?.includes(this.accountId)) {
              processedSet.add(msg.sequence_number);
            }
          }

          this.logger.debug(
            `Pre-populated ${processedSet.size} messages for topic ${topicId}`
          );
        } catch (error) {
          this.logger.warn(
            `Failed to pre-populate messages for topic ${topicId}: ${error}`
          );
        }
      }

      this.logger.info('Processed message tracking initialized');
    } catch (error) {
      this.logger.error(`Error initializing processed messages: ${error}`);
    }
  }

  private async startMonitoring(): Promise<void> {
    try {
      this.monitoringInterval = setInterval(async () => {
        if (!this.isRunning) {
          return;
        }

        try {
          const monitorResult = await this.connectionMonitorTool.invoke({
            acceptAll: true,
            monitorDurationSeconds: 5,
          });

          this.logger.debug(`Connection monitoring: ${monitorResult}`);

          await this.checkForNewMessages();
        } catch (error) {
          this.logger.error(`Error in monitoring interval: ${error}`);
        }
      }, 10000);

      this.logger.info('Started monitoring for connections and messages');
    } catch (error) {
      this.logger.error(`Failed to start monitoring: ${error}`);
      throw error;
    }
  }

  public async acceptConnectionRequest(requestKey: string): Promise<boolean> {
    try {
      await this.connectionsManager.fetchConnectionData(this.accountId);

      this.logger.info(
        `Attempting to accept connection request: ${requestKey}`
      );

      const result = await this.acceptConnectionTool.invoke({
        requestKey: requestKey,
      });

      this.logger.info(`Connection request result: ${result}`);

      return !result.startsWith('Error');
    } catch (error) {
      this.logger.error(`Failed to accept connection request: ${error}`);
      return false;
    }
  }

  /**
   * Polls each established connection topic for new messages since last check and processes them once.
   */
  private async checkForNewMessages(): Promise<void> {
    const connections = this.stateManager
      .listConnections()
      .filter((conn) => conn.status === 'established');

    for (const conn of connections) {
      const topicId = conn.connectionTopicId;

      if (!topicId.match(/^[0-9]+\.[0-9]+\.[0-9]+$/)) {
        this.logger.warn(`Skipping invalid topic ID format: ${topicId}`);
        continue;
      }

      try {
        const { messages } = await this.client.getMessageStream(topicId);

        if (!this.lastProcessedTimestamps.has(topicId)) {
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          this.lastProcessedTimestamps.set(topicId, oneDayAgo);

          const ourMessages = messages.filter(
            (m) =>
              m.operator_id &&
              m.operator_id.includes(this.accountId) &&
              m.created
          );

          if (ourMessages.length > 0) {
            ourMessages.sort(
              (a, b) => b.created!.getTime() - a.created!.getTime()
            );
            if (ourMessages[0].created) {
              this.lastProcessedTimestamps.set(
                topicId,
                ourMessages[0].created.getTime()
              );
              this.logger.info(
                `Found last response timestamp: ${ourMessages[0].created.toISOString()} for topic ${topicId}`
              );
            }
          }
        }

        if (!this.processedMessages.has(topicId)) {
          this.processedMessages.set(topicId, new Set<number>());
        }
        if (!this.messagesInProcess.has(topicId)) {
          this.messagesInProcess.set(topicId, new Set<number>());
        }

        const lastTimestamp = this.lastProcessedTimestamps.get(topicId)!;
        const processedSet = this.processedMessages.get(topicId)!;
        const inProcessSet = this.messagesInProcess.get(topicId)!;

        messages.sort((a, b) => a.sequence_number! - b.sequence_number!);

        const newMessages = messages.filter(
          (m) =>
            m.op === 'message' &&
            m.created &&
            m.created.getTime() > lastTimestamp &&
            m.operator_id &&
            !m.operator_id.includes(this.accountId) &&
            m.sequence_number !== undefined &&
            !processedSet.has(m.sequence_number) &&
            !inProcessSet.has(m.sequence_number)
        );

        for (const msg of newMessages) {
          if (msg.sequence_number === undefined) {
            continue;
          }

          inProcessSet.add(msg.sequence_number);

          try {
            await this.handleStandardMessage(msg, topicId);

            processedSet.add(msg.sequence_number);

            if (msg.created) {
              this.lastProcessedTimestamps.set(topicId, msg.created.getTime());
            }
          } catch (error) {
            this.logger.error(
              `Error handling message #${msg.sequence_number}: ${error}`
            );
          } finally {
            inProcessSet.delete(msg.sequence_number);
          }
        }
      } catch (err) {
        this.logger.error(
          `Error fetching messages for topic ${topicId}: ${err}`
        );
      }
    }
  }

  /**
   * Handles a standard message received from a connection topic
   */
  private async handleStandardMessage(
    message: HCSMessage,
    connectionTopicId: string
  ): Promise<void> {
    if (!message.data || message.sequence_number === undefined) {
      return;
    }

    if (message.operator_id && message.operator_id.includes(this.accountId)) {
      return;
    }

    const processedSet = this.processedMessages.get(connectionTopicId);
    if (processedSet && processedSet.has(message.sequence_number)) {
      this.logger.debug(
        `Skipping already processed message #${message.sequence_number}`
      );
      return;
    }

    this.logger.info(
      `Processing question #${
        message.sequence_number
      }: ${message.data.substring(0, 100)}${
        message.data.length > 100 ? '...' : ''
      }`
    );

    let questionText = message.data;
    try {
      if (this.isJson(message.data)) {
        const jsonData = JSON.parse(message.data);
        questionText = this.extractAllText(jsonData);
      }
    } catch (error) {
      this.logger.debug(`Failed to parse message as JSON: ${error}`);
    }

    this.logger.info(
      `Received question #${message.sequence_number}: ${questionText}`
    );

    try {
      const response = await this.generateResponse(questionText);

      this.logger.info(`Responding with: ${response}`);

      const responseMessage = `[Reply to #${
        message.sequence_number
      }] ${response.trim()}`;

      await this.sendMessageTool.invoke({
        topicId: connectionTopicId,
        message: responseMessage,
        memo: `Reply to message #${message.sequence_number}`,
        disableMonitoring: true,
      });

      this.logger.info(
        `Response to message #${message.sequence_number} sent successfully`
      );

      if (processedSet) {
        processedSet.add(message.sequence_number);
      }
    } catch (error) {
      this.logger.error(
        `Error generating/sending response to #${message.sequence_number}: ${error}`
      );

      await this.sendMessageTool.invoke({
        topicId: connectionTopicId,
        message: `[Reply to #${message.sequence_number}] I apologize, but I encountered an error while processing your question. Please try again or rephrase your question.`,
        memo: `Error response to message #${message.sequence_number}`,
      });

      if (processedSet) {
        processedSet.add(message.sequence_number);
      }
    }
  }

  /**
   * Loads documentation from GitHub repositories and adds to vector store
   */
  private async loadGitHubDocs(): Promise<void> {
    if (!this.vectorStore) {
      this.logger.warn(
        'Vector store not available, skipping GitHub document loading'
      );
      return;
    }

    this.logger.info('Loading documentation from GitHub repositories');

    for (const repoRef of this.githubRepos) {
      try {
        this.logger.info(`Loading documents from repo: ${repoRef}`);

        const loader = new GithubRepoLoader(`https://github.com/${repoRef}`, {
          branch: 'main',
          recursive: false,
          unknown: 'warn',
          ignorePaths: [
            '.github/**',
            'tests/**',
            '**/*.png',
            '**/*.jpg',
            '**/*.jpeg',
            '**/*.gif',
            '**/*.svg',
          ],
        });

        const docs = await loader.load();
        this.logger.info(`Loaded ${docs.length} documents from ${repoRef}`);

        const filteredDocs = docs.filter((doc) => {
          const path = doc.metadata.source as string;
          return (
            path.endsWith('.ts') ||
            path.endsWith('.js') ||
            path.endsWith('.md') ||
            path.match(/HCS-\d+\.md$/i)
          );
        });

        this.logger.info(
          `Filtered to ${filteredDocs.length} relevant documents`
        );

        if (filteredDocs.length > 0) {
          const stringDocs = filteredDocs.map((doc) => doc.pageContent);
          await this.vectorStore.addDocuments(stringDocs);
          this.logger.info(
            `Added ${filteredDocs.length} documents to vector store`
          );
        }
      } catch (error) {
        this.logger.error(`Error loading docs from ${repoRef}: ${error}`);
      }
    }

    this.logger.info('Completed loading documents from GitHub to vector store');
  }

  /**
   * Initialize LangChain components for response generation
   */
  private async initializeLangChain(): Promise<void> {
    try {
      if (!this.vectorStore) {
        this.logger.warn(
          'Vector store not available, skipping LangChain initialization'
        );
        return;
      }

      this.logger.info('Initializing LangChain components');

      const llm = new ChatOpenAI({
        openAIApiKey: this.openAiApiKey,
        modelName: this.openAiModel,
        temperature: this.langchainConfig.temperature,
        maxTokens: this.langchainConfig.maxTokens,
        streaming: this.langchainConfig.streaming,
      });

      const prompt = PromptTemplate.fromTemplate(`
You are **Standards Expert**, a senior Hashgraph Online engineer who answers questions about:

• Hashgraph Online Standards SDK
• Hashgraph Online Standards Agent Kit
• HCS Standards (HCS-1 through HCS-11)
• Hashgraph Consensus Service

You have read-only access to the text in {context}.
Follow **all** rules below:

RULES
1. Rely only on the context provided. If it does not contain the answer, say
   "I am not certain based on the indexed standards" and suggest where to look.
2. Recommend the public, built-in functions from the Hashgraph Online Standards SDK or the Hashgraph Online Standards Agent Kit.
3. Show TypeScript examples **without inline comments** in triple-back-tick fences.
4. Cite every factual sentence with **(Source: {{filename}}#L{{start}}-{{end}})**.
5. Keep the prose tight (≤ 4 short paragraphs).
6. Output sections in **this exact order**:

**Answer** (omit if no answer is needed or code snippet is more accurate)
<concise explanation>

**Code**  (omit if no code is needed)
\`\`\`ts
// code here
\`\`\`

**Disclaimer**
Verify all answers as I run in alpha and might have bugs.

QUESTION
{question}

BEGIN RESPONSE:
`);

      const runnableMap = RunnableMap.from({
        context: async (input: { question: string }) => {
          try {
            if (!this.vectorStore) {
              return 'No relevant context found.';
            }

            const relevantDocs = await this.vectorStore.search(
              input.question,
              6
            );

            return relevantDocs.map((doc) => doc.document).join('\n\n');
          } catch (error) {
            this.logger.warn(`Error retrieving context: ${error}`);
            return 'No relevant context found.';
          }
        },
        question: (input: { question: string }) => input.question,
      });

      this.llmChain = RunnableSequence.from([
        runnableMap,
        prompt,
        llm,
        new StringOutputParser(),
      ]);

      this.logger.info('LangChain components initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize LangChain components: ${error}`);
      throw error;
    }
  }

  /**
   * Generate response to a question using vector search and LLM
   */
  private async generateResponse(question: string): Promise<string> {
    if (!this.vectorStore) {
      return 'Sorry, I cannot answer your question because my knowledge base is not available. Please make sure the OpenAI API key is configured correctly.';
    }

    try {
      this.logger.info(`Generating response to question: ${question}`);

      if (this.llmChain) {
        const response = await this.llmChain.invoke({ question });

        this.logger.debug(`LangChain response: ${response}`);
        return response;
      } else {
        this.logger.warn(
          'LangChain chain not available, using fallback method'
        );

        const relevantContext = await this.vectorStore.search(question, 6);

        let contextText = '';
        if (relevantContext.length > 0) {
          contextText = `Documentation Information:\n\n${relevantContext
            .map((item) => item.document)
            .join('\n\n')}`;
        }

        const response = await fetch(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.openAiApiKey}`,
            },
            body: JSON.stringify({
              model: this.openAiModel,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a Hedera Standards Expert that answers questions about Hedera Standards SDK, HCS protocols, and Hashgraph technology. ' +
                    'Prioritize accuracy and actionable advice. Always recommend using the built-in functions from the Standards SDK rather than explaining low-level implementations. ' +
                    'For implementation questions, provide clear code examples without inline comments. For standards questions, explain the concepts based on the documentation.',
                },
                {
                  role: 'user',
                  content: contextText
                    ? `I have a question about Hedera Standards: ${question}\n\n${contextText}`
                    : `I have a question about Hedera Standards: ${question}`,
                },
              ],
              temperature: this.langchainConfig.temperature,
              max_tokens: this.langchainConfig.maxTokens,
            }),
          }
        );

        const result = await response.json();

        if (result.choices && result.choices[0] && result.choices[0].message) {
          return result.choices[0].message.content.trim();
        } else {
          throw new Error('Invalid response format from OpenAI API');
        }
      }
    } catch (error) {
      this.logger.error(`Error generating response: ${error}`);
      throw error;
    }
  }

  /**
   * Extracts account ID from operatorId
   */
  private extractAccountId(operatorId: string): string | null {
    if (!operatorId) {
      return null;
    }
    const parts = operatorId.split('@');
    return parts.length === 2 ? parts[1] : null;
  }

  /**
   * Checks if a string is valid JSON
   */
  private isJson(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Extract all text from an object
   */
  private extractAllText(obj: unknown): string {
    if (typeof obj === 'string') {
      return obj;
    }
    if (!obj || typeof obj !== 'object') {
      return '';
    }

    if (Array.isArray(obj)) {
      return obj
        .map((item) => this.extractAllText(item))
        .filter(Boolean)
        .join(' ');
    }

    const objWithText = obj as { text?: string };
    if (objWithText.text && typeof objWithText.text === 'string') {
      return objWithText.text;
    }

    return Object.values(obj as Record<string, unknown>)
      .map((value) => this.extractAllText(value))
      .filter(Boolean)
      .join(' ');
  }
}

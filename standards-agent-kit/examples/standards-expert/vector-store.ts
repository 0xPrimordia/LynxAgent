import path from 'path';
import fs from 'fs';
import { ChromaClient, Collection, OpenAIEmbeddingFunction } from 'chromadb';

export interface VectorStoreConfig {
  /** Path to the vector store directory */
  path: string;
  /** Namespace for the collection */
  namespace: string;
  /** OpenAI API key for embeddings (optional if using another embedding method) */
  openAiApiKey?: string;
}

export interface SearchResult {
  id: string;
  document: string;
  metadata?: Record<string, unknown>;
  score: number;
}

/**
 * VectorStore class for storing and retrieving document embeddings
 * Uses ChromaDB for vector storage and similarity search
 */
export class VectorStore {
  private client: ChromaClient;
  private collection: Collection | null = null;
  private embeddingFunction: OpenAIEmbeddingFunction;
  private config: VectorStoreConfig;
  private initialized = false;
  private documents: Map<
    string,
    { document: string; metadata: Record<string, unknown> }
  > = new Map();

  constructor(config: VectorStoreConfig) {
    this.config = config;

    const dataPath = path.resolve(config.path);
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }

    this.client = new ChromaClient({ path: 'http://localhost:8000' });

    this.embeddingFunction = new OpenAIEmbeddingFunction({
      openai_api_key:
        this.config.openAiApiKey || process.env.OPENAI_API_KEY || '',
      openai_model: 'text-embedding-ada-002',
    });
  }

  /**
   * Initialize the vector store
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      console.log(
        `Initializing in-memory Chroma collection: ${this.config.namespace}-collection`
      );
      this.client = new ChromaClient({ path: 'http://localhost:8000' });

      this.collection = await this.client.getOrCreateCollection({
        name: `${this.config.namespace}-collection`,
        embeddingFunction: this.embeddingFunction,
        metadata: {
          description: 'Hedera Standards knowledge base',
        },
      });

      this.initialized = true;
      console.log(
        `Vector store initialized with collection: ${this.config.namespace}-collection`
      );
    } catch (error) {
      console.error('Error initializing ChromaDB:', error);
      console.log(
        'Falling back to simple in-memory document storage (no embeddings)'
      );
      this.initialized = true;
    }
  }

  /**
   * Add documents to the vector store
   * @param documents Array of documents to add
   * @param ids Optional array of IDs for the documents
   * @param metadata Optional array of metadata for the documents
   */
  public async addDocuments(
    documents: string[],
    ids?: string[],
    metadata?: Record<string, unknown>[]
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!documents.length) {
      return;
    }

    const documentIds =
      ids || documents.map((_, i) => `doc-${Date.now()}-${i}`);

    const documentMetadata = metadata || documents.map(() => ({}));
    const chromaMetadata = documentMetadata.map((m) => {
      const converted: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(m)) {
        if (value === null || value === undefined) {
          continue;
        }
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          converted[key] = value;
        } else {
          converted[key] = String(value);
        }
      }
      return converted;
    });

    try {
      if (this.collection) {
        const uniqueIds = new Set<string>();
        const duplicates = new Set<string>();

        documentIds.forEach((id) => {
          if (uniqueIds.has(id)) {
            duplicates.add(id);
          } else {
            uniqueIds.add(id);
          }
        });

        if (duplicates.size > 0) {
          console.warn(
            `Found ${duplicates.size} duplicate IDs. De-duplicating before adding to ChromaDB.`
          );

          const uniqueDocs: string[] = [];
          const uniqueDocIds: string[] = [];
          const uniqueMetadata: Record<string, string | number | boolean>[] =
            [];

          const processedIds = new Set<string>();

          for (let i = 0; i < documentIds.length; i++) {
            const id = documentIds[i];
            if (!processedIds.has(id)) {
              processedIds.add(id);
              uniqueDocs.push(documents[i]);
              uniqueDocIds.push(id);
              uniqueMetadata.push(chromaMetadata[i]);
            } else {
              console.warn(`Skipping duplicate document with ID: ${id}`);
            }
          }

          await this.collection.add({
            ids: uniqueDocIds,
            documents: uniqueDocs,
            metadatas: uniqueMetadata,
          });

          console.log(
            `Added ${uniqueDocs.length} unique documents to ChromaDB (${
              documents.length - uniqueDocs.length
            } duplicates skipped)`
          );
        } else {
          await this.collection.add({
            ids: documentIds,
            documents,
            metadatas: chromaMetadata,
          });
        }
      }
    } catch (error) {
      console.error(
        'Error adding documents to ChromaDB, using in-memory fallback:',
        error
      );
    }

    for (let i = 0; i < documents.length; i++) {
      this.documents.set(documentIds[i], {
        document: documents[i],
        metadata: documentMetadata[i],
      });
    }

    console.log(`Added ${documents.length} documents to vector store`);
  }

  /**
   * Search for similar documents to a query
   * @param query Query string
   * @param limit Maximum number of results to return (default: 5)
   * @returns Array of search results
   */
  public async search(query: string, limit = 5): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (this.collection) {
        try {
          const results = await this.collection.query({
            queryTexts: [query],
            nResults: limit,
            include: ['documents', 'metadatas', 'distances'] as any,
          });

          if (results.ids.length && results.ids[0].length) {
            const searchResults: SearchResult[] = [];

            for (let i = 0; i < results.ids[0].length; i++) {
              const id = results.ids[0][i];
              const document = results.documents?.[0]?.[i] as string;
              const metadata = results.metadatas?.[0]?.[i] as Record<
                string,
                unknown
              >;
              const distance = results.distances?.[0]?.[i] as number;

              const score = 1 - distance / 2;

              searchResults.push({
                id,
                document,
                metadata,
                score,
              });
            }
            return searchResults;
          }
        } catch (error) {
          console.error(
            'Error querying ChromaDB, falling back to keyword search:',
            error
          );
        }
      }
    } catch (error) {
      console.warn('Using fallback search method:', error);
    }

    console.log('Using simple keyword search (ChromaDB not available)');
    const results: SearchResult[] = [];
    const lowercaseQuery = query.toLowerCase();

    for (const [id, data] of Array.from(this.documents.entries())) {
      if (data.document.toLowerCase().includes(lowercaseQuery)) {
        results.push({
          id,
          document: data.document,
          metadata: data.metadata,
          score: 0.5,
        });
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Close the vector store
   */
  public async close(): Promise<void> {
    this.collection = null;
    this.initialized = false;
    this.documents.clear();
  }

  /**
   * Delete all documents from the vector store
   */
  public async deleteAll(): Promise<void> {
    if (this.collection) {
      try {
        await this.collection.delete();

        this.collection = await this.client.getOrCreateCollection({
          name: `${this.config.namespace}-collection`,
          embeddingFunction: this.embeddingFunction,
          metadata: {
            description: 'Hedera Standards knowledge base',
          },
        });
      } catch (error) {
        console.error('Error deleting documents from ChromaDB:', error);
      }
    }

    this.documents.clear();
  }
}

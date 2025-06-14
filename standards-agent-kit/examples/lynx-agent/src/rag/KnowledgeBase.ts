import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { ChatOpenAI } from "@langchain/openai";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { PromptTemplate } from "@langchain/core/prompts";
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { Logger } from '@hashgraphonline/standards-sdk';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class KnowledgeBase {
  private vectorStore: MemoryVectorStore | null = null;
  private retrievalChain: any | null = null;
  private logger: Logger;
  private openAiApiKey: string;
  private openAiModel: string;
  private knowledgeDir: string;
  private llm: ChatOpenAI;

  constructor(options: {
    openAiApiKey: string;
    openAiModel?: string;
    knowledgeDir?: string;
    logger?: Logger;
  }) {
    this.openAiApiKey = options.openAiApiKey;
    this.openAiModel = options.openAiModel || 'gpt-4';
    this.knowledgeDir = options.knowledgeDir || path.join(__dirname, '../../knowledge');
    
    this.logger = options.logger || new Logger({
      module: 'KnowledgeBase',
      level: 'info',
      prettyPrint: true,
    });
    
    this.llm = new ChatOpenAI({
      openAIApiKey: this.openAiApiKey,
      modelName: this.openAiModel,
      temperature: 0.1,
    });
  }

  /**
   * Initialize the knowledge base by loading documents and creating embeddings
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing knowledge base...');
      
      // Check if knowledge directory exists
      if (!fs.existsSync(this.knowledgeDir)) {
        throw new Error(`Knowledge directory not found: ${this.knowledgeDir}`);
      }
      
      // Load documents from knowledge directory
      const docs = await this.loadKnowledgeDocuments();
      
      if (docs.length === 0) {
        throw new Error('No knowledge documents found');
      }
      
      // Create embeddings and vector store
      const embeddings = new OpenAIEmbeddings({ openAIApiKey: this.openAiApiKey });
      this.vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
      this.logger.info(`Created vector store with ${docs.length} knowledge documents`);
      
      // Create retrieval chain using new pattern
      if (!this.vectorStore) {
        throw new Error('Vector store initialization failed');
      }

      const retriever = this.vectorStore.asRetriever({ k: 3 });

      const prompt = PromptTemplate.fromTemplate(`
        Answer the question based on the following context:
        
        Context: {context}
        
        Question: {question}
        
        Answer: Let me help you with that. `);

      const combineDocsChain = await createStuffDocumentsChain({
        llm: this.llm,
        prompt,
      });

      this.retrievalChain = await createRetrievalChain({
        combineDocsChain,
        retriever,
      });
      
      this.logger.info('Knowledge base initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize knowledge base: ${error}`);
      throw error;
    }
  }
  
  /**
   * Query the knowledge base for relevant information
   */
  public async query(question: string): Promise<string> {
    if (!this.vectorStore) {
      throw new Error('Knowledge base not initialized');
    }
    
    try {
      // Use a simple retrieval approach that's less dependent on LangChain version
      // 1. Retrieve documents directly from the vector store
      const k = 3; // Number of documents to retrieve
      const docs = await this.vectorStore.similaritySearch(question, k);
      
      if (!docs || docs.length === 0) {
        this.logger.warn('No relevant documents found for query');
        return "No relevant information found in the knowledge base.";
      }
      
      // 2. Format the retrieved documents into a context string
      const context = docs.map((doc, i) => 
        `DOCUMENT ${i + 1}:\n${doc.pageContent}\n`
      ).join('\n');
      
      // 3. Create a simple prompt
      const prompt = `
Answer the following question based only on the provided context:

CONTEXT:
${context}

QUESTION:
${question}

ANSWER:`;
      
      // 4. Call the LLM directly
      const result = await this.llm.invoke(prompt);
      
      // 5. Get the text content from the result
      let answer = result.toString();
      
      if (!answer) {
        return "No relevant information found.";
      }
      
      return answer;
    } catch (error) {
      this.logger.error(`Error querying knowledge base: ${error}`);
      // Return a fallback response
      return `I found some information but couldn't process it correctly. Please try a different query.`;
    }
  }
  
  /**
   * Get the LLM instance
   */
  public getLLM(): ChatOpenAI {
    return this.llm;
  }
  
  /**
   * Load knowledge documents from the knowledge directory
   */
  private async loadKnowledgeDocuments(): Promise<Document[]> {
    const docs: Document[] = [];
    
    try {
      const files = fs.readdirSync(this.knowledgeDir);
      
      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = path.join(this.knowledgeDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          
          // Extract category from filename
          const category = file.replace('.md', '');
          
          const doc = new Document({
            pageContent: content,
            metadata: {
              source: file,
              category: category
            }
          });
          
          docs.push(doc);
          this.logger.info(`Loaded knowledge document: ${file}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error loading knowledge documents: ${error}`);
    }
    
    return docs;
  }
} 
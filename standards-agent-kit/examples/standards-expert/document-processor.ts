import fs from 'fs';
import path from 'path';
import { VectorStore } from './vector-store';
import axios from 'axios';

interface GitHubCacheEntry {
  data: unknown;
  timestamp: number;
}

export interface DocumentProcessorConfig {
  /** Vector store instance */
  vectorStore: VectorStore;
  /** Path to the documentation directory (optional if using GitHub) */
  docsPath?: string;
  /** File extensions to process (default: .md, .mdx) */
  extensions?: string[];
  /** Chunk size in characters (default: 1000) */
  chunkSize?: number;
  /** Chunk overlap in characters (default: 200) */
  chunkOverlap?: number;
  /** Whether to fetch documentation from GitHub (default: false) */
  useGitHub?: boolean;
  /** GitHub repositories to process */
  githubRepos?: string[];
  /** GitHub branch to use (default: main) */
  githubBranch?: string;
  /** Number of hours to cache GitHub content (default: 24, 0 to disable) */
  cacheTtlHours?: number;
}

export interface ProcessedDocument {
  id: string;
  content: string;
  metadata: {
    source: string;
    title?: string;
    standard?: string;
    section?: string;
    chunkIndex?: number;
    totalChunks?: number;
    fileName?: string;
    repository?: string;
    contentType?: string;
  };
}

interface GitHubItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
  url: string;
}

/**
 * DocumentProcessor class for processing and chunking documentation files
 * for storage in a vector database
 */
export class DocumentProcessor {
  private vectorStore: VectorStore;
  private docsPath: string;
  private extensions: string[];
  private chunkSize: number;
  private chunkOverlap: number;
  private useGitHub: boolean;
  private githubRepos: string[];
  private githubBranch: string;
  private cacheTtlHours: number;
  private cacheDir: string;
  private githubCache: Map<string, GitHubCacheEntry> = new Map();

  constructor(config: DocumentProcessorConfig) {
    this.vectorStore = config.vectorStore;
    this.docsPath = config.docsPath || './docs';
    this.extensions = config.extensions || ['.md', '.mdx'];
    this.chunkSize = config.chunkSize || 1000;
    this.chunkOverlap = config.chunkOverlap || 200;
    this.useGitHub = config.useGitHub || false;
    this.githubRepos = config.githubRepos || [
      'hashgraph-online/hcs-improvement-proposals',
      'hashgraph-online/standards-sdk',
      'hashgraph-online/standards-agent-kit',
    ];
    this.githubBranch = config.githubBranch || 'main';
    this.cacheTtlHours = config.cacheTtlHours ?? 24;
    this.cacheDir = path.join(this.docsPath, '.cache');

    if (this.useGitHub && this.cacheTtlHours > 0) {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      this.loadCacheFromDisk();
    }
  }

  /**
   * Process all documentation files in the specified directory or from GitHub
   */
  public async processAllDocuments(): Promise<void> {
    const processedDocs: ProcessedDocument[] = [];

    if (this.useGitHub) {
      for (const repo of this.githubRepos) {
        console.log(`Processing GitHub repository: ${repo}`);
        try {
          const docs = await this.processGitHubRepo(repo);
          processedDocs.push(...docs);
        } catch (error) {
          console.error(`Error processing repository ${repo}:`, error);
        }
      }
    } else {
      const filePaths = this.getDocumentFiles(this.docsPath);
      for (const filePath of filePaths) {
        const docs = await this.processFile(filePath);
        processedDocs.push(...docs);
      }
    }

    if (processedDocs.length) {
      const documents = processedDocs.map((doc) => doc.content);
      const ids = processedDocs.map((doc) => doc.id);
      const metadata = processedDocs.map((doc) => doc.metadata);

      await this.vectorStore.addDocuments(documents, ids, metadata);
      console.log(
        `Added ${processedDocs.length} document chunks to vector store.`
      );
    }
  }

  /**
   * Load cache from disk
   */
  private loadCacheFromDisk(): void {
    try {
      const cacheFile = path.join(this.cacheDir, 'github-cache.json');
      if (fs.existsSync(cacheFile)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        Object.entries(cacheData).forEach(([key, value]) => {
          this.githubCache.set(key, value as GitHubCacheEntry);
        });
        console.log(
          `Loaded ${this.githubCache.size} entries from GitHub cache.`
        );
      }
    } catch (error) {
      console.warn('Failed to load GitHub cache from disk:', error);
    }
  }

  /**
   * Save cache to disk
   */
  private saveCacheToDisk(): void {
    try {
      const cacheData: Record<string, GitHubCacheEntry> = {};
      this.githubCache.forEach((value, key) => {
        cacheData[key] = value;
      });

      const cacheFile = path.join(this.cacheDir, 'github-cache.json');
      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      console.warn('Failed to save GitHub cache to disk:', error);
    }
  }

  /**
   * Process documentation from a specific GitHub repository
   */
  private async processGitHubRepo(repo: string): Promise<ProcessedDocument[]> {
    console.log(`Fetching documentation from GitHub repository: ${repo}`);
    const processedDocs: ProcessedDocument[] = [];

    try {
      const docsUrl = `https://api.github.com/repos/${repo}/contents/docs?ref=${this.githubBranch}`;
      let items: GitHubItem[] = [];

      try {
        const response = await this.fetchWithCache(docsUrl);
        if (Array.isArray(response)) {
          items = response as GitHubItem[];
        }
      } catch (error) {
        console.log(
          `No docs directory found in ${repo}, checking root directory`
        );

        const rootUrl = `https://api.github.com/repos/${repo}/contents?ref=${this.githubBranch}`;
        const rootResponse = await this.fetchWithCache(rootUrl);

        if (Array.isArray(rootResponse)) {
          items = rootResponse as GitHubItem[];
        }
      }

      for (const item of items) {
        if (item.type === 'file') {
          const ext = path.extname(item.name);
          if (
            (this.extensions.includes(ext) ||
              item.name.toLowerCase() === 'readme.md') &&
            item.download_url
          ) {
            const fileContent = await this.fetchGitHubFile(item.download_url);
            if (fileContent) {
              const docs = this.processGitHubFile(
                fileContent,
                item.name,
                item.path,
                repo
              );
              processedDocs.push(...docs);
            }
          }
        } else if (
          item.type === 'dir' &&
          !item.path.includes('node_modules') &&
          !item.path.includes('dist')
        ) {
          await this.processGitHubDirectory(item.url, repo, processedDocs);
        }
      }

      console.log(
        `Processed ${processedDocs.length} document chunks from ${repo}.`
      );

      if (this.cacheTtlHours > 0) {
        this.saveCacheToDisk();
      }

      return processedDocs;
    } catch (error) {
      console.error(
        `Error fetching documents from GitHub repository ${repo}:`,
        error
      );
      return [];
    }
  }

  /**
   * Process a GitHub directory recursively
   */
  private async processGitHubDirectory(
    url: string,
    repo: string,
    processedDocs: ProcessedDocument[]
  ): Promise<void> {
    try {
      const items = (await this.fetchWithCache(url)) as GitHubItem[];

      for (const item of items) {
        if (item.type === 'file') {
          const ext = path.extname(item.name);
          if (
            (this.extensions.includes(ext) ||
              item.name.toLowerCase() === 'readme.md') &&
            item.download_url
          ) {
            const fileContent = await this.fetchGitHubFile(item.download_url);
            if (fileContent) {
              const docs = this.processGitHubFile(
                fileContent,
                item.name,
                item.path,
                repo
              );
              processedDocs.push(...docs);
            }
          }
        } else if (
          item.type === 'dir' &&
          !item.path.includes('node_modules') &&
          !item.path.includes('dist')
        ) {
          await this.processGitHubDirectory(item.url, repo, processedDocs);
        }
      }
    } catch (error) {
      console.error(`Error processing GitHub directory ${url}:`, error);
    }
  }

  /**
   * Fetch with cache
   */
  private async fetchWithCache(url: string): Promise<unknown> {
    if (this.cacheTtlHours <= 0) {
      return axios.get(url).then((response) => response.data);
    }

    const cached = this.githubCache.get(url);
    const now = Date.now();
    const cacheTtlMs = this.cacheTtlHours * 60 * 60 * 1000;

    if (cached && now - cached.timestamp < cacheTtlMs) {
      return cached.data;
    }

    try {
      const response = await axios.get(url);
      this.githubCache.set(url, {
        data: response.data,
        timestamp: now,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        console.warn(
          'GitHub API rate limit hit, waiting 5 seconds before retry...'
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const response = await axios.get(url);
        this.githubCache.set(url, {
          data: response.data,
          timestamp: now,
        });
        return response.data;
      }
      throw error;
    }
  }

  /**
   * Fetch a GitHub file contents
   */
  private async fetchGitHubFile(url: string): Promise<string | null> {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Error fetching file ${url}:`, error);
      return null;
    }
  }

  /**
   * Process a GitHub file into document chunks
   */
  private processGitHubFile(
    content: string,
    fileName: string,
    filePath: string,
    repo = ''
  ): ProcessedDocument[] {
    console.log(`Processing GitHub file: ${filePath}`);
    const metadata = this.extractMetadata(content, fileName, filePath);
    const chunks = this.splitIntoChunks(content);

    metadata.repository = repo;

    if (repo.includes('standards-sdk')) {
      metadata.contentType = 'SDK';
    } else if (repo.includes('standards-agent-kit')) {
      metadata.contentType = 'Agent Kit';
    } else if (repo.includes('hcs-improvement-proposals')) {
      metadata.contentType = 'HCS Standard';
    }

    const repoPrefix = repo ? repo.replace(/hashgraph-online\//, '') : 'local';

    return chunks.map((chunk, index) => ({
      id: `${repoPrefix}-${filePath}-${index}`,
      content: chunk,
      metadata: {
        ...metadata,
        chunkIndex: index,
        totalChunks: chunks.length,
      },
    }));
  }

  /**
   * Get all document files recursively from a directory
   */
  private getDocumentFiles(dirPath: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dirPath)) {
      console.warn(`Directory not found: ${dirPath}`);
      return fileList;
    }

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        this.getDocumentFiles(filePath, fileList);
      } else {
        const ext = path.extname(file);
        if (this.extensions.includes(ext)) {
          fileList.push(filePath);
        }
      }
    }

    return fileList;
  }

  /**
   * Process a local file into document chunks
   */
  private async processFile(filePath: string): Promise<ProcessedDocument[]> {
    console.log(`Processing file: ${filePath}`);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(this.docsPath, filePath);
      const fileName = path.basename(filePath);

      const metadata = this.extractMetadata(content, fileName, relativePath);
      const chunks = this.splitIntoChunks(content);

      return chunks.map((chunk, index) => ({
        id: `local-${relativePath.replace(/\\/g, '-')}-${index}`,
        content: chunk,
        metadata: {
          ...metadata,
          chunkIndex: index,
          totalChunks: chunks.length,
        },
      }));
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Extract metadata from document content
   */
  private extractMetadata(
    content: string,
    fileName: string,
    relativePath: string
  ): {
    source: string;
    fileName: string;
    title?: string;
    standard?: string;
    repository?: string;
    contentType?: string;
  } {
    interface DocMetadata {
      source: string;
      fileName: string;
      title?: string;
      standard?: string;
      repository?: string;
      contentType?: string;
    }

    const metadata: DocMetadata = {
      source: relativePath,
      fileName,
    };

    const titleMatch = content.match(/^#\s+(.+?)$/m);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim();
    }

    const hcsMatch = fileName.match(/^HCS-(\d+)/);
    if (hcsMatch) {
      metadata.standard = `HCS-${hcsMatch[1]}`;
    }

    return metadata;
  }

  /**
   * Split content into overlapping chunks
   */
  private splitIntoChunks(content: string): string[] {
    const chunks: string[] = [];

    if (content.length <= this.chunkSize) {
      chunks.push(content);
      return chunks;
    }

    let startIndex = 0;

    while (startIndex < content.length) {
      const endIndex = startIndex + this.chunkSize;

      if (endIndex >= content.length) {
        chunks.push(content.slice(startIndex));
        break;
      }

      let chunkEndIndex = endIndex;

      const lastParagraphBreak = content.lastIndexOf('\n\n', endIndex);
      if (
        lastParagraphBreak > startIndex &&
        lastParagraphBreak > endIndex - this.chunkSize / 2
      ) {
        chunkEndIndex = lastParagraphBreak + 2;
      } else {
        const lastSentenceBreak = content.lastIndexOf('. ', endIndex);
        if (
          lastSentenceBreak > startIndex &&
          lastSentenceBreak > endIndex - this.chunkSize / 4
        ) {
          chunkEndIndex = lastSentenceBreak + 2;
        }
      }

      chunks.push(content.slice(startIndex, chunkEndIndex));
      startIndex = chunkEndIndex - this.chunkOverlap;
    }

    return chunks;
  }
}

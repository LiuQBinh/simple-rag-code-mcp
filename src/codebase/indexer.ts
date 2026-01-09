import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { pipeline, env } from '@xenova/transformers';
import { configManager } from '../config.js';
import { codebaseManager } from './manager.js';

env.allowLocalModels = true;

export interface CodeChunk {
  content: string;
  filePath: string;
  codebase: string;
  startLine: number;
  endLine: number;
  metadata?: Record<string, any>;
}

export interface IndexedChunk extends CodeChunk {
  embedding: number[];
}

// Common code file extensions
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue',
  '.dart', '.r', '.m', '.mm', '.sh', '.bash', '.zsh', '.yaml', '.yml',
  '.json', '.xml', '.html', '.css', '.scss', '.sass', '.less', '.sql',
  '.md', '.markdown', '.txt',
]);

// Files/directories to ignore
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.cache',
  'coverage',
  '.env',
  '.DS_Store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

function shouldIgnore(path: string): boolean {
  const parts = path.split('/');
  return IGNORE_PATTERNS.some((pattern) => parts.includes(pattern));
}

function isCodeFile(filePath: string): boolean {
  const ext = extname(filePath);
  return CODE_EXTENSIONS.has(ext);
}

function chunkText(text: string, chunkSize: number, overlap: number): Array<{ text: string; start: number; end: number }> {
  const lines = text.split('\n');
  const chunks: Array<{ text: string; start: number; end: number }> = [];

  let start = 0;
  while (start < lines.length) {
    const end = Math.min(start + chunkSize, lines.length);
    const chunkLines = lines.slice(start, end);
    chunks.push({
      text: chunkLines.join('\n'),
      start: start + 1, // 1-indexed line numbers
      end: end,
    });
    start = end - overlap;
  }

  return chunks;
}

export class CodeIndexer {
  private embeddingPipeline: any = null;
  private indexedChunks: Map<string, IndexedChunk[]> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const modelName = configManager.getEmbeddingModel();
      this.embeddingPipeline = await pipeline('feature-extraction', modelName, {
        quantized: true,
      });
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize embedding pipeline:', error);
      throw error;
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingPipeline) {
      await this.initialize();
    }

    const result = await this.embeddingPipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(result.data);
  }

  private async indexFile(
    codebase: string,
    filePath: string,
    content: string
  ): Promise<IndexedChunk[]> {
    const chunkSize = configManager.getChunkSize();
    const chunkOverlap = configManager.getChunkOverlap();

    const textChunks = chunkText(content, chunkSize, chunkOverlap);
    const indexedChunks: IndexedChunk[] = [];

    for (const chunk of textChunks) {
      try {
        const embedding = await this.generateEmbedding(chunk.text);
        indexedChunks.push({
          content: chunk.text,
          filePath,
          codebase,
          startLine: chunk.start,
          endLine: chunk.end,
          embedding,
        });
      } catch (error) {
        console.warn(`Failed to generate embedding for chunk in ${filePath}:`, error);
      }
    }

    return indexedChunks;
  }

  private async walkDirectory(dirPath: string, codebase: string): Promise<string[]> {
    const files: string[] = [];

    if (!existsSync(dirPath)) {
      return files;
    }

    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (shouldIgnore(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await this.walkDirectory(fullPath, codebase);
        files.push(...subFiles);
      } else if (entry.isFile() && isCodeFile(fullPath)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  async indexCodebase(codebaseName: string): Promise<void> {
    await this.initialize();

    const codebasePath = codebaseManager.getCodebasePath(codebaseName);
    if (!codebasePath) {
      throw new Error(`Codebase "${codebaseName}" not found`);
    }

    const files = await this.walkDirectory(codebasePath, codebaseName);
    const allChunks: IndexedChunk[] = [];

    console.log(`Indexing ${files.length} files in codebase "${codebaseName}"...`);

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const chunks = await this.indexFile(codebaseName, filePath, content);
        allChunks.push(...chunks);
      } catch (error) {
        console.warn(`Failed to index file ${filePath}:`, error);
      }
    }

    this.indexedChunks.set(codebaseName, allChunks);
    console.log(`Indexed ${allChunks.length} chunks from codebase "${codebaseName}"`);
  }

  async search(
    query: string,
    codebaseNames?: string[],
    limit: number = 10
  ): Promise<Array<IndexedChunk & { score: number }>> {
    await this.initialize();

    const queryEmbedding = await this.generateEmbedding(query);
    const results: Array<IndexedChunk & { score: number }> = [];

    const codebasesToSearch = codebaseNames
      ? codebaseNames.filter((name) => this.indexedChunks.has(name))
      : Array.from(this.indexedChunks.keys());

    for (const codebaseName of codebasesToSearch) {
      const chunks = this.indexedChunks.get(codebaseName) || [];

      for (const chunk of chunks) {
        const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
        results.push({ ...chunk, score });
      }
    }

    // Sort by score descending and return top results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  getIndexedCodebases(): string[] {
    return Array.from(this.indexedChunks.keys());
  }

  clearIndex(codebaseName?: string): void {
    if (codebaseName) {
      this.indexedChunks.delete(codebaseName);
    } else {
      this.indexedChunks.clear();
    }
  }
}

export const codeIndexer = new CodeIndexer();

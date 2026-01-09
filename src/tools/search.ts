import { codeIndexer } from '../codebase/indexer.js';
import { codebaseManager } from '../codebase/manager.js';

export interface SearchResult {
  content: string;
  filePath: string;
  codebase: string;
  startLine: number;
  endLine: number;
  score: number;
}

export async function semanticSearch(
  query: string,
  codebaseNames?: string[],
  limit: number = 10
): Promise<SearchResult[]> {
  // Validate codebases exist
  if (codebaseNames) {
    for (const name of codebaseNames) {
      if (!codebaseManager.getCodebasePath(name)) {
        throw new Error(`Codebase "${name}" not found`);
      }
    }
  }

  const results = await codeIndexer.search(query, codebaseNames, limit);

  return results.map((result) => ({
    content: result.content,
    filePath: result.filePath,
    codebase: result.codebase,
    startLine: result.startLine,
    endLine: result.endLine,
    score: result.score,
  }));
}

export async function indexCodebase(
  codebaseName: string,
  options?: {
    maxFiles?: number;
    batchSize?: number;
    skipLargeFiles?: boolean;
  }
): Promise<{
  indexed: number;
  totalFiles: number;
  skipped: number;
  chunks: number;
}> {
  if (!codebaseManager.getCodebasePath(codebaseName)) {
    throw new Error(`Codebase "${codebaseName}" not found`);
  }

  return await codeIndexer.indexCodebase(codebaseName, options || {});
}

export function getIndexedCodebases(): string[] {
  return codeIndexer.getIndexedCodebases();
}

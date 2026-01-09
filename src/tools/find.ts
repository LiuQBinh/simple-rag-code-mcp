import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import { codebaseManager } from '../codebase/manager.js';

export interface FindFileResult {
  filePath: string;
  relativePath: string;
  codebase: string;
  fileName: string;
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

function matchesPattern(filePath: string, fileName: string, pattern: string): boolean {
  // Convert pattern to regex-like matching
  // Support both simple substring and basic wildcard patterns
  const normalizedPattern = pattern.toLowerCase();
  const normalizedPath = filePath.toLowerCase();
  const normalizedFileName = fileName.toLowerCase();

  // Simple substring match
  if (normalizedPattern.includes('*')) {
    // Convert wildcard pattern to regex
    const regexPattern = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(fileName) || regex.test(normalizedPath);
  }

  // Check if pattern matches file name or path
  return normalizedFileName.includes(normalizedPattern) || 
         normalizedPath.includes(normalizedPattern);
}

async function walkDirectory(
  dirPath: string,
  codebasePath: string,
  codebaseName: string,
  pattern: string,
  maxResults: number
): Promise<FindFileResult[]> {
  const results: FindFileResult[] = [];

  if (!existsSync(dirPath)) {
    return results;
  }

  if (results.length >= maxResults) {
    return results;
  }

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) {
        break;
      }

      const fullPath = join(dirPath, entry.name);

      if (shouldIgnore(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        const subResults = await walkDirectory(
          fullPath,
          codebasePath,
          codebaseName,
          pattern,
          maxResults - results.length
        );
        results.push(...subResults);
      } else if (entry.isFile() && isCodeFile(fullPath)) {
        const fileName = basename(fullPath);
        const relativePath = relative(codebasePath, fullPath);

        if (matchesPattern(relativePath, fileName, pattern)) {
          results.push({
            filePath: fullPath,
            relativePath,
            codebase: codebaseName,
            fileName,
          });
        }
      }
    }
  } catch (error) {
    // Silently skip directories we can't read
    console.warn(`Failed to read directory ${dirPath}:`, error);
  }

  return results;
}

export async function findFile(
  pattern: string,
  codebaseNames?: string[],
  options: {
    maxResults?: number;
  } = {}
): Promise<FindFileResult[]> {
  const { maxResults = 50 } = options;

  const results: FindFileResult[] = [];
  const codebasesToSearch = codebaseNames
    ? codebaseNames.map((name) => {
        const path = codebaseManager.getCodebasePath(name);
        if (!path) {
          throw new Error(`Codebase "${name}" not found`);
        }
        return { name, path };
      })
    : codebaseManager.getAllCodebases();

  for (const { name: codebaseName, path: codebasePath } of codebasesToSearch) {
    if (results.length >= maxResults) {
      break;
    }

    const files = await walkDirectory(
      codebasePath,
      codebasePath,
      codebaseName,
      pattern,
      maxResults - results.length
    );
    results.push(...files);
  }

  // Sort by relevance: exact matches first, then by path length
  results.sort((a, b) => {
    const aFileName = a.fileName.toLowerCase();
    const bFileName = b.fileName.toLowerCase();
    const patternLower = pattern.toLowerCase();

    // Exact filename match gets highest priority
    if (aFileName === patternLower && bFileName !== patternLower) return -1;
    if (bFileName === patternLower && aFileName !== patternLower) return 1;

    // Then by whether filename starts with pattern
    const aStarts = aFileName.startsWith(patternLower);
    const bStarts = bFileName.startsWith(patternLower);
    if (aStarts && !bStarts) return -1;
    if (bStarts && !aStarts) return 1;

    // Then by path length (shorter paths first)
    return a.relativePath.length - b.relativePath.length;
  });

  return results.slice(0, maxResults);
}

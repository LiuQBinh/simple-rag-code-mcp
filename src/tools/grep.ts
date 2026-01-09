import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { codebaseManager } from '../codebase/manager.js';

export interface GrepResult {
  filePath: string;
  codebase: string;
  lineNumber: number;
  line: string;
  contextBefore?: string[];
  contextAfter?: string[];
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

async function walkDirectory(dirPath: string): Promise<string[]> {
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
      const subFiles = await walkDirectory(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile() && isCodeFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function grep(
  pattern: string,
  codebaseNames?: string[],
  options: {
    caseSensitive?: boolean;
    contextLines?: number;
    maxResults?: number;
  } = {}
): Promise<GrepResult[]> {
  const {
    caseSensitive = false,
    contextLines = 2,
    maxResults = 100,
  } = options;

  // Compile regex pattern
  let regex: RegExp;
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    regex = new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }

  const results: GrepResult[] = [];
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

    const files = await walkDirectory(codebasePath);

    for (const filePath of files) {
      if (results.length >= maxResults) {
        break;
      }

      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) {
            break;
          }

          const line = lines[i];
          if (regex.test(line)) {
            // Reset regex lastIndex for next iteration
            regex.lastIndex = 0;

            const contextBefore = i > 0
              ? lines.slice(Math.max(0, i - contextLines), i)
              : [];
            const contextAfter = i < lines.length - 1
              ? lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines))
              : [];

            results.push({
              filePath,
              codebase: codebaseName,
              lineNumber: i + 1, // 1-indexed
              line,
              contextBefore: contextBefore.length > 0 ? contextBefore : undefined,
              contextAfter: contextAfter.length > 0 ? contextAfter : undefined,
            });
          }
        }
      } catch (error) {
        console.warn(`Failed to search in file ${filePath}:`, error);
      }
    }
  }

  return results;
}

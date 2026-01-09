import { readFileSync, existsSync, statSync } from 'fs';
import { codebaseManager } from '../codebase/manager.js';

export interface FileContent {
  content: string;
  filePath: string;
  codebase: string;
  relativePath: string;
  totalLines: number;
  startLine?: number;
  endLine?: number;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function readFile(
  codebaseName: string,
  filePath: string,
  options: {
    startLine?: number;
    endLine?: number;
  } = {}
): FileContent {
  const { startLine, endLine } = options;

  const codebasePath = codebaseManager.getCodebasePath(codebaseName);
  if (!codebasePath) {
    throw new Error(`Codebase "${codebaseName}" not found`);
  }

  const resolvedPath = codebaseManager.resolveFilePath(codebaseName, filePath);
  if (!resolvedPath) {
    const attemptedPath = codebasePath ? `${codebasePath}/${filePath}` : filePath;
    throw new Error(`File not found: ${filePath} in codebase "${codebaseName}" (attempted path: ${attemptedPath})`);
  }

  // Check file size
  const stats = statSync(resolvedPath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE} bytes). Use line range to read specific sections.`
    );
  }

  // Read file content
  let content: string;
  try {
    content = readFileSync(resolvedPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read file: ${error}`);
  }

  const lines = content.split('\n');
  const totalLines = lines.length;

  // Apply line range if specified
  let finalContent = content;
  let finalStartLine: number | undefined;
  let finalEndLine: number | undefined;

  if (startLine !== undefined || endLine !== undefined) {
    const start = startLine !== undefined ? Math.max(1, Math.min(startLine, totalLines)) : 1;
    const end = endLine !== undefined ? Math.max(start, Math.min(endLine, totalLines)) : totalLines;

    finalContent = lines.slice(start - 1, end).join('\n');
    finalStartLine = start;
    finalEndLine = end;
  }

  // Get relative path
  const codebaseInfo = codebaseManager.getCodebaseForPath(resolvedPath);
  const relativePath = codebaseInfo?.relativePath || filePath;

  return {
    content: finalContent,
    filePath: resolvedPath,
    codebase: codebaseName,
    relativePath,
    totalLines,
    startLine: finalStartLine,
    endLine: finalEndLine,
  };
}

export function fileExists(codebaseName: string, filePath: string): boolean {
  const resolvedPath = codebaseManager.resolveFilePath(codebaseName, filePath);
  return resolvedPath !== null && existsSync(resolvedPath);
}

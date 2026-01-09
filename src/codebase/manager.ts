import { existsSync, statSync } from 'fs';
import { join, relative, resolve, normalize } from 'path';
import { configManager, type CodebaseConfig } from '../config.js';

export interface CodeFile {
  path: string;
  relativePath: string;
  codebase: string;
  content: string;
  size: number;
}

export class CodebaseManager {
  private codebases: Map<string, string> = new Map();

  constructor() {
    this.loadCodebases();
  }

  private loadCodebases(): void {
    const configs = configManager.getCodebases();
    for (const config of configs) {
      if (existsSync(config.path)) {
        this.codebases.set(config.name, config.path);
      } else {
        console.warn(`Codebase path does not exist: ${config.path} (${config.name})`);
      }
    }
  }

  getCodebasePath(name: string): string | undefined {
    return this.codebases.get(name);
  }

  getAllCodebases(): Array<{ name: string; path: string }> {
    return Array.from(this.codebases.entries()).map(([name, path]) => ({ name, path }));
  }

  addCodebase(name: string, path: string): void {
    if (!existsSync(path)) {
      throw new Error(`Path does not exist: ${path}`);
    }

    const stats = statSync(path);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${path}`);
    }

    configManager.addCodebase(name, path);
    this.codebases.set(name, path);
  }

  removeCodebase(name: string): void {
    if (!this.codebases.has(name)) {
      throw new Error(`Codebase "${name}" not found`);
    }

    configManager.removeCodebase(name);
    this.codebases.delete(name);
  }

  resolveFilePath(codebaseName: string, filePath: string): string | null {
    const codebasePath = this.codebases.get(codebaseName);
    if (!codebasePath) {
      return null;
    }

    // Normalize the file path to handle . and .. segments
    const normalizedFilePath = normalize(filePath);
    
    // Join with codebase path
    const fullPath = join(codebasePath, normalizedFilePath);
    
    // Resolve to absolute path to handle any remaining .. segments
    const resolvedPath = resolve(fullPath);
    const resolvedCodebasePath = resolve(codebasePath);
    
    // Security: Ensure the resolved path is within the codebase directory
    // Check that resolved path starts with resolved codebase path
    if (!resolvedPath.startsWith(resolvedCodebasePath + '/') && resolvedPath !== resolvedCodebasePath) {
      return null;
    }

    if (!existsSync(resolvedPath)) {
      return null;
    }

    return resolvedPath;
  }

  getCodebaseForPath(filePath: string): { name: string; relativePath: string } | null {
    for (const [name, codebasePath] of this.codebases.entries()) {
      if (filePath.startsWith(codebasePath)) {
        const relativePath = relative(codebasePath, filePath);
        return { name, relativePath };
      }
    }
    return null;
  }

  reload(): void {
    this.codebases.clear();
    this.loadCodebases();
  }
}

export const codebaseManager = new CodebaseManager();

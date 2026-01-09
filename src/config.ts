import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface CodebaseConfig {
  name: string;
  path: string;
}

export interface ServerConfig {
  codebases: CodebaseConfig[];
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

const DEFAULT_CONFIG: ServerConfig = {
  codebases: [],
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  chunkSize: 1000,
  chunkOverlap: 200,
};

// Get project root directory (parent of dist folder)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = process.env.MCP_CONFIG_FILE 
  ? dirname(process.env.MCP_CONFIG_FILE)
  : join(__dirname, '..'); // Go up from dist/config.js to project root

// Try multiple locations for config file
function findConfigFile(): string {
  if (process.env.MCP_CONFIG_FILE) {
    return process.env.MCP_CONFIG_FILE;
  }
  
  // Try project root (where dist/config.js is located)
  const projectRootConfig = join(PROJECT_ROOT, '.mcp-config.json');
  if (existsSync(projectRootConfig)) {
    return projectRootConfig;
  }
  
  // Fallback: try current working directory
  const cwdConfig = join(process.cwd(), '.mcp-config.json');
  if (existsSync(cwdConfig)) {
    return cwdConfig;
  }
  
  // Default to project root
  return projectRootConfig;
}

const CONFIG_FILE = findConfigFile();

export class ConfigManager {
  private config: ServerConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): ServerConfig {
    // Try to load from environment variables first
    const envCodebases = process.env.MCP_CODEBASES;
    if (envCodebases) {
      try {
        const codebases = JSON.parse(envCodebases) as CodebaseConfig[];
        console.log(`[ConfigManager] Loaded ${codebases.length} codebases from environment variables`);
        return {
          ...DEFAULT_CONFIG,
          codebases,
        };
      } catch (error) {
        console.warn('Failed to parse MCP_CODEBASES from environment:', error);
      }
    }

    // Try to load from config file
    console.log(`[ConfigManager] Looking for config file at: ${CONFIG_FILE}`);
    if (existsSync(CONFIG_FILE)) {
      try {
        const fileContent = readFileSync(CONFIG_FILE, 'utf-8');
        const fileConfig = JSON.parse(fileContent) as Partial<ServerConfig>;
        const codebaseCount = fileConfig.codebases?.length || 0;
        console.log(`[ConfigManager] Loaded ${codebaseCount} codebases from config file`);
        return {
          ...DEFAULT_CONFIG,
          ...fileConfig,
        };
      } catch (error) {
        console.warn('Failed to load config file:', error);
      }
    } else {
      console.warn(`[ConfigManager] Config file not found at: ${CONFIG_FILE}`);
    }

    console.log(`[ConfigManager] Using default config with 0 codebases`);
    return { ...DEFAULT_CONFIG };
  }

  getConfig(): ServerConfig {
    return { ...this.config };
  }

  getCodebases(): CodebaseConfig[] {
    return [...this.config.codebases];
  }

  addCodebase(name: string, path: string): void {
    // Validate path exists
    if (!existsSync(path)) {
      throw new Error(`Codebase path does not exist: ${path}`);
    }

    // Check if codebase with same name already exists
    if (this.config.codebases.some((cb) => cb.name === name)) {
      throw new Error(`Codebase with name "${name}" already exists`);
    }

    this.config.codebases.push({ name, path });
    this.saveConfig();
  }

  removeCodebase(name: string): void {
    const index = this.config.codebases.findIndex((cb) => cb.name === name);
    if (index === -1) {
      throw new Error(`Codebase with name "${name}" not found`);
    }
    this.config.codebases.splice(index, 1);
    this.saveConfig();
  }

  private saveConfig(): void {
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Failed to save config file:', error);
      // Continue without saving - config will be lost on restart but server will still work
    }
  }

  getEmbeddingModel(): string {
    return this.config.embeddingModel || DEFAULT_CONFIG.embeddingModel!;
  }

  getChunkSize(): number {
    return this.config.chunkSize || DEFAULT_CONFIG.chunkSize!;
  }

  getChunkOverlap(): number {
    return this.config.chunkOverlap || DEFAULT_CONFIG.chunkOverlap!;
  }
}

export const configManager = new ConfigManager();

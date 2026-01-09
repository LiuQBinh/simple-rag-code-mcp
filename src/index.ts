#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { codebaseManager } from './codebase/manager.js';
import { semanticSearch, indexCodebase, getIndexedCodebases } from './tools/search.js';
import { grep } from './tools/grep.js';
import { readFile } from './tools/read.js';

const server = new Server(
  {
    name: 'simple-rag-code-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'codebase_search',
        description:
          'Semantic search across codebases using embeddings. Returns code snippets that match the query semantically.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query (natural language)',
            },
            codebaseNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: specific codebases to search. If not provided, searches all indexed codebases.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
              default: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'codebase_grep',
        description:
          'Text/regex search across codebases. Returns matching lines with context.',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'The search pattern (regex supported)',
            },
            codebaseNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: specific codebases to search. If not provided, searches all codebases.',
            },
            caseSensitive: {
              type: 'boolean',
              description: 'Whether the search should be case sensitive (default: false)',
              default: false,
            },
            contextLines: {
              type: 'number',
              description: 'Number of context lines to include before and after matches (default: 2)',
              default: 2,
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to return (default: 100)',
              default: 100,
            },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'read_file',
        description: 'Read a file from a codebase. Supports reading specific line ranges.',
        inputSchema: {
          type: 'object',
          properties: {
            codebaseName: {
              type: 'string',
              description: 'The name of the codebase',
            },
            filePath: {
              type: 'string',
              description: 'The relative path to the file within the codebase',
            },
            startLine: {
              type: 'number',
              description: 'Optional: start line number (1-indexed)',
            },
            endLine: {
              type: 'number',
              description: 'Optional: end line number (1-indexed)',
            },
          },
          required: ['codebaseName', 'filePath'],
        },
      },
      {
        name: 'list_codebases',
        description: 'List all configured codebases.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'add_codebase',
        description: 'Add a new codebase to the server.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'A unique name for the codebase',
            },
            path: {
              type: 'string',
              description: 'The absolute path to the codebase directory',
            },
          },
          required: ['name', 'path'],
        },
      },
      {
        name: 'index_codebase',
        description:
          'Index a codebase for semantic search. This may take some time for large codebases.',
        inputSchema: {
          type: 'object',
          properties: {
            codebaseName: {
              type: 'string',
              description: 'The name of the codebase to index',
            },
          },
          required: ['codebaseName'],
        },
      },
      {
        name: 'get_indexed_codebases',
        description: 'Get list of codebases that have been indexed for semantic search.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'codebase_search': {
        const { query, codebaseNames, limit = 10 } = args as {
          query: string;
          codebaseNames?: string[];
          limit?: number;
        };

        const results = await semanticSearch(query, codebaseNames, limit);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  results: results.map((r) => ({
                    content: r.content,
                    filePath: r.filePath,
                    codebase: r.codebase,
                    startLine: r.startLine,
                    endLine: r.endLine,
                    score: r.score,
                  })),
                  count: results.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'codebase_grep': {
        const {
          pattern,
          codebaseNames,
          caseSensitive = false,
          contextLines = 2,
          maxResults = 100,
        } = args as {
          pattern: string;
          codebaseNames?: string[];
          caseSensitive?: boolean;
          contextLines?: number;
          maxResults?: number;
        };

        const results = await grep(pattern, codebaseNames, {
          caseSensitive,
          contextLines,
          maxResults,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  results: results.map((r) => ({
                    filePath: r.filePath,
                    codebase: r.codebase,
                    lineNumber: r.lineNumber,
                    line: r.line,
                    contextBefore: r.contextBefore,
                    contextAfter: r.contextAfter,
                  })),
                  count: results.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'read_file': {
        const {
          codebaseName,
          filePath,
          startLine,
          endLine,
        } = args as {
          codebaseName: string;
          filePath: string;
          startLine?: number;
          endLine?: number;
        };

        const fileContent = readFile(codebaseName, filePath, {
          startLine,
          endLine,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  content: fileContent.content,
                  filePath: fileContent.filePath,
                  codebase: fileContent.codebase,
                  relativePath: fileContent.relativePath,
                  totalLines: fileContent.totalLines,
                  startLine: fileContent.startLine,
                  endLine: fileContent.endLine,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'list_codebases': {
        const codebases = codebaseManager.getAllCodebases();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  codebases: codebases.map((cb) => ({
                    name: cb.name,
                    path: cb.path,
                  })),
                  count: codebases.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'add_codebase': {
        const { name, path } = args as { name: string; path: string };

        codebaseManager.addCodebase(name, path);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Codebase "${name}" added successfully`,
                  codebase: {
                    name,
                    path,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'index_codebase': {
        const { codebaseName } = args as { codebaseName: string };

        await indexCodebase(codebaseName);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Codebase "${codebaseName}" indexed successfully`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get_indexed_codebases': {
        const indexed = getIndexedCodebases();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  codebases: indexed,
                  count: indexed.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Simple RAG Code MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

# MCP Server Flow Diagram

## Agent to MCP Server Flow

### Overall Flow

```mermaid
flowchart LR
    A["🤖 AI Agent<br/>Tool Request"] -->|JSON-RPC| B["🔧 MCP Server<br/>Process Request"]
    B -->|Execute| C["🛠️ Tools<br/>Search/Grep/Read"]
    C -->|Results| D["📤 Response<br/>Return to Agent"]
    
    style A fill:#e1f5ff
    style B fill:#fff4e1
    style C fill:#ffe1f5
    style D fill:#e1ffe1
```

### Detailed Flow

```mermaid
flowchart TB
    subgraph Agent["🤖 AI Agent (Cursor/Client)"]
        AgentRequest["Tool Request<br/>CallToolRequestSchema"]
    end

    subgraph Transport["📡 Transport Layer"]
        StdioTransport["StdioServerTransport<br/>stdio communication"]
    end

    subgraph MCPServer["🔧 MCP Server (index.ts)"]
        Server["Server Instance<br/>@modelcontextprotocol/sdk"]
        RequestHandler["setRequestHandler<br/>CallToolRequestSchema"]
        ToolRouter{"Route by Tool Name"}
    end

    subgraph Tools["🛠️ Tool Handlers"]
        SearchTool["codebase_search<br/>semanticSearch()"]
        GrepTool["codebase_grep<br/>grep()"]
        ReadTool["read_file<br/>readFile()"]
        ListTool["list_codebases<br/>getAllCodebases()"]
        AddTool["add_codebase<br/>addCodebase()"]
        IndexTool["index_codebase<br/>indexCodebase()"]
        GetIndexedTool["get_indexed_codebases<br/>getIndexedCodebases()"]
    end

    subgraph Managers["📦 Manager Modules"]
        CodebaseManager["CodebaseManager<br/>codebase/manager.ts"]
        ConfigManager["ConfigManager<br/>config.ts"]
    end

    subgraph Indexer["🔍 Indexer Module"]
        CodeIndexer["CodeIndexer<br/>codebase/indexer.ts"]
        EmbeddingModel["Embedding Model<br/>Xenova/all-MiniLM-L6-v2"]
        InMemoryIndex["In-Memory Index<br/>Map<codebase, chunks[]>"]
    end

    subgraph FileSystem["💾 File System"]
        Codebases["Codebases<br/>/path/to/repos"]
        ConfigFile[".mcp-config.json<br/>Persistent Config"]
    end

    AgentRequest -->|JSON-RPC| StdioTransport
    StdioTransport -->|Request| Server
    Server --> RequestHandler
    RequestHandler --> ToolRouter

    ToolRouter -->|"codebase_search"| SearchTool
    ToolRouter -->|"codebase_grep"| GrepTool
    ToolRouter -->|"read_file"| ReadTool
    ToolRouter -->|"list_codebases"| ListTool
    ToolRouter -->|"add_codebase"| AddTool
    ToolRouter -->|"index_codebase"| IndexTool
    ToolRouter -->|"get_indexed_codebases"| GetIndexedTool

    SearchTool --> CodeIndexer
    GrepTool --> CodebaseManager
    ReadTool --> CodebaseManager
    ListTool --> CodebaseManager
    AddTool --> CodebaseManager
    IndexTool --> CodeIndexer
    GetIndexedTool --> CodeIndexer

    CodebaseManager --> ConfigManager
    CodeIndexer --> CodebaseManager
    CodeIndexer --> EmbeddingModel
    CodeIndexer --> InMemoryIndex

    CodebaseManager -->|"Read/Write"| ConfigFile
    CodebaseManager -->|"Access"| Codebases
    CodeIndexer -->|"Walk & Read"| Codebases
    GrepTool -->|"Walk & Search"| Codebases
    ReadTool -->|"Read File"| Codebases

    CodeIndexer -.->|"Generate Embeddings"| EmbeddingModel
    SearchTool -.->|"Cosine Similarity"| InMemoryIndex

    ToolRouter -->|"JSON Response"| RequestHandler
    RequestHandler -->|"Response"| Server
    Server -->|"JSON-RPC"| StdioTransport
    StdioTransport -->|"Result"| AgentRequest

    style Agent fill:#e1f5ff
    style MCPServer fill:#fff4e1
    style Tools fill:#ffe1f5
    style Managers fill:#e1ffe1
    style Indexer fill:#f5e1ff
    style FileSystem fill:#ffffe1
```

## Detailed Flow: Semantic Search

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Transport as Stdio Transport
    participant Server as MCP Server
    participant SearchTool as Search Tool
    participant CodebaseMgr as Codebase Manager
    participant Indexer as Code Indexer
    participant Embedding as Embedding Model
    participant Index as In-Memory Index
    participant FS as File System

    Agent->>Transport: CallToolRequest(codebase_search)
    Transport->>Server: JSON-RPC Request
    Server->>SearchTool: semanticSearch(query, codebases)
    
    SearchTool->>CodebaseMgr: Validate codebases exist
    CodebaseMgr-->>SearchTool: Codebase paths
    
    SearchTool->>Indexer: search(query, codebases, limit)
    
    alt Codebase not indexed
        Indexer->>CodebaseMgr: Get codebase path
        CodebaseMgr-->>Indexer: Path
        Indexer->>FS: Walk directory tree
        FS-->>Indexer: List of code files
        Indexer->>FS: Read file contents
        FS-->>Indexer: File content
        Indexer->>Indexer: Chunk code into pieces
        Indexer->>Embedding: Generate embeddings
        Embedding-->>Indexer: Vector embeddings
        Indexer->>Index: Store chunks + embeddings
    end
    
    Indexer->>Embedding: Generate query embedding
    Embedding-->>Indexer: Query vector
    Indexer->>Index: Cosine similarity search
    Index-->>Indexer: Top N results with scores
    Indexer-->>SearchTool: Search results
    
    SearchTool->>Server: Format results as JSON
    Server->>Transport: JSON-RPC Response
    Transport->>Agent: Return search results
```

## Detailed Flow: Grep Search

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Transport as Stdio Transport
    participant Server as MCP Server
    participant GrepTool as Grep Tool
    participant CodebaseMgr as Codebase Manager
    participant FS as File System

    Agent->>Transport: CallToolRequest(codebase_grep)
    Transport->>Server: JSON-RPC Request
    Server->>GrepTool: grep(pattern, codebases, options)
    
    GrepTool->>GrepTool: Compile regex pattern
    
    GrepTool->>CodebaseMgr: Get codebase paths
    CodebaseMgr-->>GrepTool: List of codebases
    
    loop For each codebase
        GrepTool->>FS: Walk directory tree
        FS-->>GrepTool: List of code files
        
        loop For each file
            GrepTool->>FS: Read file content
            FS-->>GrepTool: File content
            
            GrepTool->>GrepTool: Split into lines
            GrepTool->>GrepTool: Match regex pattern
            GrepTool->>GrepTool: Extract context lines
            
            alt Match found
                GrepTool->>GrepTool: Add to results
            end
        end
    end
    
    GrepTool->>Server: Format results as JSON
    Server->>Transport: JSON-RPC Response
    Transport->>Agent: Return grep results
```

## Detailed Flow: Add Codebase

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Transport as Stdio Transport
    participant Server as MCP Server
    participant AddTool as Add Codebase Tool
    participant CodebaseMgr as Codebase Manager
    participant ConfigMgr as Config Manager
    participant FS as File System

    Agent->>Transport: CallToolRequest(add_codebase)
    Transport->>Server: JSON-RPC Request
    Server->>AddTool: addCodebase(name, path)
    
    AddTool->>CodebaseMgr: addCodebase(name, path)
    
    CodebaseMgr->>FS: Check path exists
    FS-->>CodebaseMgr: Path exists
    
    CodebaseMgr->>FS: Check is directory
    FS-->>CodebaseMgr: Is directory
    
    CodebaseMgr->>ConfigMgr: addCodebase(name, path)
    ConfigMgr->>ConfigMgr: Validate name unique
    ConfigMgr->>ConfigMgr: Add to config.codebases
    ConfigMgr->>FS: Write .mcp-config.json
    FS-->>ConfigMgr: Config saved
    ConfigMgr-->>CodebaseMgr: Success
    
    CodebaseMgr->>CodebaseMgr: Add to in-memory Map
    CodebaseMgr-->>AddTool: Success
    
    AddTool->>Server: Format success response
    Server->>Transport: JSON-RPC Response
    Transport->>Agent: Return success message
```

## Tool Request/Response Format

```mermaid
flowchart LR
    subgraph Request["Request Format"]
        R1["CallToolRequestSchema<br/>{<br/>  name: 'codebase_search',<br/>  arguments: {<br/>    query: '...',<br/>    codebaseNames: [...],<br/>    limit: 10<br/>  }<br/>}"]
    end

    subgraph Response["Response Format"]
        R2["ToolResponse<br/>{<br/>  content: [{<br/>    type: 'text',<br/>    text: JSON.stringify(results)<br/>  }]<br/>}"]
    end

    Request -->|"Process"| Response
```

## Error Handling Flow

```mermaid
flowchart TD
    Start["Tool Request"] --> Validate{"Validate<br/>Parameters"}
    Validate -->|"Invalid"| Error1["McpError<br/>MethodNotFound"]
    Validate -->|"Valid"| Execute["Execute Tool"]
    Execute -->|"Success"| Format["Format Response"]
    Execute -->|"Error"| Error2["McpError<br/>InternalError"]
    Format --> Return["Return JSON Response"]
    Error1 --> Return
    Error2 --> Return
```

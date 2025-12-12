// Cursor-like Tool Definitions for Agent Mode
// Reference: https://cursor.com/ja/docs/agent/tools

export interface ToolDefinition {
  name: string;
  description: string;
  category: "search" | "edit" | "execute" | "mcp";
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

// ===== SEARCH TOOLS =====

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "ファイルの内容を読み取ります。画像ファイル（PNG、JPG、GIF、WebP、SVG）にも対応しています。",
  category: "search",
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "読み取るファイルのパス（例: 'src/components/Button.tsx'）",
      },
    },
    required: ["path"],
  },
};

export const listFilesTool: ToolDefinition = {
  name: "list_files",
  description: "プロジェクト内のファイル・フォルダを一覧表示します。",
  category: "search",
  parameters: {
    type: "OBJECT",
    properties: {},
    required: [],
  },
};

export const listDirectoryTool: ToolDefinition = {
  name: "list_directory",
  description: "ディレクトリの構造を一覧表示します。ファイルの内容は読み取りません。",
  category: "search",
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "一覧表示するディレクトリのパス（例: 'src/components'）",
      },
    },
    required: ["path"],
  },
};

export const codebaseSearchTool: ToolDefinition = {
  name: "codebase_search",
  description: "コードベース内でセマンティック検索を実行します。関数名やパターンを意味ベースで検索します。",
  category: "search",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "検索クエリ（例: 'ユーザー認証の処理'）",
      },
      filePattern: {
        type: "STRING",
        description: "検索対象のファイルパターン（オプション、例: '*.tsx'）",
      },
    },
    required: ["query"],
  },
};

export const grepTool: ToolDefinition = {
  name: "grep",
  description: "ファイル内の特定のキーワードやパターンを検索します。正規表現も使用可能です。",
  category: "search",
  parameters: {
    type: "OBJECT",
    properties: {
      pattern: {
        type: "STRING",
        description: "検索するパターン（正規表現可）",
      },
      path: {
        type: "STRING",
        description: "検索対象のディレクトリまたはファイルパス",
      },
      caseSensitive: {
        type: "BOOLEAN",
        description: "大文字小文字を区別するかどうか（デフォルト: false）",
      },
    },
    required: ["pattern"],
  },
};

export const fileSearchTool: ToolDefinition = {
  name: "file_search",
  description: "ファイル名であいまい検索を実行します。",
  category: "search",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "ファイル名の検索クエリ（例: 'Button'）",
      },
    },
    required: ["query"],
  },
};

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description: "ウェブ検索を実行して情報を取得します。",
  category: "search",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "検索クエリ",
      },
    },
    required: ["query"],
  },
};

// ===== EDIT TOOLS =====

export const createFileTool: ToolDefinition = {
  name: "create_file",
  description: "新しいファイルを指定した内容で作成します。",
  category: "edit",
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "作成するファイルのパス（例: 'components/NewComponent.tsx'）",
      },
      content: {
        type: "STRING",
        description: "ファイルの内容",
      },
    },
    required: ["path", "content"],
  },
};

export const updateFileTool: ToolDefinition = {
  name: "update_file",
  description: "既存のファイルの内容を更新します。",
  category: "edit",
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "更新するファイルのパス",
      },
      content: {
        type: "STRING",
        description: "新しいファイルの内容",
      },
    },
    required: ["path", "content"],
  },
};

export const deleteFileTool: ToolDefinition = {
  name: "delete_file",
  description: "ファイルを削除します。",
  category: "edit",
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "削除するファイルのパス",
      },
    },
    required: ["path"],
  },
};

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description: "ファイルの特定部分を編集します。検索と置換を使用して変更を適用します。",
  category: "edit",
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "編集するファイルのパス",
      },
      search: {
        type: "STRING",
        description: "検索する文字列（置換前）",
      },
      replace: {
        type: "STRING",
        description: "置換後の文字列",
      },
    },
    required: ["path", "search", "replace"],
  },
};

export const createFolderTool: ToolDefinition = {
  name: "create_folder",
  description: "新しいフォルダを作成します。",
  category: "edit",
  parameters: {
    type: "OBJECT",
    properties: {
      path: {
        type: "STRING",
        description: "作成するフォルダのパス",
      },
    },
    required: ["path"],
  },
};

// ===== ALL TOOLS =====

export const allTools: ToolDefinition[] = [
  // Search
  readFileTool,
  listFilesTool,
  listDirectoryTool,
  codebaseSearchTool,
  grepTool,
  fileSearchTool,
  webSearchTool,
  // Edit
  createFileTool,
  updateFileTool,
  deleteFileTool,
  editFileTool,
  createFolderTool,
];

// Mode-based tool filtering
export const getToolsForMode = (mode: "agent" | "plan" | "ask"): ToolDefinition[] => {
  switch (mode) {
    case "ask":
      // Ask mode: 読み取り専用のツールのみ
      return allTools.filter(t => t.category === "search");
    case "plan":
      // Plan mode: 検索ツールのみ（ファイル変更は提案のみ）
      return allTools.filter(t => t.category === "search");
    case "agent":
    default:
      // Agent mode: 全てのツールを使用可能
      return allTools;
  }
};

// Convert to Gemini format
export const toGeminiFunctionDeclarations = (tools: ToolDefinition[]) => {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
};

// Convert to OpenAI format
export const toOpenAITools = (tools: ToolDefinition[]) => {
  return tools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, value]) => [
            key,
            { type: value.type.toLowerCase(), description: value.description },
          ])
        ),
        required: tool.parameters.required,
      },
    },
  }));
};

// Convert to Anthropic format
export const toAnthropicTools = (tools: ToolDefinition[]) => {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties).map(([key, value]) => [
          key,
          { type: value.type.toLowerCase(), description: value.description },
        ])
      ),
      required: tool.parameters.required,
    },
  }));
};



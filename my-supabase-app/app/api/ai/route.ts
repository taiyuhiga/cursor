import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
  createFile, updateFile, deleteFile, createFolder, listFiles,
  readFile, listDirectory, grep, fileSearch, editFile, codebaseSearch 
} from "@/lib/tools/file-operations";
import { 
  getToolsForMode, 
  toGeminiFunctionDeclarations,
  toOpenAITools,
  toAnthropicTools 
} from "@/lib/tools/tool-definitions";

// Body sizeの制限を増やす（画像送信のため）
export const maxDuration = 60; // 60秒のタイムアウト

type StagedFile = {
  path: string;
  nodeId?: string;
  originalContent?: string; // 既存ファイルは遅延ロード
  content?: string; // 現在のステージ内容
  status: "unchanged" | "created" | "updated" | "deleted";
};

type ReviewState = {
  filesByPath: Map<string, StagedFile>;
  nodeIdByPath: Map<string, string>;
};

type AgentMode = "agent" | "plan" | "ask";

async function initReviewState(projectId?: string): Promise<ReviewState> {
  const nodes = await listFiles(projectId);
  const nodeIdByPath = new Map<string, string>();
  for (const n of nodes as any[]) {
    if (n?.type === "file" && n?.path && n?.id) {
      nodeIdByPath.set(n.path, n.id);
    }
  }
  return { filesByPath: new Map(), nodeIdByPath };
}

async function ensureLoadedFile(
  state: ReviewState,
  path: string,
  projectId?: string
): Promise<StagedFile> {
  let file = state.filesByPath.get(path);
  if (!file) {
    file = { path, nodeId: state.nodeIdByPath.get(path), status: "unchanged" };
    state.filesByPath.set(path, file);
  }

  // 既存ファイルの内容がまだ無い場合はロード
  if (file.status !== "created" && file.originalContent === undefined) {
    const r = await readFile(path, projectId);
    file.originalContent = r.content;
    if (file.content === undefined) file.content = r.content;
  }
  if (file.status === "created" && file.originalContent === undefined) {
    file.originalContent = "";
  }
  if (file.status === "created" && file.content === undefined) {
    file.content = "";
  }

  return file;
}

function buildProposedChanges(state?: ReviewState) {
  if (!state) return [];
  const changes: Array<{
    id: string;
    filePath: string;
    fileName: string;
    oldContent: string;
    newContent: string;
    action: "create" | "update" | "delete";
  }> = [];

  for (const file of state.filesByPath.values()) {
    if (file.status === "unchanged") continue;
    const fileName = file.path.split("/").pop() || file.path;
    const oldContent = file.originalContent ?? "";
    const newContent = file.status === "deleted" ? "" : (file.content ?? "");
    const action = file.status === "created" ? "create" : file.status === "deleted" ? "delete" : "update";
    const id = file.nodeId || `create:${file.path}`;

    // created -> deleted は実質変化なし
    if (file.status === "deleted" && !file.nodeId && oldContent === "") continue;

    changes.push({
      id,
      filePath: file.path,
      fileName,
      oldContent,
      newContent,
      action,
    });
  }

  return changes.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

async function webSearch(query: string) {
  if (!query || typeof query !== "string") {
    return { provider: "duckduckgo", query: query || "", results: [], error: "Query is required." };
  }

  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "cursor-like-agent/1.0",
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Web search failed (${res.status}): ${text || res.statusText}`);
  }

  const data: any = await res.json();

  const results: Array<{ title: string; url: string; snippet: string }> = [];

  const pushTopic = (t: any) => {
    if (!t) return;
    const firstUrl = t.FirstURL;
    const text = t.Text;
    if (!firstUrl || !text) return;
    const title = typeof text === "string" ? text.split(" - ")[0].slice(0, 120) : "Result";
    results.push({ title, url: firstUrl, snippet: text });
  };

  const walkTopics = (topics: any[]) => {
    for (const t of topics || []) {
      if (t?.Topics && Array.isArray(t.Topics)) {
        walkTopics(t.Topics);
      } else {
        pushTopic(t);
      }
      if (results.length >= 10) break;
    }
  };

  walkTopics(data?.RelatedTopics || []);

  return {
    provider: "duckduckgo",
    query,
    heading: data?.Heading || "",
    abstract: data?.AbstractText || "",
    results: results.slice(0, 10),
  };
}

// ツール実行関数
async function executeToolCall(
  name: string, 
  args: any, 
  context: { projectId?: string; reviewMode?: boolean; reviewState?: ReviewState; mode?: AgentMode }
): Promise<any> {
  console.log(`Executing tool: ${name}`, args);
  
  try {
    const mutatingTools = new Set(["create_file", "update_file", "delete_file", "edit_file", "create_folder"]);
    if ((context.mode === "plan" || context.mode === "ask") && mutatingTools.has(name)) {
      return {
        error: `Tool '${name}' is disabled in ${context.mode.toUpperCase()} mode. Switch to Agent mode to apply changes.`,
      };
    }

    switch (name) {
      // Search Tools
      case "read_file":
        if (context.reviewMode && context.reviewState) {
          const f = await ensureLoadedFile(context.reviewState, args.path, context.projectId);
          if (f.status === "deleted") return { error: `File '${args.path}' not found.` };
          return { path: args.path, content: f.content ?? "" };
        }
        return await readFile(args.path, context.projectId);
      case "list_directory":
        return await listDirectory(args.path || "", context.projectId);
      case "list_files":
        if (context.reviewMode && context.reviewState) {
          const base = await listFiles(context.projectId);
          const deleted = new Set(
            Array.from(context.reviewState.filesByPath.values())
              .filter(f => f.status === "deleted")
              .map(f => f.path)
          );
          const created = Array.from(context.reviewState.filesByPath.values())
            .filter(f => f.status === "created")
            .map(f => ({
              id: f.nodeId || `create:${f.path}`,
              name: f.path.split("/").pop() || f.path,
              type: "file",
              parent_id: null,
              path: f.path,
            }));
          return [...(base as any[]).filter(n => !(n?.type === "file" && deleted.has(n.path))), ...created]
            .sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)));
        }
        return await listFiles(context.projectId);
      case "grep":
        return await grep(args.pattern, args.path, context.projectId);
      case "file_search":
        return await fileSearch(args.query, context.projectId);
      case "codebase_search":
        return await codebaseSearch(args.query, args.filePattern, context.projectId);
      case "web_search":
        return await webSearch(args?.query);
      
      // Edit Tools
      case "create_file":
        if (context.reviewMode && context.reviewState) {
          const path = args.path;
          const existingId = context.reviewState.nodeIdByPath.get(path);
          const staged = context.reviewState.filesByPath.get(path);
          // 既存ファイルがあり、未削除ならエラー
          if ((existingId && staged?.status !== "deleted") || (staged && staged.status !== "deleted")) {
            return { error: `File '${path}' already exists. Use update_file instead.` };
          }
          // delete → create の場合は「更新」として扱い、元の内容を保持する
          if (staged && staged.status === "deleted") {
            staged.content = args.content ?? "";
            staged.status = "updated";
          } else {
            const file: StagedFile = {
              path,
              nodeId: existingId,
              originalContent: "",
              content: args.content ?? "",
              status: "created",
            };
            context.reviewState.filesByPath.set(path, file);
          }
          return { success: true, fileName: path, action: "created" };
        }
        return await createFile(args.path, args.content, context.projectId);
      case "update_file":
        if (context.reviewMode && context.reviewState) {
          const file = await ensureLoadedFile(context.reviewState, args.path, context.projectId);
          if (file.status === "deleted") return { error: `File '${args.path}' not found.` };
          file.content = args.content ?? "";
          file.status = file.status === "created" ? "created" : "updated";
          return { success: true, fileName: args.path, action: "updated" };
        }
        return await updateFile(args.path, args.content, context.projectId);
      case "delete_file":
        if (context.reviewMode && context.reviewState) {
          const file = await ensureLoadedFile(context.reviewState, args.path, context.projectId);
          // created 直後に delete なら差分なし
          if (file.status === "created" && !file.nodeId) {
            context.reviewState.filesByPath.delete(args.path);
            return { success: true, fileName: args.path, action: "deleted" };
          }
          file.status = "deleted";
          file.content = "";
          return { success: true, fileName: args.path, action: "deleted" };
        }
        return await deleteFile(args.path, context.projectId);
      case "edit_file":
        if (context.reviewMode && context.reviewState) {
          const file = await ensureLoadedFile(context.reviewState, args.path, context.projectId);
          if (file.status === "deleted") return { error: `File '${args.path}' not found.` };
          const current = file.content ?? "";
          const search = args.search ?? "";
          const replace = args.replace ?? "";
          if (!current.includes(search)) {
            return { error: `Search string not found in '${args.path}'.` };
          }
          file.content = current.replace(search, replace);
          file.status = file.status === "created" ? "created" : "updated";
          return { success: true, path: args.path, action: "edited", replacements: 1 };
        }
        return await editFile(args.path, args.search, args.replace, context.projectId);
      case "create_folder":
        if (context.reviewMode) {
          return { success: true, folderName: args.path, action: "created" };
        }
        return await createFolder(args.path, context.projectId);
      
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error: any) {
    console.error(`Tool execution error (${name}):`, error);
    return { error: error.message };
  }
}

// Auto Mode: モデルの自動選択ロジック
function selectAutoModel(apiKeys: any): { model: string; provider: string } {
  // 優先順位: Claude Opus > GPT-5.2 > Gemini 3 Pro
  if (apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY) {
    return { model: "claude-opus-4-5-20251101", provider: "anthropic" };
  }
  if (apiKeys?.openai || process.env.OPENAI_API_KEY) {
    return { model: "gpt-5.2", provider: "openai" };
  }
  if (apiKeys?.google || process.env.GEMINI_API_KEY) {
    return { model: "gemini-3-pro-preview", provider: "google" };
  }
  // フォールバック
  return { model: "gemini-3-pro-preview", provider: "google" };
}

// Max Mode: コンテキストウィンドウの拡張設定
const MAX_MODE_TOKENS: Record<string, number> = {
  "gemini-3-pro-preview": 1000000, // 1M tokens
  "gpt-5.2": 128000,
  "gpt-5.2-extra-high": 256000,
  "claude-opus-4-5-20251101": 200000,
  "claude-sonnet-4-5-20250929": 200000,
};

const DEFAULT_MAX_TOKENS = 4096;
const MAX_MODE_OUTPUT_TOKENS = 8192;

type ToolCallHistoryItem = { tool: string; args: any; result: any };

async function callOpenAI(apiKey: string, model: string, prompt: string, systemPrompt: string, images?: string[], maxMode?: boolean) {
  const userContent: any[] = [{ type: "text", text: prompt }];
  
  // 画像があれば追加
  if (images && images.length > 0) {
    for (const img of images) {
      userContent.push({
        type: "image_url",
        image_url: { url: img },
      });
    }
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: images && images.length > 0 ? userContent : prompt },
      ],
      max_tokens: maxMode ? MAX_MODE_OUTPUT_TOKENS : DEFAULT_MAX_TOKENS,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message || "OpenAI API Error");
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function callOpenAIWithTools(params: {
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  images?: string[];
  maxMode?: boolean;
  tools: any[];
  allowedToolNames: Set<string>;
  context: { projectId?: string; reviewMode?: boolean; reviewState?: ReviewState; mode?: AgentMode };
}): Promise<{ content: string; toolCalls: ToolCallHistoryItem[] }> {
  const { apiKey, model, prompt, systemPrompt, images, maxMode, tools, allowedToolNames, context } = params;
  const toolCallHistory: ToolCallHistoryItem[] = [];

  const userContent: any[] = [{ type: "text", text: prompt }];
  if (images && images.length > 0) {
    for (const img of images) {
      userContent.push({ type: "image_url", image_url: { url: img } });
    }
  }

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: images && images.length > 0 ? userContent : prompt },
  ];

  let maxIterations = 25;
  while (maxIterations > 0) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: maxMode ? MAX_MODE_OUTPUT_TOKENS : DEFAULT_MAX_TOKENS,
      }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error?.message || "OpenAI API Error");
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("OpenAI API Error: missing message");

    const toolCalls = msg.tool_calls as Array<any> | undefined;
    if (!toolCalls || toolCalls.length === 0) {
      return { content: msg.content || "", toolCalls: toolCallHistory };
    }

    // assistant message with tool_calls
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call?.function?.name;
      const argsStr = call?.function?.arguments || "{}";
      const toolCallId = call?.id;

      let args: any = {};
      try {
        args = JSON.parse(argsStr);
      } catch {
        args = {};
      }

      if (!name || !toolCallId) {
        continue;
      }

      if (!allowedToolNames.has(name)) {
        const err = { error: "This tool is not allowed in the current mode." };
        toolCallHistory.push({ tool: name, args, result: err });
        messages.push({ role: "tool", tool_call_id: toolCallId, content: JSON.stringify(err) });
        continue;
      }

      const toolResult = await executeToolCall(name, args, context);
      toolCallHistory.push({ tool: name, args, result: toolResult });
      messages.push({ role: "tool", tool_call_id: toolCallId, content: JSON.stringify(toolResult) });
    }

    maxIterations--;
  }

  return { content: "Tool call loop exceeded maximum iterations.", toolCalls: toolCallHistory };
}

async function callAnthropic(apiKey: string, model: string, prompt: string, systemPrompt: string, images?: string[], maxMode?: boolean) {
  const userContent: any[] = [];
  
  // 画像があれば先に追加
  if (images && images.length > 0) {
    for (const img of images) {
      // data:image/png;base64,... 形式から media_type と data を抽出
      const match = img.match(/^data:(.+);base64,(.+)$/);
      if (match) {
        userContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: match[1],
            data: match[2],
          },
        });
      }
    }
  }
  
  userContent.push({ type: "text", text: prompt });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      max_tokens: maxMode ? MAX_MODE_OUTPUT_TOKENS : DEFAULT_MAX_TOKENS,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message || "Anthropic API Error");
  }

  const data = await res.json();
  return data.content[0].text;
}

async function callAnthropicWithTools(params: {
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  images?: string[];
  maxMode?: boolean;
  tools: any[];
  allowedToolNames: Set<string>;
  context: { projectId?: string; reviewMode?: boolean; reviewState?: ReviewState; mode?: AgentMode };
}): Promise<{ content: string; toolCalls: ToolCallHistoryItem[] }> {
  const { apiKey, model, prompt, systemPrompt, images, maxMode, tools, allowedToolNames, context } = params;
  const toolCallHistory: ToolCallHistoryItem[] = [];

  const baseUserContent: any[] = [];
  if (images && images.length > 0) {
    for (const img of images) {
      const match = img.match(/^data:(.+);base64,(.+)$/);
      if (match) {
        baseUserContent.push({
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] },
        });
      }
    }
  }
  baseUserContent.push({ type: "text", text: prompt });

  const messages: any[] = [{ role: "user", content: baseUserContent }];

  let maxIterations = 25;
  while (maxIterations > 0) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages,
        tools,
        tool_choice: { type: "auto" },
        max_tokens: maxMode ? MAX_MODE_OUTPUT_TOKENS : DEFAULT_MAX_TOKENS,
      }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error?.message || "Anthropic API Error");
    }

    const data = await res.json();
    const contentBlocks: any[] = data.content || [];
    const toolUses = contentBlocks.filter((b) => b.type === "tool_use");

    // assistant message (include tool_use blocks so the loop context remains correct)
    messages.push({ role: "assistant", content: contentBlocks });

    if (!toolUses || toolUses.length === 0) {
      const text = contentBlocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { content: text, toolCalls: toolCallHistory };
    }

    const toolResults: any[] = [];
    for (const use of toolUses) {
      const name = use.name;
      const toolUseId = use.id;
      const input = use.input || {};

      if (!allowedToolNames.has(name)) {
        const err = { error: "This tool is not allowed in the current mode." };
        toolCallHistory.push({ tool: name, args: input, result: err });
        toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: JSON.stringify(err) });
        continue;
      }

      const toolResult = await executeToolCall(name, input, context);
      toolCallHistory.push({ tool: name, args: input, result: toolResult });
      toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: JSON.stringify(toolResult) });
    }

    messages.push({ role: "user", content: toolResults });
    maxIterations--;
  }

  return { content: "Tool call loop exceeded maximum iterations.", toolCalls: toolCallHistory };
}

// Helper function for calling a single model (used by Multiple Models mode)
async function callSingleModel(
  modelId: string, 
  prompt: string, 
  fileText: string, 
  apiKeys: any, 
  mode: string, 
  images: string[],
  maxMode: boolean
): Promise<string> {
  let systemPrompt = "";
  
  if (mode === "ask") {
    systemPrompt = `You are an expert AI coding assistant acting in "ASK" mode.
Your role is to answer questions, explain code, and help the user understand the project.
Current file content:
${fileText ? "```\n" + fileText + "\n```" : "(No file selected)"}`;
  } else if (mode === "plan") {
    systemPrompt = `You are an expert AI coding assistant acting in "PLAN" mode.
Your goal is to create a detailed, reviewable implementation plan before writing code.
Do NOT apply any file changes. If changes are required, describe them and suggest switching to Agent mode to execute.
Current file content:
${fileText ? "```\n" + fileText + "\n```" : "(No file selected)"}`;
  } else {
    systemPrompt = `You are an expert AI coding assistant similar to Cursor.
You help users write, debug, and refactor code.
Current file content:
${fileText ? "```\n" + fileText + "\n```" : "(No file selected)"}`;
  }

  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-")) {
    const openaiKey = apiKeys?.openai || process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("OpenAI API Key is missing");
    return await callOpenAI(openaiKey, modelId, prompt, systemPrompt, images, maxMode);
  } 
  else if (modelId.startsWith("claude-")) {
    const anthropicKey = apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error("Anthropic API Key is missing");
    return await callAnthropic(anthropicKey, modelId, prompt, systemPrompt, images, maxMode);
  } 
  else {
    // Gemini
    const googleKey = apiKeys?.google || process.env.GEMINI_API_KEY;
    if (!googleKey) throw new Error("Google API Key is missing");
    
    const genAI = new GoogleGenerativeAI(googleKey);
    const generativeModel = genAI.getGenerativeModel({ model: modelId || "gemini-3-pro-preview" });
    
    const parts: any[] = [{ text: systemPrompt + "\n\n" + prompt }];
    if (images && images.length > 0) {
      for (const img of images) {
        const match = img.match(/^data:(.+);base64,(.+)$/);
        if (match) {
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      }
    }
    
    const result = await generativeModel.generateContent(parts);
    return result.response.text();
  }
}

export async function POST(req: NextRequest) {
  try {
    const { 
      projectId,
      prompt, 
      fileText, 
      model, 
      apiKeys, 
      mode = "agent", 
      images = [],
      autoMode = false,
      maxMode = false,
      useMultipleModels = false,
      selectedModels = [],
      reviewMode = false
    } = await req.json();

    // Auto Mode: 自動でモデルを選択
    let effectiveModel = model;
    if (autoMode) {
      const autoSelection = selectAutoModel(apiKeys);
      effectiveModel = autoSelection.model;
    }

    // Use Multiple Models: 複数モデルに並列リクエスト
    if (useMultipleModels && selectedModels.length > 0) {
      const modelPromises = selectedModels.map(async (modelId: string) => {
        try {
          const result = await callSingleModel(modelId, prompt, fileText, apiKeys, mode, images, maxMode);
          return { model: modelId, content: result, error: null };
        } catch (error: any) {
          return { model: modelId, content: null, error: error.message };
        }
      });

      const results = await Promise.all(modelPromises);
      return NextResponse.json({ multipleResults: results });
    }

    let systemPrompt = "";

    // Mode-specific instructions
    if (mode === "ask") {
        systemPrompt = `
You are an expert AI coding assistant acting in "ASK" mode.
Your role is to answer questions, explain code, and help the user understand the project.
You have read-only access to the file system (via provided context or list_files tool).
You CANNOT create, update, or delete files.
If the user asks for code changes, explain that you are in Ask mode and provide the code snippet for them to apply manually, or suggest switching to Agent mode.

Current file content:
${fileText ? "```\n" + fileText + "\n```" : "(No file selected)"}
`;
    } else if (mode === "plan") {
        systemPrompt = `
You are an expert AI coding assistant acting in "PLAN" mode.
Your goal is to create a detailed, reviewable implementation plan before writing code.
1. Analyze the request and investigate the codebase (use search tools as needed).
2. Ask clarifying questions if requirements are vague.
3. Output a detailed step-by-step plan in Markdown format.
4. Do NOT apply any file changes in Plan mode. If changes are needed, describe them and suggest switching to Agent mode to execute.

Current file content:
${fileText ? "```\n" + fileText + "\n```" : "(No file selected)"}
`;
    } else {
        // Agent mode (default)
        systemPrompt = `
You are an expert AI coding assistant similar to Cursor.
You help users write, debug, and refactor code.
You have access to the file system and can create/update files when asked.

Current file content:
${fileText ? "```\n" + fileText + "\n```" : "(No file selected)"}

When generating code:
1. Return the FULL code block for the file if you are rewriting it.
2. Use markdown code blocks.
3. If the user asks to create or update a file, suggest the code first, then if they approve (or if the prompt implies immediate action), you can use the available tools.
`;
    }

    // モードに応じたツールを取得（OpenAI/Anthropic/Gemini共通）
    const enabledTools = getToolsForMode(mode);
    const allowedToolNames = new Set(enabledTools.map(t => t.name));

    // Cursor-like Review: Agentモードでは編集ツールを「ステージング」して差分を返す
    const effectiveReviewMode = Boolean(reviewMode) && mode === "agent";
    const reviewState = effectiveReviewMode ? await initReviewState(projectId) : undefined;

    // モデルごとの処理分岐 (effectiveModel を使用)
    if (effectiveModel.startsWith("gpt-") || effectiveModel.startsWith("o1-")) {
      const openaiKey = apiKeys?.openai || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return NextResponse.json({ error: "OpenAI API Key is missing. Please set it in Settings or .env.local." }, { status: 400 });
      }
      const openaiTools = toOpenAITools(enabledTools);
      const { content, toolCalls } = await callOpenAIWithTools({
        apiKey: openaiKey,
        model: effectiveModel,
        prompt,
        systemPrompt,
        images,
        maxMode,
        tools: openaiTools,
        allowedToolNames,
        context: { projectId, reviewMode: effectiveReviewMode, reviewState, mode },
      });
      const proposedChanges = buildProposedChanges(reviewState);
      return NextResponse.json({ 
        content, 
        usedModel: effectiveModel,
        toolCalls,
        proposedChanges,
      });
    } 
    else if (effectiveModel.startsWith("claude-")) {
      const anthropicKey = apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return NextResponse.json({ error: "Anthropic API Key is missing. Please set it in Settings or .env.local." }, { status: 400 });
      }
      const anthropicTools = toAnthropicTools(enabledTools);
      const { content, toolCalls } = await callAnthropicWithTools({
        apiKey: anthropicKey,
        model: effectiveModel,
        prompt,
        systemPrompt,
        images,
        maxMode,
        tools: anthropicTools,
        allowedToolNames,
        context: { projectId, reviewMode: effectiveReviewMode, reviewState, mode },
      });
      const proposedChanges = buildProposedChanges(reviewState);
      return NextResponse.json({ 
        content, 
        usedModel: effectiveModel,
        toolCalls,
        proposedChanges,
      });
    } 
    else {
      // Default to Gemini (Google)
      const apiKey = apiKeys?.google || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        return NextResponse.json({ error: "Google API Key is missing." }, { status: 500 });
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      
      const toolDeclarations = toGeminiFunctionDeclarations(enabledTools);
      
      // Function Calling用のツール定義（Gemini SDK形式）
      const toolConfig: any = {
        functionDeclarations: toolDeclarations as any,
      };

      const generativeModel = genAI.getGenerativeModel({ 
        model: effectiveModel || "gemini-3-pro-preview",
        tools: [toolConfig],
      });

      const chat = generativeModel.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: systemPrompt }],
          },
        ],
      });

      // メッセージパーツを作成（テキスト + 画像）
      const messageParts: any[] = [{ text: prompt }];
      
      // 画像があれば追加
      if (images && images.length > 0) {
        for (const img of images) {
          const match = img.match(/^data:(.+);base64,(.+)$/);
          if (match) {
            messageParts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }

      const result = await chat.sendMessage(messageParts);
      const response = result.response;
      
      // Function Callingの処理（複数回のツール呼び出しをサポート）
      const toolCallHistory: ToolCallHistoryItem[] = [];
      let currentResponse = response;
      let maxIterations = 25; // 無限ループ防止
      
      while (maxIterations > 0) {
        const functionCalls = currentResponse.functionCalls();
        
        if (!functionCalls || functionCalls.length === 0) {
          break;
        }
        
        // 各ツール呼び出しを処理
        const functionResponses: any[] = [];
        
        for (const call of functionCalls) {
          const { name, args } = call;

          if (!allowedToolNames.has(name)) {
            const err = { error: "This tool is not allowed in the current mode." };
            functionResponses.push({
              functionResponse: {
                name,
                response: err,
              },
            });
            toolCallHistory.push({ tool: name, args, result: err });
            continue;
          }
          
          // ツール実行
          const toolResult = await executeToolCall(name, args, { projectId, reviewMode: effectiveReviewMode, reviewState, mode });
          toolCallHistory.push({ tool: name, args, result: toolResult });
          
          functionResponses.push({
            functionResponse: {
              name: name,
              response: { result: toolResult },
            },
          });
        }
        
        // ツール実行結果をAIに返す
        const nextResult = await chat.sendMessage(functionResponses);
        currentResponse = nextResult.response;
        maxIterations--;
      }
      
      // 最終レスポンスを返す
      const finalContent = currentResponse.text();
      const proposedChanges = buildProposedChanges(reviewState);
      
      return NextResponse.json({ 
        content: finalContent, 
        usedModel: effectiveModel,
        toolCalls: toolCallHistory,
        proposedChanges,
      });
    }

  } catch (error: any) {
    console.error("AI API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

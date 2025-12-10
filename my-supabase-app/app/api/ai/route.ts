import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createFile, updateFile, deleteFile, createFolder, listFiles } from "@/lib/tools/file-operations";

// Function Callingのツール定義
const tools = [
  {
    name: "create_file",
    description: "Create a new file with the specified content. Use this to create new code files.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The full path of the file to create (e.g., 'components/Button.tsx')" },
        content: { type: "STRING", description: "The content of the file" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "update_file",
    description: "Update an existing file with new content. Use this to modify code.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The full path of the file to update" },
        content: { type: "STRING", description: "The new content of the file" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The full path of the file to delete" },
      },
      required: ["path"],
    },
  },
  {
    name: "create_folder",
    description: "Create a new folder.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The full path of the folder to create" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List all files in the project to understand the structure.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

async function callOpenAI(apiKey: string, model: string, prompt: string, systemPrompt: string) {
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
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message || "OpenAI API Error");
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function callAnthropic(apiKey: string, model: string, prompt: string, systemPrompt: string) {
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
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message || "Anthropic API Error");
  }

  const data = await res.json();
  return data.content[0].text;
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, fileText, model, apiKeys } = await req.json();

    // システムプロンプト
    const systemPrompt = `
You are an expert AI coding assistant similar to Cursor.
You help users write, debug, and refactor code.
You have access to the file system and can create/update files when asked.

Current file content:
${fileText ? "```\n" + fileText + "\n```" : "(No file selected)"}

When generating code:
1. Return the FULL code block for the file if you are rewriting it.
2. Use markdown code blocks.
3. If the user asks to create or update a file, suggest the code first, then if they approve (or if the prompt implies immediate action), you can use the available tools.
(Note: Currently tool execution is only fully supported for Gemini. For others, provide the code and suggest the user to apply it.)
`;

    // モデルごとの処理分岐
    if (model.startsWith("gpt-") || model.startsWith("o1-")) {
      const openaiKey = apiKeys?.openai || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return NextResponse.json({ error: "OpenAI API Key is missing. Please set it in Settings or .env.local." }, { status: 400 });
      }
      const content = await callOpenAI(openaiKey, model, prompt, systemPrompt);
      return NextResponse.json({ content });
    } 
    else if (model.startsWith("claude-")) {
      const anthropicKey = apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return NextResponse.json({ error: "Anthropic API Key is missing. Please set it in Settings or .env.local." }, { status: 400 });
      }
      const content = await callAnthropic(anthropicKey, model, prompt, systemPrompt);
      return NextResponse.json({ content });
    } 
    else {
      // Default to Gemini (Google)
      const apiKey = apiKeys?.google || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        return NextResponse.json({ error: "Google API Key is missing." }, { status: 500 });
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      
      // Function Calling用のツール定義（Gemini SDK形式）
      const toolConfig = {
        functionDeclarations: tools,
      };

      const generativeModel = genAI.getGenerativeModel({ 
        model: model || "gemini-2.0-flash-exp",
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

      const result = await chat.sendMessage(prompt);
      const response = result.response;
      
      // Function Callingの処理
      const functionCalls = response.functionCalls();
      
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        const { name, args } = call;
        
        let toolResult;
        try {
          switch (name) {
            case "create_file":
              toolResult = await createFile(args.path, args.content);
              break;
            case "update_file":
              toolResult = await updateFile(args.path, args.content);
              break;
            case "delete_file":
              toolResult = await deleteFile(args.path);
              break;
            case "create_folder":
              toolResult = await createFolder(args.path);
              break;
            case "list_files":
              toolResult = await listFiles();
              break;
            default:
              toolResult = { error: "Unknown tool" };
          }
        } catch (e: any) {
          toolResult = { error: e.message };
        }

        // ツール実行結果をAIに返す
        const result2 = await chat.sendMessage([
          {
            functionResponse: {
              name: name,
              response: { result: toolResult },
            },
          },
        ]);
        
        return NextResponse.json({ content: result2.response.text() });
      }

      return NextResponse.json({ content: response.text() });
    }

  } catch (error: any) {
    console.error("AI API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

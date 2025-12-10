import { NextRequest, NextResponse } from "next/server";
import { createFile, updateFile, deleteFile, createFolder, listFiles } from "@/lib/tools/file-operations";

// ツール定義
const tools = [
  {
    name: "create_file",
    description: "Create a new file. You can specify a full path (e.g., 'components/ui/button.tsx'). Parent folders will be created automatically.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "The path of the file to create (e.g., 'lib/utils.ts').",
        },
        content: {
          type: "STRING",
          description: "The initial content of the file.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "update_file",
    description: "Update the content of an existing file. Specify the full path.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "The path of the file to update.",
        },
        content: {
          type: "STRING",
          description: "The new content of the file.",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file or folder by path.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "The path of the node to delete.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_folder",
    description: "Create a new folder recursively.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "The path of the folder to create (e.g., 'components/hooks').",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_files",
    description: "List all files and folders in the project with their paths.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { prompt, fileText } = body as {
    prompt: string;
    fileText: string;
  };

  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY missing" },
      { status: 500 }
    );
  }

  try {
    // 1. 初回のリクエスト
    const initialPayload = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `あなたは優秀なソフトウェアエンジニアです。以下の指示に従って作業してください。
ファイルシステムを操作するツールを持っています。パス指定（例: 'src/components/Button.tsx'）でファイルを操作できます。
フォルダは自動的に作成されます。

現在のファイルの内容（参考）:
\`\`\`
${fileText}
\`\`\`

ユーザーの指示:
${prompt}`,
            },
          ],
        },
      ],
      tools: [
        {
          function_declarations: tools,
        },
      ],
      generationConfig: {
        temperature: 0.7,
      },
    };

    let res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initialPayload),
      }
    );

    let data = await res.json();
    let content = data.candidates?.[0]?.content;
    
    // ツール呼び出しがあるか確認
    const functionCall = content?.parts?.find((part: any) => part.functionCall);

    if (functionCall) {
      const { name, args } = functionCall.functionCall;
      let toolResult;

      console.log(`Executing tool: ${name}`, args);

      try {
        switch (name) {
          case "create_file":
            const createRes = await createFile(args.name, args.content || "");
            toolResult = { result: `Successfully created file: ${createRes.fileName}` };
            break;
          case "update_file":
            const updateRes = await updateFile(args.name, args.content);
            toolResult = { result: `Successfully updated file: ${updateRes.fileName}` };
            break;
          case "delete_file":
            const deleteRes = await deleteFile(args.name);
            toolResult = { result: `Successfully deleted: ${deleteRes.fileName}` };
            break;
          case "create_folder":
            const folderRes = await createFolder(args.name);
            toolResult = { result: `Successfully created folder: ${folderRes.folderName}` };
            break;
          case "list_files":
            const files = await listFiles();
            // パス一覧だけを返す（トークン節約）
            toolResult = { files: files.map((f: any) => f.path) };
            break;
          default:
            toolResult = { error: "Unknown tool" };
        }
      } catch (e: any) {
        console.error("Tool execution error:", e);
        toolResult = { error: e.message };
      }

      // 2. ツール実行結果をGeminiに返す
      const secondPayload = {
        contents: [
          {
            role: "user",
            parts: initialPayload.contents[0].parts,
          },
          {
            role: "model",
            parts: content.parts, 
          },
          {
            role: "function",
            parts: [
              {
                functionResponse: {
                  name: name,
                  response: {
                    content: toolResult,
                  },
                },
              },
            ],
          },
        ],
        tools: [
          {
            function_declarations: tools,
          },
        ],
      };

      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(secondPayload),
        }
      );

      data = await res.json();
      content = data.candidates?.[0]?.content;
    }

    const text = content?.parts?.[0]?.text ?? "";
    return NextResponse.json({ content: text });

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return NextResponse.json(
      { error: "Failed to call Gemini API" },
      { status: 500 }
    );
  }
}

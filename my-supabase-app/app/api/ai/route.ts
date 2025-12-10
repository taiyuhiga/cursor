import { NextRequest, NextResponse } from "next/server";
import { createFile, listFiles } from "@/lib/tools/file-operations";

// ツール定義
const tools = [
  {
    name: "create_file",
    description: "Create a new file with the given name and content.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "The name of the file to create (e.g., 'example.ts').",
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
    name: "list_files",
    description: "List all files in the current project.",
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
    // 1. 初回のリクエスト（ツール定義付き）
    const initialPayload = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `あなたは優秀なソフトウェアエンジニアです。以下の指示に従って作業してください。
必要に応じてファイルを作成したり、ファイル一覧を確認したりするツールを使用してください。

現在のファイルの内容:
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

      // ツール実行
      if (name === "create_file") {
        console.log(`Executing tool: create_file`, args);
        try {
          const result = await createFile(args.name, args.content || "");
          toolResult = { result: `Successfully created file: ${result.fileName}` };
        } catch (e: any) {
          toolResult = { error: e.message };
        }
      } else if (name === "list_files") {
        console.log(`Executing tool: list_files`);
        try {
          const files = await listFiles();
          toolResult = { files: files.map((f: any) => f.name) };
        } catch (e: any) {
          toolResult = { error: e.message };
        }
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
            parts: content.parts, // functionCallを含む前の応答
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

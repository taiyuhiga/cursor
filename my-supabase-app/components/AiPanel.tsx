"use client";

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
};

type Props = {
  currentFileText: string;
  onAppend: (text: string) => void;
  onRequestDiff: (newCode: string) => void;
  onReplace?: (text: string) => void;
  onFileCreated?: () => void;
};

export type AiPanelHandle = {
  triggerAction: (action: "explain" | "fix" | "test" | "refactor") => void;
};

export const AiPanel = forwardRef<AiPanelHandle, Props>(({ currentFileText, onAppend, onRequestDiff, onFileCreated }, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const extractCodeBlock = (text: string): string | null => {
    const match = text.match(/```[\w]*\n([\s\S]*?)```/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  };

  const onSubmit = async (customPrompt?: string) => {
    const promptToSend = customPrompt || prompt;
    if (!promptToSend.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: promptToSend,
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!customPrompt) setPrompt("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          prompt: userMessage.content,
          fileText: currentFileText,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();
      
      if (data.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: `Error: ${data.error}`,
            isError: true,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: data.content,
          },
        ]);
        
        // ファイル操作が行われた可能性があるキーワードが含まれていればリフレッシュ
        const lowerContent = data.content.toLowerCase();
        if (
          lowerContent.includes("created") || 
          lowerContent.includes("updated") || 
          lowerContent.includes("deleted") ||
          lowerContent.includes("作成") ||
          lowerContent.includes("更新") ||
          lowerContent.includes("削除")
        ) {
          onFileCreated?.();
        }
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: `Error: ${error}`,
          isError: true,
        },
      ]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  const triggerAction = (action: "explain" | "fix" | "test" | "refactor") => {
    const prompts = {
      explain: "このコードの機能を詳しく説明してください。",
      fix: "このコードにある潜在的なバグやエラーを修正してください。修正後のコード全体を提示してください。",
      test: "このコードのテストケースを作成してください。",
      refactor: "このコードをリファクタリングしてください。修正後のコード全体を提示してください。",
    };
    onSubmit(prompts[action]);
  };

  useImperativeHandle(ref, () => ({
    triggerAction
  }));

  return (
    <div className="flex flex-col h-full bg-zinc-50 text-zinc-700">
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-200">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          AI Chat
        </h2>
        <button
          onClick={() => setMessages([])}
          className="text-xs text-zinc-500 hover:text-zinc-700"
          title="Clear Chat"
        >
          Clear
        </button>
      </div>

      {/* チャット履歴 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && (
          <div className="text-center text-zinc-400 mt-10 text-sm">
            <p>AI Assistant</p>
            <p className="text-xs mt-2 opacity-60">
              Ask questions about your code or request changes.
            </p>
          </div>
        )}
        
        {messages.map((msg) => {
          const codeBlock = msg.role === "assistant" ? extractCodeBlock(msg.content) : null;
          
          return (
            <div key={msg.id} className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`text-xs text-zinc-500 ${msg.role === "user" ? "mr-1" : "ml-1"}`}>
                {msg.role === "user" ? "You" : "AI"}
              </div>
              
              <div
                className={`
                  max-w-[95%] rounded-lg p-3 text-sm whitespace-pre-wrap border overflow-x-auto
                  ${msg.role === "user" 
                    ? "bg-blue-50 border-blue-200 text-zinc-800" 
                    : "bg-white border-zinc-200 text-zinc-700"
                  }
                  ${msg.isError ? "border-red-300 bg-red-50" : ""}
                `}
              >
                {msg.content}
              </div>

              {/* アシスタントの回答に対するアクションボタン */}
              {msg.role === "assistant" && !msg.isError && codeBlock && (
                <div className="flex gap-2 mt-1 ml-1">
                  <button
                    onClick={() => onRequestDiff(codeBlock)}
                    className="flex items-center gap-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded px-3 py-1.5 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 3h5v5"></path>
                      <path d="M8 3H3v5"></path>
                      <path d="M12 22v-8"></path>
                      <path d="M9 10l3-3 3 3"></path>
                    </svg>
                    Review Changes
                  </button>
                  <button
                    onClick={() => onAppend(codeBlock)}
                    className="text-xs bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 rounded px-3 py-1.5 transition-colors"
                  >
                    Append
                  </button>
                </div>
              )}
            </div>
          );
        })}
        
        {loading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm ml-1">
            <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="p-3 border-t border-zinc-200 bg-zinc-50 flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <button onClick={() => triggerAction("explain")} disabled={loading} className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-full bg-white border border-zinc-300 hover:bg-zinc-100 hover:border-zinc-400 transition-colors whitespace-nowrap">💡 Explain</button>
          <button onClick={() => triggerAction("fix")} disabled={loading} className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-full bg-white border border-zinc-300 hover:bg-zinc-100 hover:border-zinc-400 transition-colors whitespace-nowrap">🛠 Fix</button>
          <button onClick={() => triggerAction("test")} disabled={loading} className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-full bg-white border border-zinc-300 hover:bg-zinc-100 hover:border-zinc-400 transition-colors whitespace-nowrap">🧪 Test</button>
          <button onClick={() => triggerAction("refactor")} disabled={loading} className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-full bg-white border border-zinc-300 hover:bg-zinc-100 hover:border-zinc-400 transition-colors whitespace-nowrap">✨ Refactor</button>
        </div>

        <div className="relative">
          <textarea
            className="w-full bg-white border border-zinc-300 rounded-lg p-3 pr-10 text-sm text-zinc-800 resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all placeholder:text-zinc-400"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI... (Cmd+Enter to send)"
            disabled={loading}
          />
          <button
            onClick={() => onSubmit()}
            disabled={loading || !prompt.trim()}
            className="absolute bottom-3 right-3 p-1.5 text-zinc-400 hover:text-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
        <div className="text-[10px] text-zinc-400 flex justify-between px-1">
          <span>Gemini 2.0 Flash</span>
          <span>Cmd+Enter to send</span>
        </div>
      </div>
    </div>
  );
});

AiPanel.displayName = "AiPanel";

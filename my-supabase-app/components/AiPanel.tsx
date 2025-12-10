"use client";

import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { Icons } from "./Icons";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
};

type ModelConfig = {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "google";
  enabled: boolean;
};

type FileNode = {
  id: string;
  name: string;
  type: "file" | "folder";
  parent_id: string | null;
};

type Props = {
  currentFileText: string;
  onAppend: (text: string) => void;
  onRequestDiff: (newCode: string) => void;
  onReplace?: (text: string) => void;
  onFileCreated?: () => void;
  nodes: FileNode[];
  onGetFileContent: (nodeId: string) => Promise<string>;
};

export type AiPanelHandle = {
  triggerAction: (action: "explain" | "fix" | "test" | "refactor") => void;
};

const DEFAULT_MODELS: ModelConfig[] = [
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", provider: "google", enabled: true },
  { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", provider: "anthropic", enabled: true },
  { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", provider: "anthropic", enabled: true },
  { id: "gpt-5.1", name: "GPT-5.1", provider: "openai", enabled: true },
  { id: "gpt-5", name: "GPT-5", provider: "openai", enabled: true },
  { id: "gpt-5-pro", name: "GPT-5 Pro", provider: "openai", enabled: true },
];

export const AiPanel = forwardRef<AiPanelHandle, Props>(({ currentFileText, onAppend, onRequestDiff, onFileCreated, nodes, onGetFileContent }, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3-pro-preview");
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>(DEFAULT_MODELS);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // @Files popup state
  const [showFilesPopup, setShowFilesPopup] = useState(false);
  const [filesSearchQuery, setFilesSearchQuery] = useState("");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState<number | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const filesPopupRef = useRef<HTMLDivElement>(null);

  // Get only files (not folders) for suggestions
  const fileNodes = nodes.filter(n => n.type === "file");
  
  // Filter files based on search query
  const filteredFiles = filesSearchQuery
    ? fileNodes.filter(f => f.name.toLowerCase().includes(filesSearchQuery.toLowerCase()))
    : fileNodes;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load models from localStorage
  useEffect(() => {
    const loadModels = () => {
      const savedModels = localStorage.getItem("cursor_models");
      if (savedModels) {
        const parsed = JSON.parse(savedModels) as ModelConfig[];
        const enabled = parsed.filter(m => m.enabled);
        setAvailableModels(enabled.length > 0 ? enabled : DEFAULT_MODELS);
        
        if (enabled.length > 0 && !enabled.find(m => m.id === selectedModel)) {
          setSelectedModel(enabled[0].id);
        }
      } else {
        setAvailableModels(DEFAULT_MODELS.filter(m => m.enabled));
      }
    };
    
    loadModels();
    window.addEventListener("storage", loadModels);
    return () => window.removeEventListener("storage", loadModels);
  }, [selectedModel]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
      if (filesPopupRef.current && !filesPopupRef.current.contains(event.target as Node)) {
        setShowFilesPopup(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset selected index when filtered files change
  useEffect(() => {
    setSelectedFileIndex(0);
  }, [filteredFiles.length]);

  const extractCodeBlock = (text: string): string | null => {
    const match = text.match(/```[\w]*\n([\s\S]*?)```/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  };

  // Extract @filename references from prompt and get their contents
  const buildContextFromMentions = useCallback(async (promptText: string): Promise<string> => {
    const mentionRegex = /@([^\s@]+)/g;
    const mentions: string[] = [];
    let match;
    
    while ((match = mentionRegex.exec(promptText)) !== null) {
      mentions.push(match[1]);
    }
    
    if (mentions.length === 0) return "";
    
    const contextParts: string[] = [];
    
    for (const mention of mentions) {
      const file = fileNodes.find(f => f.name === mention);
      if (file) {
        try {
          const content = await onGetFileContent(file.id);
          contextParts.push(`--- File: ${file.name} ---\n${content}\n---`);
        } catch (e) {
          console.error(`Failed to get content for ${mention}:`, e);
        }
      }
    }
    
    return contextParts.length > 0 
      ? `\n\n[Referenced Files Context]\n${contextParts.join("\n\n")}\n\n`
      : "";
  }, [fileNodes, onGetFileContent]);

  const onSubmit = async (customPrompt?: string) => {
    const promptToSend = customPrompt || prompt;
    if (!promptToSend.trim() || loading) return;

    // Build context from @mentions
    const fileContext = await buildContextFromMentions(promptToSend);
    const fullPrompt = fileContext + promptToSend;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: promptToSend,
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!customPrompt) setPrompt("");
    setLoading(true);

    const apiKeys = JSON.parse(localStorage.getItem("cursor_api_keys") || "{}");

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          prompt: fullPrompt,
          fileText: currentFileText,
          model: selectedModel,
          apiKeys,
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

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    setPrompt(value);
    
    // Detect @ and show popup
    const textBeforeCursor = value.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      // Check if there's no space after @ (still typing filename)
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        setShowFilesPopup(true);
        setFilesSearchQuery(textAfterAt);
        setAtSymbolPosition(lastAtIndex);
        return;
      }
    }
    
    setShowFilesPopup(false);
    setFilesSearchQuery("");
    setAtSymbolPosition(null);
  };

  const insertFileReference = (fileName: string) => {
    if (atSymbolPosition === null) return;
    
    const beforeAt = prompt.substring(0, atSymbolPosition);
    const afterCursor = prompt.substring(atSymbolPosition + 1 + filesSearchQuery.length);
    
    const newPrompt = `${beforeAt}@${fileName} ${afterCursor}`;
    setPrompt(newPrompt);
    setShowFilesPopup(false);
    setFilesSearchQuery("");
    setAtSymbolPosition(null);
    
    // Focus textarea
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursorPos = beforeAt.length + fileName.length + 2;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle popup navigation
    if (showFilesPopup && filteredFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedFileIndex((prev) => (prev + 1) % filteredFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedFileIndex((prev) => (prev - 1 + filteredFiles.length) % filteredFiles.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertFileReference(filteredFiles[selectedFileIndex].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowFilesPopup(false);
        return;
      }
    }
    
    // Submit on Cmd+Enter
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

  const currentModelName = availableModels.find(m => m.id === selectedModel)?.name || selectedModel;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const fileName = e.dataTransfer.getData("application/cursor-node");
    if (fileName) {
      setPrompt((prev) => {
        const prefix = prev.trim().length > 0 ? " " : "";
        return `${prev}${prefix}@${fileName} `;
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-zinc-800 border-l border-zinc-200">
      {/* ヘッダー */}
      <div className="flex items-center px-4 py-2 border-b border-zinc-200 bg-zinc-50/50">
        <div className="text-xs font-medium text-zinc-600 bg-zinc-200/50 px-3 py-1 rounded-md cursor-default">
          Chat
        </div>
        <div className="ml-auto flex items-center gap-2">
           <button
            onClick={() => setMessages([])}
            className="p-1 hover:bg-zinc-200 rounded text-zinc-500 transition-colors"
            title="Clear Chat"
          >
            <Icons.Trash className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* チャット履歴 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 space-y-4">
            <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center">
              <Icons.AI className="w-6 h-6 text-zinc-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-600">Cursor AI</p>
              <p className="text-xs mt-1 opacity-60">
                Type @ to reference files
              </p>
            </div>
          </div>
        )}
        
        {messages.map((msg) => {
          const codeBlock = msg.role === "assistant" ? extractCodeBlock(msg.content) : null;
          
          return (
            <div key={msg.id} className={`group flex flex-col gap-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div className="flex items-center gap-2 px-1">
                <span className={`text-[10px] font-medium uppercase tracking-wider ${msg.role === "user" ? "text-blue-600" : "text-purple-600"}`}>
                  {msg.role === "user" ? "You" : "AI"}
                </span>
              </div>
              
              <div
                className={`
                  relative max-w-full text-sm whitespace-pre-wrap leading-relaxed
                  ${msg.role === "user" 
                    ? "text-zinc-800 bg-transparent px-1" 
                    : "text-zinc-800 w-full"
                  }
                  ${msg.isError ? "text-red-600" : ""}
                `}
              >
                {msg.role === "user" ? (
                  <div className="bg-zinc-100 px-3 py-2 rounded-lg inline-block">
                    {msg.content.split(/(@[^\s@]+)/g).map((part, i) => 
                      part.startsWith("@") 
                        ? <span key={i} className="text-blue-600 font-medium">{part}</span>
                        : part
                    )}
                  </div>
                ) : (
                  <>
                    {msg.content}
                    {codeBlock && !msg.isError && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => onRequestDiff(codeBlock)}
                          className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded-md px-3 py-1.5 transition-colors"
                        >
                          Review Changes
                        </button>
                        <button
                          onClick={() => onAppend(codeBlock)}
                          className="text-xs font-medium bg-zinc-50 hover:bg-zinc-100 text-zinc-600 border border-zinc-200 rounded-md px-3 py-1.5 transition-colors"
                        >
                          Append
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        
        {loading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm px-1 py-2">
             <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
             <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
             <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="p-4 bg-white border-t border-zinc-200">
        <div 
          className={`relative flex flex-col border rounded-xl shadow-sm bg-white transition-all ${
            isDragging ? "border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/10" : "border-zinc-200 focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* @Files Popup */}
          {showFilesPopup && filteredFiles.length > 0 && (
            <div 
              ref={filesPopupRef}
              className="absolute bottom-full left-2 mb-2 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-48 overflow-y-auto py-1 animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-50 border-b border-zinc-100 flex items-center gap-2">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Files
              </div>
              {filteredFiles.map((file, index) => (
                <button
                  key={file.id}
                  onClick={() => insertFileReference(file.name)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                    index === selectedFileIndex 
                      ? "bg-blue-50 text-blue-700" 
                      : "text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  <svg className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span className="truncate">{file.name}</span>
                </button>
              ))}
            </div>
          )}

          {showFilesPopup && filteredFiles.length === 0 && filesSearchQuery && (
            <div 
              ref={filesPopupRef}
              className="absolute bottom-full left-2 mb-2 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden py-3 px-4 animate-in fade-in zoom-in-95 duration-100"
            >
              <p className="text-xs text-zinc-500">No files matching "{filesSearchQuery}"</p>
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="w-full max-h-60 bg-transparent p-3 text-sm text-zinc-800 resize-none focus:outline-none placeholder:text-zinc-400 min-h-[80px] rounded-t-xl"
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI... (@ to reference files)"
            disabled={loading}
          />
          
          {/* Toolbar */}
          <div className="flex items-center justify-between px-2 py-2 bg-zinc-50/50 border-t border-zinc-100 rounded-b-xl">
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50 rounded px-2 py-1 transition-colors"
              >
                <span>{currentModelName}</span>
                <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              
              {isModelDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-60 overflow-y-auto py-1 animate-in fade-in zoom-in-95 duration-100 origin-bottom-left">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-50 border-b border-zinc-100">Select Model</div>
                  {availableModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setSelectedModel(model.id);
                        setIsModelDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 flex items-center justify-between ${selectedModel === model.id ? "bg-blue-50 text-blue-700" : "text-zinc-700"}`}
                    >
                      <span>{model.name}</span>
                      {selectedModel === model.id && <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onSubmit()}
                disabled={loading || !prompt.trim()}
                className={`p-1.5 rounded-md transition-all ${
                  !prompt.trim() 
                    ? "text-zinc-300 cursor-not-allowed" 
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
         <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 pb-1">
          <button onClick={() => triggerAction("explain")} disabled={loading} className="flex-shrink-0 text-[10px] font-medium px-2.5 py-1.5 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors whitespace-nowrap">Explain</button>
          <button onClick={() => triggerAction("fix")} disabled={loading} className="flex-shrink-0 text-[10px] font-medium px-2.5 py-1.5 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors whitespace-nowrap">Fix</button>
          <button onClick={() => triggerAction("test")} disabled={loading} className="flex-shrink-0 text-[10px] font-medium px-2.5 py-1.5 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors whitespace-nowrap">Test</button>
          <button onClick={() => triggerAction("refactor")} disabled={loading} className="flex-shrink-0 text-[10px] font-medium px-2.5 py-1.5 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors whitespace-nowrap">Refactor</button>
        </div>
      </div>
    </div>
  );
});

AiPanel.displayName = "AiPanel";

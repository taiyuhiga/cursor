"use client";

import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { Icons } from "./Icons";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  created_at?: string;
};

type ChatSession = {
  id: string;
  title: string;
  created_at: string;
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
  projectId: string;
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

export const AiPanel = forwardRef<AiPanelHandle, Props>(({ projectId, currentFileText, onAppend, onRequestDiff, onFileCreated, nodes, onGetFileContent }, ref) => {
  const supabase = createClient();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

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

  // Load models
  useEffect(() => {
    const savedModels = localStorage.getItem("cursor_models");
    if (savedModels) {
      const parsed = JSON.parse(savedModels) as ModelConfig[];
      const enabled = parsed.filter(m => m.enabled);
      setAvailableModels(enabled.length > 0 ? enabled : DEFAULT_MODELS);
      if (enabled.length > 0 && !enabled.find(m => m.id === selectedModel)) {
        setSelectedModel(enabled[0].id);
      }
    }
  }, []);

  // Fetch chat sessions
  const fetchSessions = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setSessions(data);
    }
  }, [projectId, supabase]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Load messages for current session
  useEffect(() => {
    async function loadMessages() {
      if (!currentSessionId) {
        setMessages([]);
        return;
      }
      
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", currentSessionId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        setMessages(data.map(m => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          created_at: m.created_at
        })));
      }
    }
    loadMessages();
  }, [currentSessionId, supabase]);

  const createNewSession = async (firstMessage: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const title = firstMessage.slice(0, 30) + (firstMessage.length > 30 ? "..." : "");
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({
        user_id: user.id,
        project_id: projectId,
        title,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating session:", error);
      return null;
    }

    setSessions(prev => [data, ...prev]);
    setCurrentSessionId(data.id);
    return data.id;
  };

  const saveMessage = async (sessionId: string, role: "user" | "assistant", content: string) => {
    await supabase.from("chat_messages").insert({
      session_id: sessionId,
      role,
      content,
    });
  };

  // --- Core AI Logic (same as before but with persistence) ---
  
  const fileNodes = nodes.filter(n => n.type === "file");
  const filteredFiles = filesSearchQuery
    ? fileNodes.filter(f => f.name.toLowerCase().includes(filesSearchQuery.toLowerCase()))
    : fileNodes;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Click outside handlers
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

  const extractCodeBlock = (text: string): string | null => {
    const match = text.match(/```[\w]*\n([\s\S]*?)```/);
    return match ? match[1] : null;
  };

  const buildContextFromMentions = useCallback(async (promptText: string): Promise<string> => {
    const mentionRegex = /@([^\s@]+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(promptText)) !== null) mentions.push(match[1]);
    
    if (mentions.length === 0) return "";
    
    const contextParts: string[] = [];
    for (const mention of mentions) {
      const file = fileNodes.find(f => f.name === mention);
      if (file) {
        try {
          const content = await onGetFileContent(file.id);
          contextParts.push(`--- File: ${file.name} ---\n${content}\n---`);
        } catch (e) { console.error(e); }
      }
    }
    return contextParts.length > 0 ? `\n\n[Referenced Files Context]\n${contextParts.join("\n\n")}\n\n` : "";
  }, [fileNodes, onGetFileContent]);

  const onSubmit = async (customPrompt?: string) => {
    const promptToSend = customPrompt || prompt;
    if (!promptToSend.trim() || loading) return;

    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      activeSessionId = await createNewSession(promptToSend);
      if (!activeSessionId) return; // Error handling
    }

    // Optimistic update
    const tempId = Date.now().toString();
    setMessages(prev => [...prev, { id: tempId, role: "user", content: promptToSend }]);
    if (!customPrompt) setPrompt("");
    setLoading(true);

    // Save user message
    await saveMessage(activeSessionId, "user", promptToSend);

    // Build context
    const fileContext = await buildContextFromMentions(promptToSend);
    const fullPrompt = fileContext + promptToSend;
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
        setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: `Error: ${data.error}`, isError: true }]);
      } else {
        const assistantMsg = data.content;
        setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: assistantMsg }]);
        await saveMessage(activeSessionId, "assistant", assistantMsg);

        // Check for side effects
        const lower = assistantMsg.toLowerCase();
        if (lower.includes("created") || lower.includes("updated") || lower.includes("deleted") || lower.includes("作成")) {
          onFileCreated?.();
        }
      }
    } catch (error) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: `Error: ${error}`, isError: true }]);
    }
    setLoading(false);
  };

  // --- Input Handlers ---
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setPrompt(value);
    
    const textBeforeCursor = value.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
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
    setPrompt(`${beforeAt}@${fileName} ${afterCursor}`);
    setShowFilesPopup(false);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = beforeAt.length + fileName.length + 2;
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showFilesPopup && filteredFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedFileIndex(prev => (prev + 1) % filteredFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedFileIndex(prev => (prev - 1 + filteredFiles.length) % filteredFiles.length);
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
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  const triggerAction = (action: "explain" | "fix" | "test" | "refactor") => {
    const prompts = {
      explain: "このコードの機能を詳しく説明してください。",
      fix: "このコードにある潜在的なバグやエラーを修正してください。",
      test: "このコードのテストケースを作成してください。",
      refactor: "このコードをリファクタリングしてください。",
    };
    onSubmit(prompts[action]);
  };

  useImperativeHandle(ref, () => ({ triggerAction }));

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
      setPrompt(prev => {
        const prefix = prev.trim().length > 0 ? " " : "";
        return `${prev}${prefix}@${fileName} `;
      });
    }
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setShowHistory(false);
    setPrompt("");
    if (textareaRef.current) textareaRef.current.focus();
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const { error } = await supabase.from("chat_sessions").delete().eq("id", id);
    if (!error) {
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) handleNewChat();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-zinc-800 relative">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1.5 rounded-md hover:bg-zinc-200 text-zinc-600 transition-colors ${showHistory ? "bg-zinc-200 text-zinc-900" : ""}`}
            title="Previous Chats"
          >
            <Icons.History className="w-4 h-4" />
          </button>
          <span className="text-xs font-medium text-zinc-500">AI Chat</span>
        </div>
        <button
          onClick={handleNewChat}
          className="p-1.5 rounded-md hover:bg-zinc-200 text-zinc-600 transition-colors"
          title="New Chat"
        >
          <Icons.Plus className="w-4 h-4" />
        </button>
      </div>

      {/* History Sidebar/Overlay */}
      {showHistory && (
        <div className="absolute top-[41px] left-0 bottom-0 w-64 bg-zinc-50 border-r border-zinc-200 z-20 overflow-y-auto shadow-lg animate-in slide-in-from-left-2 duration-200">
          <div className="p-2 space-y-1">
            <h3 className="px-2 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Previous Chats</h3>
            {sessions.map(session => (
              <div
                key={session.id}
                onClick={() => {
                  setCurrentSessionId(session.id);
                  setShowHistory(false);
                }}
                className={`group flex items-center justify-between px-2 py-2 rounded-md cursor-pointer text-xs ${
                  currentSessionId === session.id ? "bg-white shadow-sm text-zinc-900" : "text-zinc-600 hover:bg-zinc-200/50"
                }`}
              >
                <div className="flex flex-col truncate min-w-0">
                  <span className="truncate font-medium">{session.title}</span>
                  <span className="text-[10px] text-zinc-400">{formatDistanceToNow(new Date(session.created_at), { addSuffix: true })}</span>
                </div>
                <button
                  onClick={(e) => handleDeleteSession(e, session.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-red-500 transition-all"
                >
                  <Icons.Trash className="w-3 h-3" />
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-zinc-400">No past chats</div>
            )}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-white pb-32">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 space-y-4 mt-20">
            <div className="w-12 h-12 bg-zinc-50 rounded-xl flex items-center justify-center border border-zinc-100 shadow-sm">
              <Icons.AI className="w-6 h-6 text-zinc-300" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-600">Cursor AI</p>
              <p className="text-xs mt-1 text-zinc-400">
                Type <kbd className="font-mono bg-zinc-100 px-1 rounded text-zinc-500">@</kbd> to add context
              </p>
            </div>
          </div>
        )}
        
        {messages.map((msg) => {
          const codeBlock = msg.role === "assistant" ? extractCodeBlock(msg.content) : null;
          return (
            <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
              {msg.role === "assistant" && (
                <div className="flex items-center gap-2 mb-1 px-1">
                  <div className="w-4 h-4 rounded-full bg-purple-100 flex items-center justify-center text-[8px] text-purple-600 font-bold border border-purple-200">AI</div>
                  <span className="text-[10px] font-medium text-zinc-400 uppercase">Assistant</span>
                </div>
              )}
              
              <div className={`relative max-w-full text-sm leading-relaxed ${
                msg.role === "user" 
                  ? "bg-zinc-100 px-3 py-2 rounded-2xl rounded-tr-sm text-zinc-800 border border-zinc-200/50" 
                  : "text-zinc-800 w-full pl-1"
              } ${msg.isError ? "text-red-600" : ""}`}>
                
                {msg.role === "user" ? (
                  <div>
                     {msg.content.split(/(@[^\s@]+)/g).map((part, i) => 
                      part.startsWith("@") 
                        ? <span key={i} className="text-blue-600 bg-blue-50 px-1 rounded mx-0.5 font-medium border border-blue-100">{part}</span>
                        : part
                    )}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">
                    {msg.content}
                    {codeBlock && !msg.isError && (
                      <div className="flex gap-2 mt-3 mb-1">
                        <button onClick={() => onRequestDiff(codeBlock)} className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded px-2 py-1 transition-colors">Apply</button>
                        <button onClick={() => onAppend(codeBlock)} className="text-xs font-medium bg-zinc-50 hover:bg-zinc-100 text-zinc-600 border border-zinc-200 rounded px-2 py-1 transition-colors">Append</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm px-1 py-2">
             <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-0" />
             <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-150" />
             <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-300" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Input Area */}
      <div className="absolute bottom-4 left-4 right-4 z-30">
        <div 
          className={`relative flex flex-col bg-white border shadow-lg rounded-xl transition-all ${
            isDragging ? "border-blue-500 ring-4 ring-blue-500/10" : "border-zinc-200 focus-within:border-zinc-300 focus-within:shadow-xl"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* @Files Popup */}
          {showFilesPopup && filteredFiles.length > 0 && (
            <div ref={filesPopupRef} className="absolute bottom-full left-0 mb-2 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-48 overflow-y-auto py-1 animate-in fade-in slide-in-from-bottom-2 duration-100">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-50 border-b border-zinc-100">Files</div>
              {filteredFiles.map((file, index) => (
                <button
                  key={file.id}
                  onClick={() => insertFileReference(file.name)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${index === selectedFileIndex ? "bg-blue-50 text-blue-700" : "text-zinc-700 hover:bg-zinc-50"}`}
                >
                  <Icons.File className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="truncate">{file.name}</span>
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="w-full max-h-60 bg-transparent px-4 py-3 text-sm text-zinc-800 resize-none focus:outline-none placeholder:text-zinc-400 min-h-[44px] rounded-t-xl"
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleKeyDown}
            placeholder="Plan, @ for context, / for commands"
            rows={1}
            style={{ minHeight: "44px" }}
            disabled={loading}
          />
          
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-zinc-100 bg-zinc-50/30 rounded-b-xl">
             <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded px-2 py-1 transition-colors"
              >
                <span>{currentModelName}</span>
                <Icons.ChevronDown className="w-3 h-3 opacity-50" />
              </button>
              
              {isModelDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-60 overflow-y-auto py-1">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-50 border-b border-zinc-100">Select Model</div>
                  {availableModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => { setSelectedModel(model.id); setIsModelDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 flex items-center justify-between ${selectedModel === model.id ? "bg-blue-50 text-blue-700" : "text-zinc-700"}`}
                    >
                      <span>{model.name}</span>
                      {selectedModel === model.id && <Icons.Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => onSubmit()}
              disabled={loading || !prompt.trim()}
              className={`p-1.5 rounded-md transition-all ${!prompt.trim() ? "text-zinc-300" : "bg-black text-white hover:bg-zinc-800 shadow-sm"}`}
            >
              <Icons.ArrowUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        
        {/* Footer info */}
        <div className="text-[10px] text-zinc-400 text-center mt-2 flex justify-center gap-3">
          <span>Cmd+K to generate</span>
          <span>Cmd+L to chat</span>
        </div>
      </div>
    </div>
  );
});

AiPanel.displayName = "AiPanel";

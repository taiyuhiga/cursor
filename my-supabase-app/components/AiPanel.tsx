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
  { id: "claude-opus-4-5-20251101", name: "Opus 4.5", provider: "anthropic", enabled: true },
  { id: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5", provider: "anthropic", enabled: true },
  { id: "gpt-5.1", name: "GPT-5.1", provider: "openai", enabled: true },
  { id: "gpt-5", name: "GPT-5", provider: "openai", enabled: true },
  { id: "gpt-5-pro", name: "GPT-5 Pro", provider: "openai", enabled: true },
];

export const AiPanel = forwardRef<AiPanelHandle, Props>(({ projectId, currentFileText, onAppend, onRequestDiff, onFileCreated, nodes, onGetFileContent }, ref) => {
  const supabase = createClient();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  // Tab Management
  const [openTabs, setOpenTabs] = useState<ChatSession[]>([]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3-pro-preview");
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>(DEFAULT_MODELS);
  const [mode, setMode] = useState<"agent" | "plan" | "ask">("agent");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [isPastChatsExpanded, setIsPastChatsExpanded] = useState(true);
  
  // "Thought" section state (mock)
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  // @Files popup state
  const [showFilesPopup, setShowFilesPopup] = useState(false);
  const [filesSearchQuery, setFilesSearchQuery] = useState("");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState<number | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const filesPopupRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

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
      // Initialize tabs: open current one or new chat
      if (data.length > 0 && openTabs.length === 0) {
        // Just for demo, maybe don't open any or open the most recent
        // setOpenTabs([data[0]]);
        // setCurrentSessionId(data[0].id);
      }
    }
  }, [projectId, supabase, openTabs.length]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 初回マウント時に New Chat を自動で開く
  useEffect(() => {
    if (openTabs.length === 0 && !currentSessionId) {
      const newTabId = `new-${Date.now()}`;
      const newTab: ChatSession = {
        id: newTabId,
        title: "New Chat",
        created_at: new Date().toISOString(),
      };
      setOpenTabs([newTab]);
      setCurrentSessionId(newTabId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load messages for current session
  useEffect(() => {
    async function loadMessages() {
      // 一時的なタブID（new-で始まる）またはnullの場合はメッセージをクリア
      if (!currentSessionId || currentSessionId.startsWith("new-")) {
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

  const createNewSession = async (firstMessage: string, tempTabId?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const title = firstMessage.slice(0, 20) + (firstMessage.length > 20 ? "..." : "");
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
    
    // 一時的なタブを実際のセッションに置き換え
    if (tempTabId) {
      setOpenTabs(prev => prev.map(t => t.id === tempTabId ? data : t));
    } else {
      setOpenTabs(prev => [...prev, data]);
    }
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

  // --- Core AI Logic ---
  
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
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(event.target as Node)) {
        setIsAgentDropdownOpen(false);
      }
      if (filesPopupRef.current && !filesPopupRef.current.contains(event.target as Node)) {
        setShowFilesPopup(false);
      }
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setShowHistoryDropdown(false);
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

  const handleStop = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setLoading(false);
  };

  const onSubmit = async (customPrompt?: string) => {
    const promptToSend = customPrompt || prompt;
    if (!promptToSend.trim() || loading) return;

    let activeSessionId = currentSessionId;
    
    // 一時的なタブID（new-で始まる）の場合は新しいセッションを作成
    if (!activeSessionId || activeSessionId.startsWith("new-")) {
      const tempTabId = activeSessionId; // 一時的なタブIDを保存
      activeSessionId = await createNewSession(promptToSend, tempTabId || undefined);
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

    // Initialize AbortController
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          prompt: fullPrompt,
          fileText: currentFileText,
          model: selectedModel,
          mode,
          apiKeys,
        }),
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current.signal,
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
    } catch (error: any) {
      if (error.name === 'AbortError') {
          // Stopped by user, do nothing or add a "Stopped" message if desired
      } else {
          setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: `Error: ${error}`, isError: true }]);
      }
    } finally {
        setLoading(false);
        abortControllerRef.current = null;
    }
  };

  // --- Input Handlers ---
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setPrompt(value);
    
    // Resize textarea
    if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }

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
    
    // Enter単独で送信（Shift+Enterで改行、IME変換中は除外）
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        onSubmit();
        return;
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
    // 新しいNew Chatタブを作成
    const newTabId = `new-${Date.now()}`;
    const newTab: ChatSession = {
      id: newTabId,
      title: "New Chat",
      created_at: new Date().toISOString(),
    };
    setOpenTabs(prev => [...prev, newTab]);
    setCurrentSessionId(newTabId);
    setMessages([]);
    setPrompt("");
    
    // タブバーを右端までスクロール
    setTimeout(() => {
      if (tabsContainerRef.current) {
        tabsContainerRef.current.scrollLeft = tabsContainerRef.current.scrollWidth;
      }
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = "auto";
      }
    }, 0);
  };

  const toggleThought = (msgId: string) => {
    setExpandedThoughts(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const openSession = (session: ChatSession) => {
      if (!openTabs.find(t => t.id === session.id)) {
          setOpenTabs(prev => [...prev, session]);
      }
      setCurrentSessionId(session.id);
      setShowHistoryDropdown(false);
  };

  const closeTab = (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      const newTabs = openTabs.filter(t => t.id !== sessionId);
      setOpenTabs(newTabs);
      
      if (currentSessionId === sessionId) {
          if (newTabs.length > 0) {
              // 残りのタブの最後を選択
              setCurrentSessionId(newTabs[newTabs.length - 1].id);
          } else {
              // タブがなくなったら新しいNew Chatを開く
              handleNewChat();
          }
      }
  }

  const getModeStyles = (m: "agent" | "plan" | "ask") => {
    switch (m) {
      case "plan": return "bg-[#FFF8E6] text-[#B95D00] hover:bg-[#FFF4D6] border-transparent";
      case "ask": return "bg-[#E8F5E9] text-[#2F8132] hover:bg-[#DFF0E0] border-transparent";
      default: return "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 border-transparent";
    }
  };

  const getSubmitButtonStyles = (m: "agent" | "plan" | "ask", hasText: boolean) => {
      if (!hasText) return "text-zinc-300";
      
      switch (m) {
          case "ask": return "bg-[#2F8132] text-white hover:bg-[#266A29] shadow-sm"; // Green
          case "plan": return "bg-[#B95D00] text-white hover:bg-[#A05300] shadow-sm"; // Brown/Orange
          default: return "bg-black text-white hover:bg-zinc-800 shadow-sm"; // Black
      }
  };

  const getModeIcon = (m: "agent" | "plan" | "ask", className?: string) => {
    switch (m) {
      case "plan": return <Icons.Plan className={className} />;
      case "ask": return <Icons.Ask className={className} />;
      default: return <Icons.Agent className={className} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#f9fafb] text-zinc-900 relative">
      {/* Header Tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0 border-b border-zinc-200 bg-white select-none">
        <div ref={tabsContainerRef} className="flex items-center overflow-x-auto no-scrollbar gap-1 flex-1">
            {openTabs.map(tab => (
                <div 
                    key={tab.id}
                    onClick={() => setCurrentSessionId(tab.id)}
                    className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg border-t border-x text-xs font-medium cursor-pointer min-w-[120px] max-w-[200px] ${
                        currentSessionId === tab.id 
                            ? "bg-[#E8F5E9] border-[#C8E6C9] border-b-transparent -mb-[1px] text-[#2F8132]" 
                            : "bg-zinc-50 border-transparent text-zinc-500 hover:bg-zinc-100"
                    }`}
                >
                    <span className="truncate flex-1">{tab.title}</span>
                    <button 
                        onClick={(e) => closeTab(e, tab.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-zinc-200 text-zinc-400 hover:text-zinc-600"
                    >
                         <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            ))}
        </div>
        
        <div className="flex items-center gap-1 pl-2">
            <button 
                onClick={handleNewChat}
                className="p-1.5 hover:bg-zinc-100 rounded text-zinc-500"
                title="New Chat"
            >
                <Icons.Plus className="w-4 h-4" />
            </button>
            <div className="relative" ref={historyRef}>
                <button 
                    onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
                    className={`p-1.5 hover:bg-zinc-100 rounded text-zinc-500 ${showHistoryDropdown ? "bg-zinc-100 text-zinc-800" : ""}`}
                >
                    <Icons.History className="w-4 h-4" />
                </button>
                {/* History Dropdown */}
                {showHistoryDropdown && (
                    <div className="absolute top-full right-0 mt-1 w-64 bg-white border border-zinc-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                        <div className="p-2">
                            <h3 className="px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase">Recent Chats</h3>
                            {sessions.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => openSession(s)}
                                    className="w-full text-left px-2 py-2 text-xs text-zinc-700 hover:bg-zinc-50 rounded flex flex-col"
                                >
                                    <span className="font-medium truncate w-full">{s.title}</span>
                                    <span className="text-[10px] text-zinc-400">{formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            <button className="p-1.5 hover:bg-zinc-100 rounded text-zinc-500">
                <Icons.MoreHorizontal className="w-4 h-4" />
            </button>
        </div>
      </div>

      {/* New Chat Initial UI - 入力欄が上、Past Chatsが下 */}
      {(!currentSessionId || currentSessionId?.startsWith("new-")) && messages.length === 0 ? (
        <div className="flex-1 flex flex-col justify-between">
          {/* Top Input Area */}
          <div className="px-4 pt-4">
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
                <div ref={filesPopupRef} className="absolute top-full left-0 mt-2 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-48 overflow-y-auto py-1 animate-in fade-in slide-in-from-top-2 duration-100">
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
                disabled={loading}
              />
              
              <div className="flex items-center justify-between px-2 py-1.5 border-t border-zinc-100 bg-zinc-50/30 rounded-b-xl">
                <div className="flex items-center gap-1">
                  {/* Agent Dropdown */}
                  <div className="relative" ref={agentDropdownRef}>
                    <button
                      onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                      className={`flex items-center gap-1.5 text-[11px] font-medium rounded px-2 py-1 transition-colors ${getModeStyles(mode)}`}
                    >
                      {getModeIcon(mode, "w-3.5 h-3.5")}
                      <span className="capitalize">{mode}</span>
                      <Icons.ChevronDown className="w-3 h-3 opacity-50" />
                    </button>
                    {isAgentDropdownOpen && (
                      <div className="absolute top-full left-0 mt-2 w-32 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
                        <button 
                          onClick={() => { setMode("agent"); setIsAgentDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center justify-between ${mode === "agent" ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-600"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Icons.Agent className="w-3.5 h-3.5" />
                            <span>Agent</span>
                          </div>
                          {mode === "agent" && <Icons.Check className="w-3 h-3" />}
                        </button>
                        <button 
                          onClick={() => { setMode("plan"); setIsAgentDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center justify-between ${mode === "plan" ? "bg-[#FFF8E6] text-[#B95D00] font-medium" : "text-zinc-600"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Icons.Plan className="w-3.5 h-3.5" />
                            <span>Plan</span>
                          </div>
                          {mode === "plan" && <Icons.Check className="w-3 h-3" />}
                        </button>
                        <button 
                          onClick={() => { setMode("ask"); setIsAgentDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center justify-between ${mode === "ask" ? "bg-green-50 text-green-700 font-medium" : "text-zinc-600"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Icons.Ask className="w-3.5 h-3.5" />
                            <span>Ask</span>
                          </div>
                          {mode === "ask" && <Icons.Check className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Model Dropdown */}
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                      className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded px-2 py-1 transition-colors"
                    >
                      <span>{currentModelName}</span>
                      <Icons.ChevronDown className="w-3 h-3 opacity-50" />
                    </button>
                    
                    {isModelDropdownOpen && (
                      <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-60 overflow-y-auto py-1">
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
                </div>

                <div className="flex items-center gap-1">
                  <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                    <span className="text-xs">@</span>
                  </button>
                  <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                    <Icons.Globe className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                    <Icons.Image className="w-3.5 h-3.5" />
                  </button>
                  {prompt.trim().length === 0 ? (
                    <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                      <Icons.Mic className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onSubmit()}
                      disabled={loading || !prompt.trim()}
                      className={`ml-1 p-1.5 rounded-full transition-all flex items-center justify-center ${getSubmitButtonStyles(mode, prompt.trim().length > 0)}`}
                    >
                      <Icons.ArrowUp className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Past Chats List - 下部に固定 */}
          <div className="px-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <button 
                onClick={() => setIsPastChatsExpanded(!isPastChatsExpanded)}
                className="flex items-center gap-2 hover:opacity-70 transition-opacity"
              >
                <span className="text-xs font-medium text-zinc-400">Past Chats</span>
                <Icons.ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${isPastChatsExpanded ? "" : "-rotate-90"}`} />
              </button>
              {sessions.length > 3 && (
                <button 
                  onClick={() => setShowHistoryDropdown(true)}
                  className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  View All
                </button>
              )}
            </div>
            {isPastChatsExpanded && (
              <div className="space-y-1">
                {sessions.slice(0, 3).map(session => (
                  <button
                    key={session.id}
                    onClick={() => openSession(session)}
                    className="w-full text-left px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 rounded-lg flex items-center justify-between group"
                  >
                    <span className="truncate">{session.title}</span>
                    <span className="text-xs text-zinc-400">{formatDistanceToNow(new Date(session.created_at), { addSuffix: false })}</span>
                  </button>
                ))}
                {sessions.length === 0 && (
                  <p className="text-xs text-zinc-400 py-4 text-center">No past chats yet</p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Messages Area - 通常のチャットUI */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 pb-40">
        {messages.length === 0 && !currentSessionId && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-2 opacity-50">
             <p>No messages yet.</p>
          </div>
        )}
        
        {messages.map((msg, idx) => {
          const codeBlock = msg.role === "assistant" ? extractCodeBlock(msg.content) : null;
          const isThoughtExpanded = expandedThoughts[msg.id];
          
          if (msg.role === "user") {
              return (
                  <div key={msg.id} className="text-[14px] font-normal text-zinc-900 leading-relaxed px-1">
                     {msg.content}
                  </div>
              )
          }

          return (
            <div key={msg.id} className="flex flex-col gap-1">
               {/* Thought Accordion (Mock) */}
               <div className="flex flex-col gap-1">
                   <button 
                       onClick={() => toggleThought(msg.id)}
                       className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-600 w-fit select-none"
                   >
                       <Icons.ChevronDown className={`w-3 h-3 transition-transform ${isThoughtExpanded ? "" : "-rotate-90"}`} />
                       <span>Thought for 2s</span>
                   </button>
                   {isThoughtExpanded && (
                       <div className="pl-5 text-xs text-zinc-500 border-l-2 border-zinc-200 ml-1.5 py-1">
                           {/* Placeholder thought content */}
                           Thinking Process...
                       </div>
                   )}
               </div>

               <div className="text-[14px] leading-relaxed text-zinc-800">
                   <div className="whitespace-pre-wrap">
                    {msg.content}
                    {codeBlock && !msg.isError && (
                      <div className="flex gap-2 mt-3 mb-1">
                        <button onClick={() => onRequestDiff(codeBlock)} className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded px-2 py-1 transition-colors">Apply</button>
                        <button onClick={() => onAppend(codeBlock)} className="text-xs font-medium bg-zinc-50 hover:bg-zinc-100 text-zinc-600 border border-zinc-200 rounded px-2 py-1 transition-colors">Append</button>
                      </div>
                    )}
                  </div>
               </div>
               
               {/* Message Actions */}
               <div className="flex items-center gap-2 mt-1">
                   <button className="p-1 hover:bg-zinc-100 rounded text-zinc-400">
                       <Icons.Copy className="w-3.5 h-3.5" />
                   </button>
                   <button className="p-1 hover:bg-zinc-100 rounded text-zinc-400">
                       <Icons.MoreHorizontal className="w-3.5 h-3.5" />
                   </button>
               </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm px-1">
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
            placeholder="Add a follow-up"
            rows={1}
            disabled={loading}
          />
          
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-zinc-100 bg-zinc-50/30 rounded-b-xl">
             <div className="flex items-center gap-1">
                {/* Agent Dropdown */}
                <div className="relative" ref={agentDropdownRef}>
                    <button
                        onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                        className={`flex items-center gap-1.5 text-[11px] font-medium rounded px-2 py-1 transition-colors ${getModeStyles(mode)}`}
                    >
                        {getModeIcon(mode, "w-3.5 h-3.5")}
                        <span className="capitalize">{mode}</span>
                        <Icons.ChevronDown className="w-3 h-3 opacity-50" />
                    </button>
                     {isAgentDropdownOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-32 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
                            <button 
                                onClick={() => { setMode("agent"); setIsAgentDropdownOpen(false); }}
                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center justify-between ${mode === "agent" ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-600"}`}
                            >
                                <div className="flex items-center gap-2">
                                    <Icons.Agent className="w-3.5 h-3.5" />
                                    <span>Agent</span>
                                </div>
                                {mode === "agent" && <Icons.Check className="w-3 h-3" />}
                            </button>
                            <button 
                                onClick={() => { setMode("plan"); setIsAgentDropdownOpen(false); }}
                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center justify-between ${mode === "plan" ? "bg-[#FFF8E6] text-[#B95D00] font-medium" : "text-zinc-600"}`}
                            >
                                <div className="flex items-center gap-2">
                                    <Icons.Plan className="w-3.5 h-3.5" />
                                    <span>Plan</span>
                                </div>
                                {mode === "plan" && <Icons.Check className="w-3 h-3" />}
                            </button>
                            <button 
                                onClick={() => { setMode("ask"); setIsAgentDropdownOpen(false); }}
                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center justify-between ${mode === "ask" ? "bg-green-50 text-green-700 font-medium" : "text-zinc-600"}`}
                            >
                                <div className="flex items-center gap-2">
                                    <Icons.Ask className="w-3.5 h-3.5" />
                                    <span>Ask</span>
                                </div>
                                {mode === "ask" && <Icons.Check className="w-3 h-3" />}
                            </button>
                        </div>
                    )}
                </div>

                {/* Model Dropdown */}
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
             </div>

            <div className="flex items-center gap-1">
                {loading ? (
                    <>
                         <div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin mr-1"></div>
                         <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                            <span className="text-xs">@</span>
                        </button>
                        <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                            <Icons.Globe className="w-3.5 h-3.5" />
                        </button>
                        <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                            <Icons.Image className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={handleStop}
                            className="ml-1 p-1.5 rounded-full transition-all flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-zinc-600 border border-zinc-200"
                        >
                            <Icons.Stop className="w-3.5 h-3.5" />
                        </button>
                    </>
                ) : (
                    <>
                        <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                            <span className="text-xs">@</span>
                        </button>
                        <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                            <Icons.Globe className="w-3.5 h-3.5" />
                        </button>
                        <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                            <Icons.Image className="w-3.5 h-3.5" />
                        </button>
                        {prompt.trim().length === 0 ? (
                             <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                                <Icons.Mic className="w-3.5 h-3.5" />
                            </button>
                        ) : (
                             <button
                                onClick={() => onSubmit()}
                                disabled={loading || !prompt.trim()}
                                className={`ml-1 p-1.5 rounded-full transition-all flex items-center justify-center ${getSubmitButtonStyles(mode, prompt.trim().length > 0)}`}
                            >
                                <Icons.ArrowUp className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </>
                )}
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
});

AiPanel.displayName = "AiPanel";

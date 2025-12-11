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
  images?: string[]; // Base64 画像の配列
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
  
  const [selectedModels, setSelectedModels] = useState<string[]>(["claude-opus-4-5-20251101"]);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [maxMode, setMaxMode] = useState(false);
  const [useMultipleModels, setUseMultipleModels] = useState(false);
  
  // "Thought" section state (mock)
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  // @Files popup state
  const [showFilesPopup, setShowFilesPopup] = useState(false);
  const [filesSearchQuery, setFilesSearchQuery] = useState("");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState<number | null>(null);
  
  // Image upload state
  const [attachedImages, setAttachedImages] = useState<{ file: File; preview: string }[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const filesPopupRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isSubmittingRef = useRef(false); // 送信中フラグ（loadMessagesの上書きを防ぐ）

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
      // 送信中は楽観的更新を上書きしない
      if (isSubmittingRef.current) {
        return;
      }
      
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
          created_at: m.created_at,
          images: m.images || undefined,
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

  const saveMessage = async (sessionId: string, role: "user" | "assistant", content: string, images?: string[]) => {
    await supabase.from("chat_messages").insert({
      session_id: sessionId,
      role,
      content,
      images: images || null,
    });
  };

  // 画像をSupabase Storageにアップロード
  const uploadImageToStorage = async (base64: string, sessionId: string, index: number): Promise<string | null> => {
    try {
      // Base64からBlobに変換
      const match = base64.match(/^data:(.+);base64,(.+)$/);
      if (!match) return null;
      
      const mimeType = match[1];
      const base64Data = match[2];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      
      // ファイル名を生成
      const ext = mimeType.split('/')[1] || 'png';
      const fileName = `${sessionId}/${Date.now()}_${index}.${ext}`;
      
      // Supabase Storageにアップロード
      const { data, error } = await supabase.storage
        .from('chat-images')
        .upload(fileName, blob, {
          contentType: mimeType,
          upsert: false,
        });
      
      if (error) {
        console.error('Supabase Storage Upload error:', error);
        return null;
      }
      
      // 公開URLを取得
      const { data: urlData } = supabase.storage
        .from('chat-images')
        .getPublicUrl(fileName);
      
      console.log('Image uploaded:', urlData.publicUrl);
      return urlData.publicUrl;
    } catch (e) {
      console.error('Upload function error:', e);
      return null;
    }
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
    // テキストまたは画像がある場合に送信可能
    if ((!promptToSend.trim() && attachedImages.length === 0) || loading) return;

    // 送信中フラグをセット（loadMessagesによる上書きを防ぐ）
    isSubmittingRef.current = true;

    let activeSessionId = currentSessionId;
    
    // 一時的なタブID（new-で始まる）の場合は新しいセッションを作成
    if (!activeSessionId || activeSessionId.startsWith("new-")) {
      const tempTabId = activeSessionId; // 一時的なタブIDを保存
      activeSessionId = await createNewSession(promptToSend || "Image", tempTabId || undefined);
      if (!activeSessionId) return; // Error handling
    }

    // 画像をBase64に変換
    const imageBase64List: string[] = [];
    for (const img of attachedImages) {
      const base64 = await fileToBase64(img.file);
      imageBase64List.push(base64);
    }

    // Optimistic update - 画像も含める（まずはBase64で即時表示）
    const tempId = Date.now().toString();
    setMessages(prev => [...prev, { 
      id: tempId, 
      role: "user", 
      content: promptToSend || "",
      images: imageBase64List.length > 0 ? imageBase64List : undefined,
    }]);
    if (!customPrompt) setPrompt("");
    
    // 画像をクリア
    setAttachedImages([]);
    setLoading(true);

    // 画像をSupabase Storageにアップロード
    const uploadedImageUrls: string[] = [];
    for (let i = 0; i < imageBase64List.length; i++) {
      const url = await uploadImageToStorage(imageBase64List[i], activeSessionId, i);
      if (url) {
        uploadedImageUrls.push(url);
      }
    }

    // Save user message with image URLs
    await saveMessage(activeSessionId, "user", promptToSend || "", uploadedImageUrls.length > 0 ? uploadedImageUrls : undefined);

    // OptimisticメッセージをStorageの公開URLで上書き（リロードなしで反映）
    if (uploadedImageUrls.length > 0) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, images: uploadedImageUrls } : m));
    }

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
          images: imageBase64List,
        }),
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current.signal,
      });

      // レスポンスがJSONかどうかを確認
      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType?.includes("application/json")) {
        const errorText = await res.text();
        throw new Error(errorText || `Server error: ${res.status}`);
      }

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
        isSubmittingRef.current = false; // 送信完了
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
    setAttachedImages([]);
    
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

  // Image upload handlers
  const handleImageClick = () => {
    imageInputRef.current?.click();
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages: { file: File; preview: string }[] = [];
    Array.from(files).forEach(file => {
      if (file.type.startsWith("image/")) {
        const preview = URL.createObjectURL(file);
        newImages.push({ file, preview });
      }
    });
    setAttachedImages(prev => [...prev, ...newImages]);
    
    // Reset input
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setAttachedImages(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  // Handle paste for screenshots
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const newImages: { file: File; preview: string }[] = [];
    Array.from(items).forEach(item => {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const preview = URL.createObjectURL(file);
          newImages.push({ file, preview });
        }
      }
    });
    
    if (newImages.length > 0) {
      setAttachedImages(prev => [...prev, ...newImages]);
    }
  };

  // Convert file to base64 with optional compression
  const fileToBase64 = (file: File, maxWidth = 1024, quality = 0.8): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // 画像が大きい場合はリサイズ
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(reader.result as string);
            return;
          }
          
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        };
        img.onerror = () => {
          // 画像として読み込めない場合は元のデータを返す
          resolve(reader.result as string);
        };
        img.src = reader.result as string;
      };
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const handleModelSelect = (modelId: string) => {
    if (useMultipleModels) {
      setSelectedModels(prev => {
        if (prev.includes(modelId)) {
          return prev.filter(id => id !== modelId);
        } else {
          return [...prev, modelId];
        }
      });
    } else {
      setSelectedModels([modelId]);
      setSelectedModel(modelId);
      setIsModelDropdownOpen(false);
    }
  };

  const getModelDisplay = () => {
    if (autoMode) return "Auto";
    if (useMultipleModels && selectedModels.length > 1) {
        return `${selectedModels.length}x ${availableModels.find(m => m.id === selectedModels[0])?.name.split(" ")[0]}...`;
    }
    const current = availableModels.find(m => m.id === selectedModel);
    return current ? current.name : selectedModel;
  };

  const getMaxModeIndicator = () => {
    if (maxMode && !autoMode) {
      return "1x";
    }
    return null;
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

              {/* Attached Images Preview - テキストエリアの上部 */}
              {attachedImages.length > 0 && (
                <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto no-scrollbar">
                  {attachedImages.map((img, index) => (
                    <div key={index} className="relative flex-shrink-0">
                      <img 
                        src={img.preview} 
                        alt={`Attached ${index + 1}`} 
                        className="h-14 w-14 object-cover rounded-lg border border-zinc-200"
                      />
                      <button
                        onClick={() => removeImage(index)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full flex items-center justify-center text-[10px]"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={textareaRef}
                className={`w-full max-h-60 bg-transparent px-4 py-3 text-sm text-zinc-800 resize-none focus:outline-none placeholder:text-zinc-400 min-h-[44px] ${attachedImages.length > 0 ? "" : "rounded-t-xl"}`}
                value={prompt}
                onChange={handlePromptChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
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
                      className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded px-2 py-1 transition-colors min-w-[100px]"
                    >
                      <span>{getModelDisplay()}</span>
                      <Icons.ChevronDown className="w-3 h-3 opacity-50" />
                    </button>
                    
                    {isModelDropdownOpen && (
                      <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-[500px] overflow-y-auto">
                        {/* Search Box */}
                        <div className="p-2 border-b border-zinc-200">
                          <input
                            type="text"
                            placeholder="Search models"
                            value={modelSearchQuery}
                            onChange={(e) => setModelSearchQuery(e.target.value)}
                            className="w-full px-2 py-1.5 text-xs bg-zinc-50 border-none rounded focus:outline-none focus:ring-0 placeholder:text-zinc-400"
                          />
                        </div>

                        {/* Toggle Switches */}
                        <div className="p-3 border-b border-zinc-200 space-y-2">
                          <div className="flex items-start justify-between">
                            <div className="flex flex-col flex-1 min-w-0 pr-3">
                                <span className="text-xs text-zinc-700 font-medium">Auto</span>
                                {autoMode && (
                                    <span className="text-[10px] text-zinc-500 mt-0.5 leading-tight">Balanced quality and speed, recommended for most tasks</span>
                                )}
                            </div>
                            <button
                              onClick={() => setAutoMode(!autoMode)}
                              className={`flex-shrink-0 inline-flex h-4 w-7 items-center rounded-full transition-colors ${autoMode ? 'bg-[#2F8132]' : 'bg-zinc-200'}`}
                            >
                              <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${autoMode ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                            </button>
                          </div>
                          
                          {!autoMode && (
                            <>
                                <div className="flex items-center justify-between">
                                <span className="text-xs text-zinc-700 font-medium">MAX Mode</span>
                                <button
                                    onClick={() => setMaxMode(!maxMode)}
                                    className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors ${maxMode ? 'bg-purple-600' : 'bg-zinc-200'}`}
                                >
                                    <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${maxMode ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                                </button>
                                </div>
                                
                                <div className="flex items-center justify-between">
                                <span className="text-xs text-zinc-700 font-medium">Use Multiple Models</span>
                                <button
                                    onClick={() => setUseMultipleModels(!useMultipleModels)}
                                    className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors ${useMultipleModels ? 'bg-[#2F8132]' : 'bg-zinc-200'}`}
                                >
                                    <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${useMultipleModels ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                                </button>
                                </div>
                            </>
                          )}
                        </div>

                        {/* Models List - Hide when Auto is on */}
                        {!autoMode && (
                            <div className="py-1">
                            <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-400">Composer 1</div>
                            
                            {availableModels
                                .filter(m => !modelSearchQuery || m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()))
                                .map((model) => {
                                const isSelected = useMultipleModels 
                                    ? selectedModels.includes(model.id)
                                    : selectedModel === model.id;
                                    
                                return (
                                    <button
                                    key={model.id}
                                    onClick={() => handleModelSelect(model.id)}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 flex items-center justify-between group ${isSelected ? "bg-zinc-100" : ""}`}
                                    >
                                    <div className="flex items-center gap-2">
                                        <div className={`w-3.5 h-3.5 flex items-center justify-center rounded border ${isSelected ? "bg-purple-600 border-purple-600" : "border-zinc-300 bg-white"}`}>
                                        {isSelected && <Icons.Check className="w-2.5 h-2.5 text-white" />}
                                        </div>
                                        <span className="text-zinc-700">{model.name}</span>
                                        <Icons.Brain className="w-3 h-3 text-zinc-300" />
                                    </div>
                                    {useMultipleModels && isSelected && (
                                        <span className="text-[10px] text-zinc-400">1x</span>
                                    )}
                                    </button>
                                );
                                })}
                            </div>
                        )}
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
                  <button 
                    onClick={handleImageClick}
                    className={`p-1.5 hover:bg-zinc-200 rounded transition-colors ${attachedImages.length > 0 ? "text-blue-500" : "text-zinc-400 hover:text-zinc-600"}`}
                  >
                    <Icons.Image className="w-3.5 h-3.5" />
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageChange}
                    className="hidden"
                  />
                  {prompt.trim().length === 0 && attachedImages.length === 0 ? (
                    <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                      <Icons.Mic className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onSubmit()}
                      disabled={loading || (!prompt.trim() && attachedImages.length === 0)}
                      className={`ml-1 p-1.5 rounded-full transition-all flex items-center justify-center ${getSubmitButtonStyles(mode, prompt.trim().length > 0 || attachedImages.length > 0)}`}
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
                  <div key={msg.id} className="flex flex-col gap-2 px-1">
                     {/* ユーザーが送信した画像 */}
                     {msg.images && msg.images.length > 0 && (
                       <div className="flex gap-2 flex-wrap">
                         {msg.images.map((img, imgIdx) => (
                           <img 
                             key={imgIdx}
                             src={img} 
                             alt={`Attached ${imgIdx + 1}`}
                             className="max-w-[240px] max-h-[240px] w-auto h-auto object-contain rounded-lg border border-zinc-200 cursor-pointer hover:opacity-90 transition-opacity"
                             onClick={() => window.open(img, '_blank')}
                           />
                         ))}
                       </div>
                     )}
                     {msg.content && (
                       <div className="text-[14px] font-normal text-zinc-900 leading-relaxed whitespace-pre-wrap">
                         {msg.content}
                       </div>
                     )}
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

          {/* Attached Images Preview - テキストエリアの上部 */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto no-scrollbar">
              {attachedImages.map((img, index) => (
                <div key={index} className="relative flex-shrink-0">
                  <img 
                    src={img.preview} 
                    alt={`Attached ${index + 1}`} 
                    className="h-14 w-14 object-cover rounded-lg border border-zinc-200"
                  />
                  <button
                    onClick={() => removeImage(index)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full flex items-center justify-center text-[10px]"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className={`w-full max-h-60 bg-transparent px-4 py-3 text-sm text-zinc-800 resize-none focus:outline-none placeholder:text-zinc-400 min-h-[44px] ${attachedImages.length > 0 ? "" : "rounded-t-xl"}`}
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
                    <div className="absolute bottom-full left-0 mb-2 w-96 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-[500px] overflow-y-auto">
                      {/* Search Box */}
                      <div className="p-3 border-b border-zinc-200">
                        <input
                          type="text"
                          placeholder="Search models"
                          value={modelSearchQuery}
                          onChange={(e) => setModelSearchQuery(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-md focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      {/* Toggle Switches */}
                      <div className="p-3 border-b border-zinc-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-zinc-700">Auto</span>
                          <button
                            onClick={() => setAutoMode(!autoMode)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoMode ? 'bg-zinc-400' : 'bg-zinc-300'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoMode ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-zinc-700">MAX Mode</span>
                          <button
                            onClick={() => setMaxMode(!maxMode)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${maxMode ? 'bg-purple-600' : 'bg-zinc-300'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${maxMode ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-zinc-700">Use Multiple Models</span>
                          <button
                            onClick={() => setUseMultipleModels(!useMultipleModels)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useMultipleModels ? 'bg-zinc-400' : 'bg-zinc-300'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${useMultipleModels ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      </div>

                      {/* Composer 1 Section */}
                      <div className="border-b border-zinc-200">
                        <div className="px-3 py-2 text-xs font-semibold text-zinc-500">Composer 1</div>
                        
                        {availableModels
                          .filter(m => !modelSearchQuery || m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()))
                          .map((model) => (
                          <button
                            key={model.id}
                            onClick={() => { setSelectedModel(model.id); setIsModelDropdownOpen(false); }}
                            className={`w-full text-left px-3 py-2.5 text-sm hover:bg-zinc-50 flex items-center justify-between ${selectedModel === model.id ? "bg-zinc-50" : ""}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-zinc-700">{model.name}</span>
                              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                            </div>
                            {selectedModel === model.id && <Icons.Check className="w-4 h-4 text-zinc-700" />}
                          </button>
                        ))}
                      </div>
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
                        <button 
                            onClick={handleImageClick}
                            className={`p-1.5 hover:bg-zinc-200 rounded transition-colors ${attachedImages.length > 0 ? "text-blue-500" : "text-zinc-400 hover:text-zinc-600"}`}
                        >
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
                        <button 
                            onClick={handleImageClick}
                            className={`p-1.5 hover:bg-zinc-200 rounded transition-colors ${attachedImages.length > 0 ? "text-blue-500" : "text-zinc-400 hover:text-zinc-600"}`}
                        >
                            <Icons.Image className="w-3.5 h-3.5" />
                        </button>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageChange}
                          className="hidden"
                        />
                        {prompt.trim().length === 0 && attachedImages.length === 0 ? (
                             <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                                <Icons.Mic className="w-3.5 h-3.5" />
                            </button>
                        ) : (
                             <button
                                onClick={() => onSubmit()}
                                disabled={loading || (!prompt.trim() && attachedImages.length === 0)}
                                className={`ml-1 p-1.5 rounded-full transition-all flex items-center justify-center ${getSubmitButtonStyles(mode, prompt.trim().length > 0 || attachedImages.length > 0)}`}
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

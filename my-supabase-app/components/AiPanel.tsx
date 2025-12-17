"use client";

import { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle, useCallback } from "react";
import { Icons } from "./Icons";
import { ChatMarkdown } from "./ChatMarkdown";
import { ReviewChangesCard } from "./ReviewChangesCard";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { applyPatch, createTwoFilesPatch, formatPatch, parsePatch, reversePatch } from "diff";
import type { PendingChange, ReviewIssue } from "@/lib/review/types";
import type { AgentCheckpointRecordInput, StoredCheckpoint, StoredCheckpointOperation, StoredCheckpointState } from "@/lib/checkpoints/types";
import { loadCheckpointState, makeEmptyCheckpointState, saveCheckpointState } from "@/lib/checkpoints/storage";

type ToolCall = {
  tool: string;
  args: any;
  result: any;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  created_at?: string;
  images?: string[]; // Base64 画像の配列
  toolCalls?: ToolCall[]; // AIが使用したツール呼び出し
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
  onRequestReview?: (changes: PendingChange[], origin?: { sessionId: string; userMessageId: string; assistantMessageId: string }) => void;
  onOpenPlan?: (planMarkdown: string, titleHint?: string) => void;
  onReplace?: (text: string) => void;
  onFileCreated?: () => void;
  nodes: FileNode[];
  onGetFileContent: (nodeId: string) => Promise<string>;

  // Cursor-like Review (rendered inside the chat panel)
  reviewChanges?: PendingChange[];
  reviewIssues?: ReviewIssue[] | null;
  isFindingReviewIssues?: boolean;
  onReviewSelectFile?: (changeId: string) => void;
  onReviewSelectIssue?: (issueId: string) => void;
  onReviewAcceptAll?: () => void;
  onReviewRejectAll?: () => void;
  onReviewFindIssues?: () => void;
  onReviewDismissIssue?: (issueId: string) => void;
  onReviewFixIssueInChat?: (issueId: string) => void;
  onReviewFixAllIssuesInChat?: () => void;
};

export type AiPanelHandle = {
  triggerAction: (action: "explain" | "fix" | "test" | "refactor") => void;
  sendPrompt: (prompt: string, opts?: { mode?: "agent" | "plan" | "ask" }) => void;
  recordAgentCheckpoint: (input: AgentCheckpointRecordInput) => void;
};

const DEFAULT_MODELS: ModelConfig[] = [
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", provider: "google", enabled: true },
  { id: "claude-opus-4-5-20251101", name: "Opus 4.5", provider: "anthropic", enabled: true },
  { id: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5", provider: "anthropic", enabled: true },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", enabled: true },
  { id: "gpt-5.2-extra-high", name: "GPT-5.2 Extra High", provider: "openai", enabled: true },
];

export const AiPanel = forwardRef<AiPanelHandle, Props>(({
  projectId,
  currentFileText,
  onAppend,
  onRequestDiff,
  onRequestReview,
  onOpenPlan,
  onFileCreated,
  nodes,
  onGetFileContent,
  reviewChanges,
  reviewIssues,
  isFindingReviewIssues,
  onReviewSelectFile,
  onReviewSelectIssue,
  onReviewAcceptAll,
  onReviewRejectAll,
  onReviewFindIssues,
  onReviewDismissIssue,
  onReviewFixIssueInChat,
  onReviewFixAllIssuesInChat,
}, ref) => {
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
  
  // Checkpoints (Cursor-like)
  const [messageHead, setMessageHead] = useState<number | null>(null);
  const [checkpoints, setCheckpoints] = useState<StoredCheckpoint[]>([]);
  // null = before the first checkpoint
  const [headCheckpointId, setHeadCheckpointId] = useState<string | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [restoreToIndex, setRestoreToIndex] = useState<number | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [redoSnapshot, setRedoSnapshot] = useState<{ messageHead: number | null; headCheckpointId: string | null } | null>(null);

  // Submit-from-previous / message edit (Cursor-like)
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingImageUrls, setEditingImageUrls] = useState<string[]>([]);
  const [draftBeforeEdit, setDraftBeforeEdit] = useState<string>("");
  const [showSubmitPrevDialog, setShowSubmitPrevDialog] = useState(false);
  const [submitPrevDontAskAgain, setSubmitPrevDontAskAgain] = useState(false);
  
  // Copy feedback state
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  
  // Message action menu state
  const [openMessageMenu, setOpenMessageMenu] = useState<string | null>(null);
  
  // History search and edit state
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);
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
        setMessageHead(null);
        setCheckpoints([]);
        setHeadCheckpointId(null);
        setRedoSnapshot(null);
        setShowRestoreDialog(false);
        setRestoreToIndex(null);
        return;
      }

      const persisted = loadCheckpointState(currentSessionId) ?? makeEmptyCheckpointState({ projectId, sessionId: currentSessionId });
      setCheckpoints(persisted.checkpoints || []);
      setHeadCheckpointId(persisted.headCheckpointId ?? null);
      setRedoSnapshot(null);
      setShowRestoreDialog(false);
      setRestoreToIndex(null);

      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", currentSessionId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        const loaded = data.map(m => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          created_at: m.created_at,
          images: m.images || undefined,
        }));
        setMessages(loaded);

        if (!persisted.headMessageId) {
          setMessageHead(null);
        } else {
          const idx = loaded.findIndex((m) => m.id === persisted.headMessageId);
          setMessageHead(idx >= 0 ? idx + 1 : null);
        }
      }
    }
    loadMessages();
  }, [currentSessionId, projectId, supabase]);

  useEffect(() => {
    if (!currentSessionId || currentSessionId.startsWith("new-")) return;
    const headMessageId = messageHead === null ? null : (messages[Math.max(0, messageHead - 1)]?.id ?? null);
    const state: StoredCheckpointState = {
      v: 1,
      projectId,
      sessionId: currentSessionId,
      checkpoints,
      headCheckpointId,
      headMessageId,
      updatedAt: new Date().toISOString(),
    };
    saveCheckpointState(state);
  }, [checkpoints, currentSessionId, headCheckpointId, messageHead, messages, projectId]);

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

  const saveMessage = async (sessionId: string, role: "user" | "assistant", content: string, images?: string[]): Promise<string | null> => {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role,
        content,
        images: images || null,
      })
      .select("id")
      .single();
    if (error) {
      console.error("Failed to save chat message:", error);
      return null;
    }
    return data?.id ?? null;
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
      if (messageMenuRef.current && !messageMenuRef.current.contains(event.target as Node)) {
        setOpenMessageMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ESC handlers (Cursor-like)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (showRestoreDialog) {
        setShowRestoreDialog(false);
        setRestoreToIndex(null);
        return;
      }

      if (showSubmitPrevDialog) {
        setShowSubmitPrevDialog(false);
        setSubmitPrevDontAskAgain(false);
        return;
      }

      if (editingMessageIndex !== null) {
        setEditingMessageIndex(null);
        setEditingImageUrls([]);
        setAttachedImages([]);
        setPrompt(draftBeforeEdit || "");
        setDraftBeforeEdit("");
        setShowSubmitPrevDialog(false);
        setSubmitPrevDontAskAgain(false);
        return;
      }

      setIsModelDropdownOpen(false);
      setIsAgentDropdownOpen(false);
      setShowFilesPopup(false);
      setShowHistoryDropdown(false);
      setOpenMessageMenu(null);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [draftBeforeEdit, editingMessageIndex, showRestoreDialog, showSubmitPrevDialog]);

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

  const startEditingMessage = (messageIndex: number) => {
    const msg = messages[messageIndex];
    if (!msg || msg.role !== "user") return;
    if (loading) return;
    setDraftBeforeEdit(prompt);
    setEditingMessageIndex(messageIndex);
    setEditingImageUrls(msg.images || []);
    setAttachedImages([]);
    setPrompt(msg.content || "");
    setTimeout(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
      }
    }, 0);
  };

  const cancelEditingMessage = () => {
    setEditingMessageIndex(null);
    setEditingImageUrls([]);
    setAttachedImages([]);
    setPrompt(draftBeforeEdit || "");
    setDraftBeforeEdit("");
    setShowSubmitPrevDialog(false);
    setSubmitPrevDontAskAgain(false);
  };

  const onSubmit = async (
    customPrompt?: string,
    opts?: { mode?: "agent" | "plan" | "ask" }
  ) => {
    const effectiveMode = opts?.mode ?? mode;
    if (opts?.mode && opts.mode !== mode) {
      setMode(opts.mode);
    }

    const promptToSend = customPrompt || prompt;
    const imagesToSend = [...attachedImages];
    // テキストまたは画像がある場合に送信可能
    if ((!promptToSend.trim() && imagesToSend.length === 0) || loading) return;

    // If time-traveled, committing a new message clears the "future"
    const cutIndex =
      messageHead !== null && currentSessionId && !currentSessionId.startsWith("new-")
        ? messageHead
        : null;
    const idsToDelete = cutIndex !== null ? messages.slice(cutIndex).map((m) => m.id) : [];

    // 送信中フラグをセット（loadMessagesによる上書きを防ぐ）
    isSubmittingRef.current = true;

    // Optimistic update - 画像も含める（まずは即時表示）
    const tempId = Date.now().toString();
    setMessages((prev) => {
      const base = cutIndex !== null ? prev.slice(0, cutIndex) : prev;
      return [
        ...base,
        {
          id: tempId,
          role: "user",
          content: promptToSend || "",
          images: imagesToSend.length > 0 ? imagesToSend.map((img) => img.preview) : undefined,
        },
      ];
    });

    if (cutIndex !== null) {
      setMessageHead(null);
      setRedoSnapshot(null);
      setCheckpoints((prev) => {
        const headIdx = headCheckpointId ? prev.findIndex((cp) => cp.id === headCheckpointId) : -1;
        return headIdx >= 0 ? prev.slice(0, headIdx + 1) : [];
      });
    }

    if (!customPrompt) setPrompt("");
    
    // 画像をクリア
    setAttachedImages([]);
    setLoading(true);

    try {
      if (cutIndex !== null) {
        await deleteMessagesByIds(idsToDelete);
      }

      let activeSessionId = currentSessionId;
      
      // 一時的なタブID（new-で始まる）の場合は新しいセッションを作成
      if (!activeSessionId || activeSessionId.startsWith("new-")) {
        const tempTabId = activeSessionId; // 一時的なタブIDを保存
        activeSessionId = await createNewSession(promptToSend || "Image", tempTabId || undefined);
        if (!activeSessionId) {
          // セッション作成に失敗した場合はUIをロールバック
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          if (!customPrompt) setPrompt(promptToSend);
          setAttachedImages(imagesToSend);
          return;
        }
      }

      // 画像をBase64に変換
      const imageBase64List: string[] = [];
      for (const img of imagesToSend) {
        const base64 = await fileToBase64(img.file);
        imageBase64List.push(base64);
      }

      // 画像をSupabase Storageにアップロード
      const uploadedImageUrls: string[] = [];
      for (let i = 0; i < imageBase64List.length; i++) {
        const url = await uploadImageToStorage(imageBase64List[i], activeSessionId, i);
        if (url) {
          uploadedImageUrls.push(url);
        }
      }

      // Save user message with image URLs and sync id back to UI
      const savedUserMsgId = await saveMessage(
        activeSessionId,
        "user",
        promptToSend || "",
        uploadedImageUrls.length > 0 ? uploadedImageUrls : undefined
      );

      if (savedUserMsgId || uploadedImageUrls.length > 0) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: savedUserMsgId ?? m.id,
                  images: uploadedImageUrls.length > 0 ? uploadedImageUrls : m.images,
                }
              : m
          )
        );
      }

      // Build context
      const fileContext = await buildContextFromMentions(promptToSend);
      const fullPrompt = fileContext + promptToSend;
      const apiKeys = JSON.parse(localStorage.getItem("cursor_api_keys") || "{}");

      // Initialize AbortController
      abortControllerRef.current = new AbortController();

      const res = await fetch("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          prompt: fullPrompt,
          fileText: currentFileText,
          model: selectedModel,
          mode: effectiveMode,
          apiKeys,
          images: imageBase64List,
          autoMode,
          maxMode,
          useMultipleModels,
          selectedModels,
          // Cursor-like review: Agentモードでは編集ツールをステージングして差分を返す
          reviewMode: effectiveMode === "agent",
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
      } else if (data.multipleResults) {
        // Multiple Models mode: 複数の結果を表示
        for (const result of data.multipleResults) {
          const modelName = availableModels.find(m => m.id === result.model)?.name || result.model;
          if (result.error) {
            setMessages(prev => [...prev, { 
              id: Date.now().toString() + result.model, 
              role: "assistant", 
              content: `**[${modelName}]** Error: ${result.error}`,
              isError: true 
            }]);
          } else {
            const tempAssistantId = Date.now().toString() + result.model;
            setMessages(prev => [
              ...prev,
              { 
                id: tempAssistantId, 
                role: "assistant", 
                content: `**[${modelName}]**\n\n${result.content}` 
              }
            ]);
            const savedAssistantId = await saveMessage(activeSessionId, "assistant", `**[${modelName}]**\n\n${result.content}`);
            if (savedAssistantId) {
              setMessages(prev => prev.map(m => m.id === tempAssistantId ? { ...m, id: savedAssistantId } : m));
            }
          }
        }
      } else {
        // 通常モードまたはAutoモード
        const usedModelName = data.usedModel 
          ? (availableModels.find(m => m.id === data.usedModel)?.name || data.usedModel)
          : null;
        const prefix = autoMode && usedModelName ? `*[Auto: ${usedModelName}]*\n\n` : "";
        const assistantMsg = prefix + data.content;
        const tempAssistantMsgId = Date.now().toString();
        const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : undefined;
        setMessages(prev => [...prev, { 
          id: tempAssistantMsgId, 
          role: "assistant", 
          content: assistantMsg,
          toolCalls,
        }]);
        const savedAssistantMsgId = await saveMessage(activeSessionId, "assistant", assistantMsg);
        const finalAssistantMsgId = savedAssistantMsgId ?? tempAssistantMsgId;
        if (savedAssistantMsgId) {
          setMessages(prev => prev.map(m => m.id === tempAssistantMsgId ? { ...m, id: savedAssistantMsgId } : m));
        }

        // Review UI: 提案された変更がある場合はレビュー画面を開く（Cursor-like）
        if (onRequestReview && Array.isArray(data.proposedChanges) && data.proposedChanges.length > 0) {
          const changes = data.proposedChanges.map((c: any) => ({
            id: String(c.id),
            filePath: String(c.filePath || c.path || ""),
            fileName: String(c.fileName || (c.filePath || "").split("/").pop() || ""),
            oldContent: String(c.oldContent || ""),
            newContent: String(c.newContent || ""),
            action: c.action as "create" | "update" | "delete",
            status: "pending" as const,
          }));

          const origin =
            savedUserMsgId && finalAssistantMsgId
              ? { sessionId: activeSessionId, userMessageId: savedUserMsgId, assistantMessageId: finalAssistantMsgId }
              : undefined;

          onRequestReview(changes, origin);
        }

        // Planモード: 生成されたプランを仮想ファイルとして開く
        if (effectiveMode === "plan" && onOpenPlan) {
          onOpenPlan(data.content, promptToSend);
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

  const submitFromPreviousMessage = async (opts: { revert: boolean }) => {
    if (editingMessageIndex === null) return;
    if (!currentSessionId || currentSessionId.startsWith("new-")) {
      // New Chat状態では通常送信にフォールバック
      cancelEditingMessage();
      await onSubmit();
      return;
    }

    const target = messages[editingMessageIndex];
    if (!target || target.role !== "user") return;

    const promptToSend = prompt;
    const hasAnyImages = attachedImages.length > 0 || editingImageUrls.length > 0;
    if ((!promptToSend.trim() && !hasAnyImages) || loading) return;

    // 送信中フラグをセット（loadMessagesによる上書きを防ぐ）
    isSubmittingRef.current = true;
    setLoading(true);

    const activeSessionId = currentSessionId;

    // Initialize AbortController
    abortControllerRef.current = new AbortController();

    try {
      // 既存URL画像をbase64に（AIへ渡す用）
      const existingBase64List: string[] = [];
      for (const url of editingImageUrls) {
        try {
          existingBase64List.push(await urlToBase64(url));
        } catch (e) {
          console.error("Failed to load existing image for resend:", e);
        }
      }

      // 新規添付画像をbase64に
      const newBase64List: string[] = [];
      for (const img of attachedImages) {
        const base64 = await fileToBase64(img.file);
        newBase64List.push(base64);
      }

      const imageBase64List = [...existingBase64List, ...newBase64List];

      // 新規画像のみStorageへアップロード（DB保存用）
      const uploadedImageUrls: string[] = [];
      for (let i = 0; i < newBase64List.length; i++) {
        const url = await uploadImageToStorage(newBase64List[i], activeSessionId, i);
        if (url) uploadedImageUrls.push(url);
      }

      const finalUserImageUrls = [...editingImageUrls, ...uploadedImageUrls];

      // ユーザーメッセージを更新
      await supabase
        .from("chat_messages")
        .update({
          content: promptToSend || "",
          images: finalUserImageUrls.length > 0 ? finalUserImageUrls : null,
        })
        .eq("id", target.id);

      // このメッセージ以降を削除
      const keepCount = editingMessageIndex + 1;
      const idsToDelete = messages.slice(keepCount).map(m => m.id);
      await deleteMessagesByIds(idsToDelete);

      // UIも同じようにトリムして、編集内容を反映
      setMessages(prev => {
        const kept = prev.slice(0, keepCount);
        const updated = kept.map((m, i) => {
          if (i !== editingMessageIndex) return m;
          return {
            ...m,
            content: promptToSend || "",
            images: finalUserImageUrls.length > 0 ? finalUserImageUrls : undefined,
          };
        });
        return updated;
      });
      setMessageHead(null);
      setRedoSnapshot(null);

      // Continue and revert: このメッセージより前の最新チェックポイントに戻す
      if (opts.revert) {
        const targetIndex = findLatestCheckpointIndexAtOrBeforeMessageIndex(Math.max(-1, editingMessageIndex - 1));
        const targetId = targetIndex >= 0 ? (checkpoints[targetIndex]?.id ?? null) : null;
        const fromIndex = findCheckpointIndexById(headCheckpointId);
        await applyCheckpointDelta(fromIndex, targetIndex);
        setHeadCheckpointId(targetId);
        setRedoSnapshot(null);

        const keptMessageIds = new Set(messages.slice(0, keepCount).map((m) => m.id));
        setCheckpoints((prev) => {
          const idx = targetId ? prev.findIndex((cp) => cp.id === targetId) : -1;
          const base = idx >= 0 ? prev.slice(0, idx + 1) : [];
          return base.filter((cp) => keptMessageIds.has(cp.anchorMessageId));
        });
      }

      // 編集状態を解除して送信
      setEditingMessageIndex(null);
      setEditingImageUrls([]);
      setAttachedImages([]);
      setDraftBeforeEdit("");
      setShowSubmitPrevDialog(false);
      setSubmitPrevDontAskAgain(false);
      setPrompt("");

      // Build context
      const fileContext = await buildContextFromMentions(promptToSend);
      const fullPrompt = fileContext + promptToSend;
      const apiKeys = JSON.parse(localStorage.getItem("cursor_api_keys") || "{}");

      const res = await fetch("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          prompt: fullPrompt,
          fileText: currentFileText,
          model: selectedModel,
          mode,
          apiKeys,
          images: imageBase64List,
          autoMode,
          maxMode,
          useMultipleModels,
          selectedModels,
          reviewMode: mode === "agent",
        }),
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current.signal,
      });

      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType?.includes("application/json")) {
        const errorText = await res.text();
        throw new Error(errorText || `Server error: ${res.status}`);
      }

      const data = await res.json();

      if (data.error) {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: `Error: ${data.error}`, isError: true }]);
      } else if (data.multipleResults) {
        for (const result of data.multipleResults) {
          const modelName = availableModels.find(m => m.id === result.model)?.name || result.model;
          if (result.error) {
            setMessages(prev => [...prev, { 
              id: Date.now().toString() + result.model, 
              role: "assistant", 
              content: `**[${modelName}]** Error: ${result.error}`,
              isError: true 
            }]);
          } else {
            const tempAssistantId = Date.now().toString() + result.model;
            setMessages(prev => [
              ...prev,
              { 
                id: tempAssistantId, 
                role: "assistant", 
                content: `**[${modelName}]**\n\n${result.content}` 
              }
            ]);
            const savedAssistantId = await saveMessage(activeSessionId, "assistant", `**[${modelName}]**\n\n${result.content}`);
            if (savedAssistantId) {
              setMessages(prev => prev.map(m => m.id === tempAssistantId ? { ...m, id: savedAssistantId } : m));
            }
          }
        }
      } else {
        const usedModelName = data.usedModel 
          ? (availableModels.find(m => m.id === data.usedModel)?.name || data.usedModel)
          : null;
        const prefix = autoMode && usedModelName ? `*[Auto: ${usedModelName}]*\n\n` : "";
        const assistantMsg = prefix + data.content;
        const tempAssistantMsgId = Date.now().toString();
        const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : undefined;

        setMessages(prev => [...prev, { id: tempAssistantMsgId, role: "assistant", content: assistantMsg, toolCalls }]);
        const savedAssistantMsgId = await saveMessage(activeSessionId, "assistant", assistantMsg);
        const finalAssistantMsgId = savedAssistantMsgId ?? tempAssistantMsgId;
        if (savedAssistantMsgId) {
          setMessages(prev => prev.map(m => m.id === tempAssistantMsgId ? { ...m, id: savedAssistantMsgId } : m));
        }

        // Review UI: 提案された変更がある場合はレビュー画面を開く（Cursor-like）
        if (onRequestReview && Array.isArray(data.proposedChanges) && data.proposedChanges.length > 0) {
          const changes = data.proposedChanges.map((c: any) => ({
            id: String(c.id),
            filePath: String(c.filePath || c.path || ""),
            fileName: String(c.fileName || (c.filePath || "").split("/").pop() || ""),
            oldContent: String(c.oldContent || ""),
            newContent: String(c.newContent || ""),
            action: c.action as "create" | "update" | "delete",
            status: "pending" as const,
          }));

          onRequestReview(changes, { sessionId: activeSessionId, userMessageId: target.id, assistantMessageId: finalAssistantMsgId });
        }

        // Planモード: 生成されたプランを仮想ファイルとして開く
        if (mode === "plan" && onOpenPlan) {
          onOpenPlan(data.content, promptToSend);
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        // Stopped by user
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: `Error: ${error}`, isError: true }]);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      isSubmittingRef.current = false;
    }
  };

  const submitCurrent = () => {
    if (editingMessageIndex !== null) {
      const hasEditContent = prompt.trim().length > 0 || attachedImages.length > 0 || editingImageUrls.length > 0;
      if (!hasEditContent || loading) return;
      const skipDialog = localStorage.getItem("submit_prev_dont_ask") === "true";
      if (skipDialog) {
        const def = localStorage.getItem("submit_prev_default_action");
        void submitFromPreviousMessage({ revert: def === "revert" });
      } else {
        setShowSubmitPrevDialog(true);
      }
      return;
    }
    onSubmit();
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
    // Cmd+. でモード切替ドロップダウンを開く/閉じる（Cursorっぽい）
    if ((e.metaKey || e.ctrlKey) && e.key === ".") {
      e.preventDefault();
      setIsAgentDropdownOpen(prev => !prev);
      setIsModelDropdownOpen(false);
      setShowFilesPopup(false);
      return;
    }

    // Shift+Tab で Plan モードに切り替え（入力欄がアクティブなとき）
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      setMode("plan");
      setShowFilesPopup(false);
      return;
    }

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
        submitCurrent();
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

  const sendPrompt = (text: string, opts?: { mode?: "agent" | "plan" | "ask" }) => {
    onSubmit(text, opts);
  };

  useImperativeHandle(ref, () => ({ triggerAction, sendPrompt, recordAgentCheckpoint }));

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

  // Duplicate Chat - 現在のチャットを複製
  const duplicateChat = async () => {
    if (!currentSessionId || messages.length === 0) return;
    
    // メッセージの上書きを防ぐ
    isSubmittingRef.current = true;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      isSubmittingRef.current = false;
      return;
    }
    
    // 現在のセッションのタイトルを取得
    const currentSession = openTabs.find(t => t.id === currentSessionId) || sessions.find(s => s.id === currentSessionId);
    const baseTitle = currentSession?.title || "Chat";
    
    // 先頭の (1), (2) などの番号を除去してベースタイトルを取得
    const cleanTitle = baseTitle.replace(/^\(\d+\)\s*/, "");
    
    // 同じベースタイトルを持つセッションから最大番号を取得
    let maxNumber = 0;
    sessions.forEach(s => {
      // 先頭の番号を抽出
      const match = s.title.match(/^\((\d+)\)\s*/);
      const sClean = s.title.replace(/^\(\d+\)\s*/, "");
      
      if (sClean === cleanTitle) {
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) maxNumber = num;
        } else {
          // 番号なしの元のタイトルが存在する場合
          if (maxNumber < 1) maxNumber = 0;
        }
      }
    });
    
    // 元のタイトルと同じものがあれば次の番号を付ける
    const newTitle = `(${maxNumber + 1}) ${cleanTitle}`;
    
    // 新しいセッションを作成
    const { data: newSession, error } = await supabase
      .from("chat_sessions")
      .insert({
        user_id: user.id,
        project_id: projectId,
        title: newTitle,
      })
      .select()
      .single();
    
    if (error || !newSession) {
      console.error("Error duplicating chat:", error);
      isSubmittingRef.current = false;
      return;
    }
    
    // メッセージをコピー
    const messagesToCopy = messages.map(msg => ({
      session_id: newSession.id,
      role: msg.role,
      content: msg.content,
      images: msg.images || null,
    }));
    
    await supabase.from("chat_messages").insert(messagesToCopy);
    
    // 現在のメッセージを保存
    const copiedMessages = messages.map(m => ({ ...m }));
    
    // メニューを閉じる
    setOpenMessageMenu(null);
    
    // セッションリストを更新
    setSessions(prev => [newSession, ...prev]);
    
    // 新しいタブを開いて選択、メッセージをセット
    setOpenTabs(prev => [...prev, newSession]);
    setMessages(copiedMessages);
    setCurrentSessionId(newSession.id);
    
    // 状態更新後にフラグをリセット
    setTimeout(() => {
      isSubmittingRef.current = false;
      // タブバーを右端までスクロール
      if (tabsContainerRef.current) {
        tabsContainerRef.current.scrollLeft = tabsContainerRef.current.scrollWidth;
      }
    }, 100);
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

  const urlToBase64 = async (url: string): Promise<string> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read image blob"));
      reader.readAsDataURL(blob);
    });
  };

  // --- Checkpoints (Cursor-like) ---
  const messageIndexById = useMemo(() => new Map(messages.map((m, idx) => [m.id, idx])), [messages]);

  const pathByNodeId = useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const cache = new Map<string, string>();

    const build = (id: string, seen: Set<string>): string => {
      if (cache.has(id)) return cache.get(id)!;
      if (seen.has(id)) return "";
      const node = nodeById.get(id);
      if (!node) return "";
      seen.add(id);
      const parentPath = node.parent_id ? build(node.parent_id, seen) : "";
      const full = parentPath ? `${parentPath}/${node.name}` : node.name;
      cache.set(id, full);
      return full;
    };

    for (const n of nodes) build(n.id, new Set());
    return cache;
  }, [nodes]);

  const nodeIdByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) {
      if (n.type !== "file") continue;
      const fullPath = pathByNodeId.get(n.id);
      if (!fullPath) continue;
      map.set(fullPath, n.id);
    }
    return map;
  }, [nodes, pathByNodeId]);

  const deleteMessagesByIds = useCallback(async (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    if (!currentSessionId || currentSessionId.startsWith("new-")) return;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = ids.filter((id) => uuidRegex.test(id));
    if (validIds.length === 0) return;
    const { error } = await supabase.from("chat_messages").delete().in("id", validIds);
    if (error) {
      console.error("Failed to delete chat messages:", error);
    }
  }, [currentSessionId, supabase]);

  const reversePatchText = (patchText: string): string => {
    try {
      const parsed = parsePatch(patchText);
      if (!parsed || parsed.length === 0) return patchText;
      return formatPatch(reversePatch(parsed[0]));
    } catch {
      return patchText;
    }
  };

  const upsertFileText = useCallback(async (nodeId: string, text: string) => {
    const { error } = await supabase.from("file_contents").upsert({ node_id: nodeId, text });
    if (error) throw new Error(error.message);
  }, [supabase]);

  const ensureFileAtPath = useCallback(async (path: string, text: string, pathToNodeId: Map<string, string>) => {
    const existingId = pathToNodeId.get(path);
    if (existingId) {
      await upsertFileText(existingId, text);
      return existingId;
    }

    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_file", path, content: text, projectId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to create file");
    const nodeId = String(json?.nodeId || "");
    if (nodeId) {
      pathToNodeId.set(path, nodeId);
    }
    return nodeId;
  }, [projectId, upsertFileText]);

  const deleteFileAtPath = useCallback(async (path: string, pathToNodeId: Map<string, string>) => {
    const nodeId = pathToNodeId.get(path);
    if (!nodeId) return;
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_node", id: nodeId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to delete");
    pathToNodeId.delete(path);
  }, []);

  const findCheckpointIndexById = (checkpointId: string | null): number => {
    if (!checkpointId) return -1;
    const idx = checkpoints.findIndex((cp) => cp.id === checkpointId);
    return idx >= 0 ? idx : -1;
  };

  const findLatestCheckpointIndexAtOrBeforeMessageIndex = useCallback((messageIndex: number): number => {
    for (let i = checkpoints.length - 1; i >= 0; i--) {
      const anchorIdx = messageIndexById.get(checkpoints[i].anchorMessageId);
      if (anchorIdx === undefined) continue;
      if (anchorIdx <= messageIndex) return i;
    }
    return -1;
  }, [checkpoints, messageIndexById]);

  const applyCheckpointDelta = useCallback(async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;

    const pathToNodeId = new Map(nodeIdByPath);

    const applyOp = async (op: StoredCheckpointOperation, direction: "forward" | "undo") => {
      const patchText = direction === "forward" ? op.patch : reversePatchText(op.patch);

      if (direction === "forward") {
        if (op.kind === "create") {
          await ensureFileAtPath(op.path, op.afterText, pathToNodeId);
          return;
        }
        if (op.kind === "delete") {
          await deleteFileAtPath(op.path, pathToNodeId);
          return;
        }

        // update
        let nodeId = pathToNodeId.get(op.path);
        if (!nodeId) {
          await ensureFileAtPath(op.path, op.afterText, pathToNodeId);
          return;
        }
        const currentText = await onGetFileContent(nodeId);
        const patched = applyPatch(currentText, patchText);
        const nextText = typeof patched === "string" ? patched : op.afterText;
        await upsertFileText(nodeId, nextText);
        return;
      }

      // undo
      if (op.kind === "create") {
        await deleteFileAtPath(op.path, pathToNodeId);
        return;
      }
      if (op.kind === "delete") {
        await ensureFileAtPath(op.path, op.beforeText, pathToNodeId);
        return;
      }

      // undo update
      let nodeId = pathToNodeId.get(op.path);
      if (!nodeId) {
        await ensureFileAtPath(op.path, op.beforeText, pathToNodeId);
        return;
      }
      const currentText = await onGetFileContent(nodeId);
      const patched = applyPatch(currentText, patchText);
      const nextText = typeof patched === "string" ? patched : op.beforeText;
      await upsertFileText(nodeId, nextText);
    };

    const applyCheckpoint = async (checkpoint: StoredCheckpoint, direction: "forward" | "undo") => {
      const ops = direction === "undo" ? [...checkpoint.ops].reverse() : checkpoint.ops;
      for (const op of ops) {
        await applyOp(op, direction);
      }
    };

    if (toIndex > fromIndex) {
      for (let i = fromIndex + 1; i <= toIndex; i++) {
        const cp = checkpoints[i];
        if (!cp) continue;
        await applyCheckpoint(cp, "forward");
      }
    } else {
      for (let i = fromIndex; i > toIndex; i--) {
        const cp = checkpoints[i];
        if (!cp) continue;
        await applyCheckpoint(cp, "undo");
      }
    }

    onFileCreated?.();
  }, [checkpoints, deleteFileAtPath, ensureFileAtPath, nodeIdByPath, onFileCreated, onGetFileContent, upsertFileText]);

  const recordAgentCheckpoint = useCallback((input: AgentCheckpointRecordInput) => {
    if (!currentSessionId || currentSessionId.startsWith("new-")) return;
    if (!input?.anchorMessageId) return;
    const changes = input.changes || [];
    if (changes.length === 0) return;

    const id = (() => {
      try {
        return crypto.randomUUID();
      } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
    })();

    const checkpoint: StoredCheckpoint = {
      id,
      createdAt: new Date().toISOString(),
      anchorMessageId: input.anchorMessageId,
      description: input.description || `Edited ${changes.length} file(s)`,
      ops: changes.map((c) => ({
        ...c,
        patch: createTwoFilesPatch(c.path, c.path, c.beforeText, c.afterText, "", ""),
      })),
    };

    setCheckpoints((prev) => {
      const headIdx = headCheckpointId ? prev.findIndex((cp) => cp.id === headCheckpointId) : -1;
      const base = headIdx >= 0 ? prev.slice(0, headIdx + 1) : [];
      return [...base, checkpoint];
    });
    setHeadCheckpointId(id);
    setRedoSnapshot(null);
  }, [currentSessionId, headCheckpointId]);

  const performRestoreToMessage = async (messageIndex: number) => {
    if (!currentSessionId || currentSessionId.startsWith("new-")) return;

    const isUser = messages[messageIndex]?.role === "user";
    const hasAssistantResponse = isUser && messages[messageIndex + 1]?.role === "assistant";
    const cutIndex = hasAssistantResponse ? messageIndex + 2 : messageIndex + 1;
    const lastKeptMessageIndex = Math.max(0, cutIndex - 1);

    const targetCheckpointIndex = findLatestCheckpointIndexAtOrBeforeMessageIndex(lastKeptMessageIndex);
    const targetCheckpointId = targetCheckpointIndex >= 0 ? (checkpoints[targetCheckpointIndex]?.id ?? null) : null;
    const fromIndex = findCheckpointIndexById(headCheckpointId);
    const toIndex = targetCheckpointIndex;
    const nextMessageHead = cutIndex >= messages.length ? null : cutIndex;

    try {
      await applyCheckpointDelta(fromIndex, toIndex);
      setRedoSnapshot({ messageHead, headCheckpointId });
      setHeadCheckpointId(targetCheckpointId);
      setMessageHead(nextMessageHead);

      setEditingMessageIndex(null);
      setEditingImageUrls([]);
      setAttachedImages([]);
      setDraftBeforeEdit("");
      setPrompt("");
    } catch (e: any) {
      alert(`Error: ${e?.message || e}`);
    } finally {
      setShowRestoreDialog(false);
      setRestoreToIndex(null);
      setDontAskAgain(false);
    }
  };

  const handleRestoreToMessage = (messageIndex: number) => {
    const skipDialog = localStorage.getItem("checkpoint_dont_ask") === "true";
    if (skipDialog) {
      void performRestoreToMessage(messageIndex);
      return;
    }
    setRestoreToIndex(messageIndex);
    setShowRestoreDialog(true);
  };

  const redoCheckpoint = async () => {
    if (!redoSnapshot) return;
    const fromIndex = findCheckpointIndexById(headCheckpointId);
    const toIndex = findCheckpointIndexById(redoSnapshot.headCheckpointId);
    try {
      await applyCheckpointDelta(fromIndex, toIndex);
      setHeadCheckpointId(redoSnapshot.headCheckpointId);
      setMessageHead(redoSnapshot.messageHead);
      setRedoSnapshot(null);
    } catch (e: any) {
      alert(`Error: ${e?.message || e}`);
    }
  };

  // 復元を確定
  const confirmRestore = async () => {
    if (dontAskAgain) {
      localStorage.setItem("checkpoint_dont_ask", "true");
    }
    if (restoreToIndex !== null) {
      await performRestoreToMessage(restoreToIndex);
    }
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
    const current = availableModels.find(m => m.id === selectedModel);
    const modelName = current ? current.name : selectedModel;
    // Use Multiple Models takes priority
    if (useMultipleModels && selectedModels.length > 0) {
      const modelNames = selectedModels
        .map(id => availableModels.find(m => m.id === id)?.name)
        .filter(Boolean)
        .join(", ");
      return modelNames;
    }
    return modelName;
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

  // セッションを削除
  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    
    // メッセージを先に削除
    await supabase.from("chat_messages").delete().eq("session_id", sessionId);
    // セッションを削除
    await supabase.from("chat_sessions").delete().eq("id", sessionId);
    
    // ローカル状態を更新
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setOpenTabs(prev => prev.filter(t => t.id !== sessionId));
    
    // 現在のセッションが削除された場合
    if (currentSessionId === sessionId) {
      handleNewChat();
    }
  };

  // セッション名を変更開始
  const startEditSession = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  // セッション名を保存
  const saveSessionTitle = async (sessionId: string) => {
    if (!editingTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    
    await supabase
      .from("chat_sessions")
      .update({ title: editingTitle.trim() })
      .eq("id", sessionId);
    
    // ローカル状態を更新
    setSessions(prev => prev.map(s => 
      s.id === sessionId ? { ...s, title: editingTitle.trim() } : s
    ));
    setOpenTabs(prev => prev.map(t => 
      t.id === sessionId ? { ...t, title: editingTitle.trim() } : t
    ));
    
    setEditingSessionId(null);
  };

  // 日付でセッションをグループ化
  const groupSessionsByDate = (sessions: ChatSession[]) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const groups: { label: string; sessions: ChatSession[] }[] = [
      { label: "Today", sessions: [] },
      { label: "Yesterday", sessions: [] },
      { label: "Previous", sessions: [] },
    ];
    
    sessions.forEach(s => {
      const date = new Date(s.created_at);
      date.setHours(0, 0, 0, 0);
      
      if (date.getTime() >= today.getTime()) {
        groups[0].sessions.push(s);
      } else if (date.getTime() >= yesterday.getTime()) {
        groups[1].sessions.push(s);
      } else {
        groups[2].sessions.push(s);
      }
    });
    
    return groups.filter(g => g.sessions.length > 0);
  };

  // フィルタリングされたセッション
  const filteredSessions = historySearchQuery
    ? sessions.filter(s => s.title.toLowerCase().includes(historySearchQuery.toLowerCase()))
    : sessions;
  
  const groupedSessions = groupSessionsByDate(filteredSessions);

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

  const getSubmitButtonStyles = (m: "agent" | "plan" | "ask", hasContent: boolean) => {
      // 入力がない時は薄い色で無効化
      if (!hasContent) {
          switch (m) {
              case "ask": return "bg-[#2F8132]/40 text-white/60 cursor-not-allowed"; // Light green
              case "plan": return "bg-[#B95D00]/40 text-white/60 cursor-not-allowed"; // Light brown
              default: return "bg-black/30 text-white/60 cursor-not-allowed"; // Light black (Agent)
          }
      }
      // 入力がある時は通常の色
      switch (m) {
          case "ask": return "bg-[#2F8132] text-white hover:bg-[#266A29] shadow-sm"; // Green
          case "plan": return "bg-[#B95D00] text-white hover:bg-[#A05300] shadow-sm"; // Brown/Orange
          default: return "bg-black text-white hover:bg-zinc-800 shadow-sm"; // Black (Agent)
      }
  };

  const getModeIcon = (m: "agent" | "plan" | "ask", className?: string) => {
    switch (m) {
      case "plan": return <Icons.Plan className={className} />;
      case "ask": return <Icons.Ask className={className} />;
      default: return <Icons.Agent className={className} />;
    }
  };

  const safeJSONStringify = (value: any) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const getToolIcon = (toolName: string, className?: string) => {
    switch (toolName) {
      case "web_search":
        return <Icons.Globe className={className} />;
      case "grep":
      case "codebase_search":
      case "file_search":
        return <Icons.Search className={className} />;
      case "list_directory":
      case "list_files":
        return <Icons.Explorer className={className} />;
      case "create_file":
      case "update_file":
      case "delete_file":
      case "edit_file":
      case "create_folder":
      case "read_file":
      default:
        return <Icons.File className={className} />;
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
                    <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-zinc-200 rounded-lg shadow-lg z-50 max-h-[500px] overflow-hidden flex flex-col">
                        {/* Search Box */}
                        <div className="p-2 border-b border-zinc-100">
                          <input
                            type="text"
                            placeholder="Search..."
                            value={historySearchQuery}
                            onChange={(e) => setHistorySearchQuery(e.target.value)}
                            className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded-md focus:outline-none focus:border-zinc-300 placeholder:text-zinc-400"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        
                        {/* Sessions List */}
                        <div className="flex-1 overflow-y-auto">
                          {groupedSessions.map(group => (
                            <div key={group.label}>
                              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase bg-zinc-50 sticky top-0">
                                {group.label}
                              </div>
                              {group.sessions.map(s => {
                                const isCurrent = s.id === currentSessionId;
                                const isEditing = editingSessionId === s.id;
                                
                                return (
                                  <div
                                    key={s.id}
                                    onClick={() => !isEditing && openSession(s)}
                                    className={`group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-50 ${isCurrent ? "bg-zinc-50" : ""}`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <Icons.Chat className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                                      {isEditing ? (
                                        <input
                                          type="text"
                                          value={editingTitle}
                                          onChange={(e) => setEditingTitle(e.target.value)}
                                          onBlur={() => saveSessionTitle(s.id)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") saveSessionTitle(s.id);
                                            if (e.key === "Escape") setEditingSessionId(null);
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          className="flex-1 px-1 py-0.5 text-xs bg-white border border-zinc-300 rounded focus:outline-none focus:border-blue-500"
                                          autoFocus
                                        />
                                      ) : (
                                        <span className="text-xs text-zinc-700 truncate">{s.title}</span>
                                      )}
                                    </div>
                                    
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      {isCurrent && !isEditing && (
                                        <span className="text-[10px] text-zinc-400 mr-1">Current</span>
                                      )}
                                      {!isEditing && (
                                        <>
                                          <button
                                            onClick={(e) => startEditSession(e, s)}
                                            className="p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Rename"
                                          >
                                            <Icons.Pencil className="w-3 h-3" />
                                          </button>
                                          <button
                                            onClick={(e) => deleteSession(e, s.id)}
                                            className="p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Delete"
                                          >
                                            <Icons.Trash className="w-3 h-3" />
                                          </button>
                                        </>
                                      )}
                                      {isEditing && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); saveSessionTitle(s.id); }}
                                          className="p-1 hover:bg-zinc-200 rounded text-green-500"
                                          title="Save"
                                        >
                                          <Icons.Check className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                          {filteredSessions.length === 0 && (
                            <div className="px-3 py-4 text-xs text-zinc-400 text-center">
                              No chats found
                            </div>
                          )}
                        </div>
                    </div>
                )}
            </div>
            {/* Removed: More options (three dots) */}
        </div>
      </div>

      {/* New Chat Initial UI - 入力欄が上、Past Chatsが下 */}
      {(!currentSessionId || currentSessionId?.startsWith("new-")) && messages.length === 0 ? (
        <div className="flex-1 flex flex-col justify-between">
          {/* Top Input Area */}
          <div className="px-3 pt-4">
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

              {/* Editing Banner (Cursor-like) */}
              {editingMessageIndex !== null && (
                <div className="flex items-center justify-between px-4 pt-3 pb-1 text-[11px] text-zinc-500">
                  <div className="flex items-center gap-2">
                    <Icons.Restore className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Editing a previous message</span>
                  </div>
                  <button
                    onClick={cancelEditingMessage}
                    className="text-zinc-400 hover:text-zinc-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Attached Images Preview - テキストエリアの上部 */}
              {(attachedImages.length > 0 || (editingMessageIndex !== null && editingImageUrls.length > 0)) && (
                <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto no-scrollbar">
                  {editingMessageIndex !== null && editingImageUrls.map((url, index) => (
                    <div key={`edit-url-${index}`} className="relative flex-shrink-0">
                      <img 
                        src={url} 
                        alt={`Attached ${index + 1}`}
                        className="h-14 w-14 object-cover rounded-lg border border-zinc-200"
                      />
                      <button
                        onClick={() => setEditingImageUrls(prev => prev.filter((_, i) => i !== index))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full flex items-center justify-center text-[10px]"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {attachedImages.map((img, index) => (
                    <div key={`new-${index}`} className="relative flex-shrink-0">
                      <img 
                        src={img.preview} 
                        alt={`New ${index + 1}`} 
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
              
              <div className="flex items-center justify-between px-2 pr-3 py-1.5 border-t border-zinc-100 bg-zinc-50/30 rounded-b-xl">
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
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 flex items-center justify-between group ${isSelected ? "bg-zinc-50" : ""}`}
                                    >
                                    <div className="flex items-center gap-2">
                                        {/* Use Multiple Models takes priority (purple checkbox) */}
                                        {useMultipleModels ? (
                                          <>
                                            <div className={`w-4 h-4 flex items-center justify-center rounded border ${isSelected ? "bg-purple-600 border-purple-600" : "border-zinc-300 bg-white"}`}>
                                              {isSelected && <Icons.Check className="w-3 h-3 text-white" />}
                                            </div>
                                            <span className="text-zinc-700">{model.name}</span>
                                            <Icons.Brain className="w-3.5 h-3.5 text-zinc-400" />
                                          </>
                                        ) : maxMode ? (
                                          /* MAX Mode only: brain icon style */
                                          <>
                                            <span className="text-zinc-700">{model.name}</span>
                                            <Icons.Brain className="w-3.5 h-3.5 text-zinc-400" />
                                          </>
                                        ) : (
                                          /* Normal mode: brain icon with checkmark on right */
                                          <>
                                            <span className="text-zinc-700">{model.name}</span>
                                            <Icons.Brain className="w-3.5 h-3.5 text-zinc-400" />
                                          </>
                                        )}
                                    </div>
                                    {/* MAX Mode only (not multiple): checkmark on right */}
                                    {maxMode && !useMultipleModels && isSelected && (
                                        <Icons.Check className="w-4 h-4 text-zinc-600" />
                                    )}
                                    {/* Normal mode: checkmark on right */}
                                    {!maxMode && !useMultipleModels && isSelected && (
                                        <Icons.Check className="w-4 h-4 text-zinc-600" />
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

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button className="p-1.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600 transition-colors">
                    <span className="text-xs">@</span>
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
                  <button
                    onClick={() => submitCurrent()}
                    disabled={loading || (!prompt.trim() && attachedImages.length === 0 && (editingMessageIndex === null || editingImageUrls.length === 0))}
                    className={`p-1.5 rounded-full transition-all flex-shrink-0 flex items-center justify-center ${getSubmitButtonStyles(mode, prompt.trim().length > 0 || attachedImages.length > 0 || (editingMessageIndex !== null && editingImageUrls.length > 0))}`}
                  >
                    <Icons.ArrowUp className="w-3.5 h-3.5" />
                  </button>
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

        {redoSnapshot && (
          <button
            onClick={() => void redoCheckpoint()}
            className="flex items-center gap-2 px-1 text-xs text-zinc-400 hover:text-zinc-600 transition-colors w-fit"
          >
            <Icons.Restore className="w-3.5 h-3.5 text-zinc-400" />
            <span>Redo checkpoint</span>
          </button>
        )}
        
        {messages.map((msg, idx) => {
          const activeHead = messageHead ?? messages.length;
          const isFuture = messageHead !== null && idx >= messageHead;
          const canRestore = !isFuture && idx < activeHead - 1;
          const codeBlock = msg.role === "assistant" ? extractCodeBlock(msg.content) : null;
          const isThoughtExpanded = expandedThoughts[msg.id];
          
          if (msg.role === "user") {
              const hasCheckpoint = checkpoints.some((cp) => cp.anchorMessageId === msg.id);
              
              return (
                  <div key={msg.id} className={`group flex items-start justify-between gap-2 px-1 ${isFuture ? "opacity-50" : ""}`}>
                     <div className="flex flex-col gap-2 flex-1">
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
                         <div
                           role="button"
                           tabIndex={0}
                           onClick={() => {
                             if (isFuture) return;
                             startEditingMessage(idx);
                           }}
                           onKeyDown={(e) => {
                             if (isFuture) return;
                             if (e.key === "Enter" || e.key === " ") {
                               e.preventDefault();
                               startEditingMessage(idx);
                             }
                           }}
                           className={`text-[14px] font-normal text-zinc-900 leading-relaxed whitespace-pre-wrap rounded-md px-1 -mx-1 transition-colors outline-none focus:ring-2 focus:ring-green-200 ${
                             isFuture ? "cursor-default" : "cursor-pointer hover:bg-zinc-50"
                           }`}
                           title="Click to edit"
                         >
                           {msg.content}
                         </div>
                       )}
                     </div>
                     
                     <div className="flex flex-col items-end gap-1 flex-shrink-0">
                       {hasCheckpoint && (
                         <button
                           onClick={() => handleRestoreToMessage(idx)}
                           disabled={isFuture}
                           className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                             isFuture
                               ? "border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed"
                               : "border-zinc-200 bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                           }`}
                         >
                           Restore checkpoint
                         </button>
                       )}

                       {/* + Button - hover restore */}
                       {canRestore && (
                         <button
                           onClick={() => handleRestoreToMessage(idx)}
                           className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                           title="Restore to this point"
                         >
                           <Icons.Plus className="w-4 h-4" />
                         </button>
                       )}
                     </div>
                  </div>
              )
          }

          return (
            <div key={msg.id} className={`group relative flex flex-col gap-1 ${isFuture ? "opacity-50" : ""}`}>
               {canRestore && (
                 <button
                   onClick={() => handleRestoreToMessage(idx)}
                   className="absolute top-0 right-0 p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                   title="Restore to this point"
                 >
                   <Icons.Plus className="w-4 h-4" />
                 </button>
               )}
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

               {/* Tool Calls (Cursor-like) */}
               {msg.toolCalls && msg.toolCalls.length > 0 && (
                 <div className="mt-2 space-y-2">
                   {msg.toolCalls.map((tc, i) => {
                     const hasError = Boolean(tc?.result?.error);
                     return (
                       <details
                         key={`${msg.id}-tool-${i}`}
                         className="rounded-lg border border-zinc-200 bg-zinc-50 overflow-hidden"
                       >
                         <summary className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-zinc-600 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                           <div className="flex items-center gap-2 min-w-0">
                             {getToolIcon(tc.tool, "w-3.5 h-3.5 text-zinc-500")}
                             <span className="font-medium truncate">{tc.tool}</span>
                             <span className={`text-[10px] font-semibold ${hasError ? "text-red-500" : "text-green-600"}`}>
                               {hasError ? "Error" : "Success"}
                             </span>
                           </div>
                           <Icons.ChevronDown className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                         </summary>
                         <div className="px-3 pb-3 pt-1 text-xs text-zinc-700 space-y-2">
                           <div>
                             <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Args</div>
                             <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-white border border-zinc-200 p-2 text-[11px] leading-snug text-zinc-700 overflow-x-auto">{safeJSONStringify(tc?.args)}</pre>
                           </div>
                           <div>
                             <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Result</div>
                             <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-white border border-zinc-200 p-2 text-[11px] leading-snug text-zinc-700 overflow-x-auto">{safeJSONStringify(tc?.result)}</pre>
                           </div>
                         </div>
                       </details>
                     );
                   })}
                 </div>
               )}

               <div className="text-[14px] leading-relaxed text-zinc-800">
                  <ChatMarkdown content={msg.content} />
                    {codeBlock && !msg.isError && (
                      <div className="flex gap-2 mt-3 mb-1">
                        <button 
                          onClick={() => {
                            if (onRequestReview) {
                              const activeNode = nodes.find(n => n.id === msg.id) || nodes[0];
                              const change: PendingChange = {
                                id: activeNode?.id || Date.now().toString(),
                                filePath: activeNode?.name || "untitled",
                                fileName: activeNode?.name || "untitled",
                                oldContent: currentFileText,
                                newContent: codeBlock,
                                action: "update",
                                status: "pending",
                              };
                              onRequestReview([change]);
                            } else {
                              onRequestDiff(codeBlock);
                            }
                          }} 
                          className="flex items-center gap-1.5 text-xs font-medium bg-green-50 hover:bg-green-100 text-green-600 border border-green-200 rounded px-2 py-1 transition-colors"
                        >
                          <Icons.Review className="w-3.5 h-3.5" />
                          Review
                        </button>
                        <button onClick={() => onRequestDiff(codeBlock)} className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded px-2 py-1 transition-colors">Apply</button>
                        <button onClick={() => onAppend(codeBlock)} className="text-xs font-medium bg-zinc-50 hover:bg-zinc-100 text-zinc-600 border border-zinc-200 rounded px-2 py-1 transition-colors">Append</button>
                      </div>
                    )}
               </div>
               
               {/* Message Actions - 右下に配置 */}
               <div className="flex items-center justify-end gap-1 mt-1">
                   <button 
                     onClick={() => {
                       navigator.clipboard.writeText(msg.content);
                       setCopiedMessageId(msg.id);
                       setTimeout(() => setCopiedMessageId(null), 2000);
                     }}
                     className={`p-1 hover:bg-zinc-100 rounded transition-colors ${copiedMessageId === msg.id ? "text-green-500" : "text-zinc-400 hover:text-zinc-600"}`}
                     title="Copy to clipboard"
                   >
                       {copiedMessageId === msg.id ? (
                         <Icons.Check className="w-3.5 h-3.5" />
                       ) : (
                         <Icons.Copy className="w-3.5 h-3.5" />
                       )}
                   </button>
                   <div className="relative" ref={openMessageMenu === msg.id ? messageMenuRef : null}>
                     <button 
                       onClick={() => setOpenMessageMenu(openMessageMenu === msg.id ? null : msg.id)}
                       className="p-1 hover:bg-zinc-100 rounded text-zinc-400 hover:text-zinc-600 transition-colors"
                     >
                         <Icons.MoreHorizontal className="w-3.5 h-3.5" />
                     </button>
                     {openMessageMenu === msg.id && (
                       <div className="absolute top-full right-0 mt-1 w-40 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
                         <button
                           onClick={duplicateChat}
                           className="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 flex items-center gap-2"
                         >
                           <Icons.Copy className="w-3.5 h-3.5 text-zinc-400" />
                           <span>Duplicate Chat</span>
                         </button>
                       </div>
                     )}
                   </div>
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
      <div className="absolute bottom-4 left-4 right-4 z-30 flex flex-col gap-3">
        {reviewChanges &&
          reviewChanges.length > 0 &&
          onReviewSelectFile &&
          onReviewAcceptAll &&
          onReviewRejectAll && (
            <ReviewChangesCard
              changes={reviewChanges}
              onSelectFile={onReviewSelectFile}
              onSelectIssue={onReviewSelectIssue}
              onAcceptAll={onReviewAcceptAll}
              onRejectAll={onReviewRejectAll}
              onFindIssues={onReviewFindIssues}
              isFindingIssues={isFindingReviewIssues}
              issues={reviewIssues}
              onFixIssue={onReviewFixIssueInChat}
              onDismissIssue={onReviewDismissIssue}
              onFixAllIssues={onReviewFixAllIssuesInChat}
            />
          )}
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

          {/* Editing Banner (Cursor-like) */}
          {editingMessageIndex !== null && (
            <div className="flex items-center justify-between px-4 pt-3 pb-1 text-[11px] text-zinc-500">
              <div className="flex items-center gap-2">
                <Icons.Restore className="w-3.5 h-3.5 text-zinc-400" />
                <span>Editing a previous message</span>
              </div>
              <button
                onClick={cancelEditingMessage}
                className="text-zinc-400 hover:text-zinc-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Attached Images Preview - テキストエリアの上部 */}
          {(attachedImages.length > 0 || (editingMessageIndex !== null && editingImageUrls.length > 0)) && (
            <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto no-scrollbar">
              {editingMessageIndex !== null && editingImageUrls.map((url, index) => (
                <div key={`edit-url-${index}`} className="relative flex-shrink-0">
                  <img 
                    src={url} 
                    alt={`Attached ${index + 1}`}
                    className="h-14 w-14 object-cover rounded-lg border border-zinc-200"
                  />
                  <button
                    onClick={() => setEditingImageUrls(prev => prev.filter((_, i) => i !== index))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full flex items-center justify-center text-[10px]"
                  >
                    ×
                  </button>
                </div>
              ))}
              {attachedImages.map((img, index) => (
                <div key={`new-${index}`} className="relative flex-shrink-0">
                  <img 
                    src={img.preview} 
                    alt={`New ${index + 1}`} 
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
            className={`w-full max-h-60 bg-transparent px-4 py-3 text-sm text-zinc-800 resize-none focus:outline-none placeholder:text-zinc-400 min-h-[44px] ${(attachedImages.length > 0 || (editingMessageIndex !== null && editingImageUrls.length > 0)) ? "" : "rounded-t-xl"}`}
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Add a follow-up"
            rows={1}
            disabled={loading}
          />
          
          <div className="flex items-center justify-between px-2 pr-3 py-1.5 border-t border-zinc-100 bg-zinc-50/30 rounded-b-xl">
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
                    className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded px-2 py-1 transition-colors min-w-[100px]"
                  >
                    <span>{getModelDisplay()}</span>
                    <Icons.ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                  
                  {isModelDropdownOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-72 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-[500px] overflow-y-auto">
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
                                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 flex items-center justify-between group ${isSelected ? "bg-zinc-50" : ""}`}
                                >
                                  <div className="flex items-center gap-2">
                                    {/* Use Multiple Models takes priority (purple checkbox) */}
                                    {useMultipleModels ? (
                                      <>
                                        <div className={`w-4 h-4 flex items-center justify-center rounded border ${isSelected ? "bg-purple-600 border-purple-600" : "border-zinc-300 bg-white"}`}>
                                          {isSelected && <Icons.Check className="w-3 h-3 text-white" />}
                                        </div>
                                        <span className="text-zinc-700">{model.name}</span>
                                        <Icons.Brain className="w-3.5 h-3.5 text-zinc-400" />
                                      </>
                                    ) : maxMode ? (
                                      /* MAX Mode only: brain icon style */
                                      <>
                                        <span className="text-zinc-700">{model.name}</span>
                                        <Icons.Brain className="w-3.5 h-3.5 text-zinc-400" />
                                      </>
                                    ) : (
                                      /* Normal mode: brain icon with checkmark on right */
                                      <>
                                        <span className="text-zinc-700">{model.name}</span>
                                        <Icons.Brain className="w-3.5 h-3.5 text-zinc-400" />
                                      </>
                                    )}
                                  </div>
                                  {/* MAX Mode only (not multiple): checkmark on right */}
                                  {maxMode && !useMultipleModels && isSelected && (
                                    <Icons.Check className="w-4 h-4 text-zinc-600" />
                                  )}
                                  {/* Normal mode: checkmark on right */}
                                  {!maxMode && !useMultipleModels && isSelected && (
                                    <Icons.Check className="w-4 h-4 text-zinc-600" />
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
                {loading ? (
                    <button
                        onClick={handleStop}
                        className="ml-1 p-1.5 rounded-full transition-all flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-zinc-600 border border-zinc-200"
                    >
                        <Icons.Stop className="w-3.5 h-3.5" />
                    </button>
                ) : (
                    <button
                      onClick={() => submitCurrent()}
                      disabled={loading || (!prompt.trim() && attachedImages.length === 0 && (editingMessageIndex === null || editingImageUrls.length === 0))}
                      className={`p-1.5 rounded-full transition-all flex-shrink-0 flex items-center justify-center ${getSubmitButtonStyles(mode, prompt.trim().length > 0 || attachedImages.length > 0 || (editingMessageIndex !== null && editingImageUrls.length > 0))}`}
                    >
                      <Icons.ArrowUp className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
          </div>
        </div>
      </div>
        </>
      )}
      
      {/* Restore Checkpoint Confirmation Dialog */}
      {showRestoreDialog && restoreToIndex !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1e2028] rounded-lg shadow-2xl w-[420px] overflow-hidden">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center">
                  <Icons.Warning className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-medium text-sm">
                    Discard all changes up to this checkpoint?
                  </h3>
                  <p className="text-zinc-400 text-xs mt-1">
                    You can always undo this later.
                  </p>
                </div>
              </div>
              
              <div className="mt-4 flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="dontAskAgain"
                  checked={dontAskAgain}
                  onChange={(e) => setDontAskAgain(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                />
                <label htmlFor="dontAskAgain" className="text-zinc-400 text-xs">
                  Don't ask again
                </label>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[#16181d] border-t border-zinc-800">
              <button
                onClick={() => {
                  setShowRestoreDialog(false);
                  setRestoreToIndex(null);
                }}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel (esc)
              </button>
              <button
                onClick={confirmRestore}
                className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors flex items-center gap-1.5"
              >
                Continue
                <Icons.Restore className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit from Previous Message Dialog (Cursor-like) */}
      {showSubmitPrevDialog && editingMessageIndex !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1e2028] rounded-lg shadow-2xl w-[520px] overflow-hidden">
            <div className="p-5">
              <h3 className="text-white font-medium text-sm">
                Submit from a previous message?
              </h3>
              <p className="text-zinc-400 text-xs mt-2 leading-relaxed">
                Submitting from a previous message will revert file changes to before this message and clear the messages after this one.
              </p>

              <div className="mt-4 flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="submitPrevDontAskAgain"
                  checked={submitPrevDontAskAgain}
                  onChange={(e) => setSubmitPrevDontAskAgain(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-700 text-blue-500 focus:ring-0 focus:ring-offset-0"
                />
                <label htmlFor="submitPrevDontAskAgain" className="text-zinc-400 text-xs">
                  Don't ask again
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[#16181d] border-t border-zinc-800">
              <button
                onClick={() => {
                  setShowSubmitPrevDialog(false);
                  setSubmitPrevDontAskAgain(false);
                }}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel (esc)
              </button>

              <button
                onClick={() => {
                  if (submitPrevDontAskAgain) {
                    localStorage.setItem("submit_prev_dont_ask", "true");
                    localStorage.setItem("submit_prev_default_action", "no_revert");
                  }
                  setShowSubmitPrevDialog(false);
                  void submitFromPreviousMessage({ revert: false });
                }}
                className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors"
              >
                Continue without reverting
              </button>

              <button
                onClick={() => {
                  if (submitPrevDontAskAgain) {
                    localStorage.setItem("submit_prev_dont_ask", "true");
                    localStorage.setItem("submit_prev_default_action", "revert");
                  }
                  setShowSubmitPrevDialog(false);
                  void submitFromPreviousMessage({ revert: true });
                }}
                className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors flex items-center gap-1.5"
              >
                Continue and revert
                <Icons.Restore className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

AiPanel.displayName = "AiPanel";

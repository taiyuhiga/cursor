"use client";

import { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle, useCallback } from "react";
import { Icons } from "./Icons";
import { getFileIcon, FileIcons } from "./fileIcons";
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
  durationMs?: number;
};

type ThoughtTraceStep = {
  type: "thought" | "tool";
  durationMs?: number;
  tool?: string;
  args?: any;
  status?: "success" | "error";
  command?: string;
  output?: string;
};

type DirectoryEntry = {
  name?: string;
  type?: "file" | "folder" | string;
};

type FileListEntry = {
  path?: string;
  name?: string;
};

type GrepResultEntry = {
  path?: string;
  lineNumber?: number | string;
  line?: string;
};

type SearchResultEntry = {
  path?: string;
  relevantSnippet?: string;
};

type WebSearchResultEntry = {
  title?: string;
  url?: string;
  snippet?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  isPending?: boolean;
  created_at?: string;
  images?: string[]; // Base64 画像の配列
  toolCalls?: ToolCall[]; // AIが使用したツール呼び出し
  thoughtTrace?: ThoughtTraceStep[];
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
  onHoverNode?: (nodeId: string) => void;

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
  addCodeContext: (fileName: string, lineStart: number, lineEnd: number, content: string) => void;
};

const DEFAULT_MODELS: ModelConfig[] = [
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", provider: "google", enabled: true },
  { id: "claude-opus-4-5-20251101", name: "Opus 4.5", provider: "anthropic", enabled: true },
  { id: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5", provider: "anthropic", enabled: true },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", enabled: true },
  { id: "gpt-5.2-extra-high", name: "GPT-5.2 Extra High", provider: "openai", enabled: true },
];

const THOUGHT_TRACE_STORAGE_PREFIX = "cursor_thought_trace:";

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
  onHoverNode,
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  // Tab Management
  const [openTabs, setOpenTabs] = useState<ChatSession[]>([]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);
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

  // Input segments - mixed text, file references, and code selections (inline)
  type InputSegment =
    | { type: 'text'; content: string }
    | { type: 'file'; id: string; name: string; fileType: 'file' | 'folder' }
    | { type: 'code'; id: string; fileName: string; lineStart: number; lineEnd: number; content: string };
  const [inputSegments, setInputSegments] = useState<InputSegment[]>([]);
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const isInputFromUserRef = useRef(false); // Track if change came from user input
  const lastSegmentsRef = useRef<InputSegment[]>([]); // Track last rendered segments

  const ZERO_WIDTH_SPACE = "\u200B";
  const ZERO_WIDTH_SPACE_REGEX = /\u200B/g;

  // Helper: Get plain text from segments (removes zero-width spaces used for cursor positioning)
  const getTextFromSegments = (segments: InputSegment[]): string => {
    return segments.map(s => {
      if (s.type === 'text') return s.content.replace(ZERO_WIDTH_SPACE_REGEX, "");
      if (s.type === 'file') return `@${s.name}`;
      if (s.type === 'code') return `@${s.fileName}:${s.lineStart}-${s.lineEnd}`;
      return '';
    }).join('');
  };

  // Helper: Get file references from segments
  const getFilesFromSegments = (segments: InputSegment[]): { id: string; name: string; type: 'file' | 'folder' }[] => {
    return segments.filter((s): s is Extract<InputSegment, { type: 'file' }> => s.type === 'file')
      .map(s => ({ id: s.id, name: s.name, type: s.fileType }));
  };

  // Helper: Get code selections from segments
  const getCodeSelectionsFromSegments = (segments: InputSegment[]): { fileName: string; lineStart: number; lineEnd: number; content: string }[] => {
    return segments.filter((s): s is Extract<InputSegment, { type: 'code' }> => s.type === 'code')
      .map(s => ({ fileName: s.fileName, lineStart: s.lineStart, lineEnd: s.lineEnd, content: s.content }));
  };

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
      const enabled = parsed.filter((m: ModelConfig) => m.enabled);
      setAvailableModels(enabled.length > 0 ? enabled : DEFAULT_MODELS);
      if (enabled.length > 0 && !enabled.find((m: ModelConfig) => m.id === selectedModel)) {
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

  const getThoughtTraceKey = (messageId: string) => `${THOUGHT_TRACE_STORAGE_PREFIX}${messageId}`;

  const loadStoredThoughtTrace = (messageId: string): ThoughtTraceStep[] | undefined => {
    if (typeof window === "undefined") return undefined;
    const raw = localStorage.getItem(getThoughtTraceKey(messageId));
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return undefined;
      return parsed as ThoughtTraceStep[];
    } catch {
      return undefined;
    }
  };

  const storeThoughtTrace = (messageId: string, trace?: ThoughtTraceStep[]) => {
    if (typeof window === "undefined") return;
    if (!trace || trace.length === 0) return;
    try {
      localStorage.setItem(getThoughtTraceKey(messageId), JSON.stringify(trace));
    } catch {
      // Ignore storage quota errors.
    }
  };

  // Load messages for current session
  useEffect(() => {
    async function loadMessages() {
      // 送信中は楽観的更新を上書きしない
      if (isSubmittingRef.current) {
        return;
      }
      setPendingAssistantId(null);
      
      // 一時的なタブID（new-で始まる）またはnullの場合はメッセージをクリア
      if (!currentSessionId || currentSessionId.startsWith("new-")) {
        setMessages([]);
        setMessageHead(null);
        setCheckpoints([]);
        setHeadCheckpointId(null);
        setRedoSnapshot(null);
        setShowRestoreDialog(false);
        setRestoreToIndex(null);
        setDontAskAgain(false);
        return;
      }

      const persisted = loadCheckpointState(currentSessionId) ?? makeEmptyCheckpointState({ projectId, sessionId: currentSessionId });
      setCheckpoints(persisted.checkpoints || []);
      setHeadCheckpointId(persisted.headCheckpointId ?? null);
      setRedoSnapshot(null);
      setShowRestoreDialog(false);
      setRestoreToIndex(null);
      setDontAskAgain(false);

      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", currentSessionId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        const updates: Array<{ id: string; trace: ThoughtTraceStep[] }> = [];
        const loaded: Message[] = [];

        for (let i = 0; i < data.length; i++) {
          const m = data[i];
          const dbTrace = Array.isArray(m.thought_trace) ? (m.thought_trace as ThoughtTraceStep[]) : undefined;
          const storedTrace = dbTrace ?? loadStoredThoughtTrace(m.id);
          let thoughtTrace = storedTrace;

          const message: Message = {
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            created_at: m.created_at,
            images: m.images || undefined,
          };

          if (message.role === "assistant") {
            const previousMessage = loaded[i - 1];
            if (!thoughtTrace || thoughtTrace.length === 0) {
              thoughtTrace = [{ type: "thought", durationMs: estimateThoughtMs(message, previousMessage) }];
            }
            if (!dbTrace && thoughtTrace && thoughtTrace.length > 0) {
              updates.push({ id: message.id, trace: thoughtTrace });
            }
          }

          loaded.push({ ...message, thoughtTrace });
        }

        setMessages(loaded);

        if (updates.length > 0) {
          void Promise.all(
            updates.map((update) =>
              supabase.from("chat_messages").update({ thought_trace: update.trace }).eq("id", update.id)
            )
          );
        }

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

  const saveMessage = async (
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    images?: string[],
    thoughtTrace?: ThoughtTraceStep[]
  ): Promise<string | null> => {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role,
        content,
        images: images || null,
        thought_trace: thoughtTrace ?? null,
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
        setDontAskAgain(false);
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
        setInputSegments(draftBeforeEdit ? [{ type: 'text', content: draftBeforeEdit }] : []);
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

  // Build context from code selections
  const buildContextFromCodeSelections = useCallback((segments: InputSegment[]): string => {
    const codeSelections = getCodeSelectionsFromSegments(segments);
    if (codeSelections.length === 0) return "";

    const contextParts = codeSelections.map(sel => {
      const lineRange = sel.lineStart === sel.lineEnd
        ? `Line ${sel.lineStart}`
        : `Lines ${sel.lineStart}-${sel.lineEnd}`;
      return `--- ${sel.fileName} (${lineRange}) ---\n${sel.content}\n---`;
    });

    return `\n\n[Code Selection Context]\n${contextParts.join("\n\n")}\n\n`;
  }, []);

  const handleStop = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setLoading(false);
    if (pendingAssistantId) {
      setMessages(prev => prev.filter(m => m.id !== pendingAssistantId));
      setPendingAssistantId(null);
    }
  };

  const startEditingMessage = (messageIndex: number) => {
    const msg = messages[messageIndex];
    if (!msg || msg.role !== "user") return;
    if (loading) return;
    setDraftBeforeEdit(getTextFromSegments(inputSegments));
    setEditingMessageIndex(messageIndex);
    setEditingImageUrls(msg.images || []);
    setAttachedImages([]);
    // Set message content as a text segment
    setInputSegments(msg.content ? [{ type: 'text', content: msg.content }] : []);
    setTimeout(() => {
      contentEditableRef.current?.focus();
    }, 0);
  };

  const cancelEditingMessage = () => {
    setEditingMessageIndex(null);
    setEditingImageUrls([]);
    setAttachedImages([]);
    // Restore draft as a text segment
    setInputSegments(draftBeforeEdit ? [{ type: 'text', content: draftBeforeEdit }] : []);
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

    // Get text from inputSegments if no customPrompt
    const promptToSend = customPrompt || getTextFromSegments(inputSegments);
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
    const pendingId = `pending-${Date.now().toString(36)}`;
    setPendingAssistantId(pendingId);
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
        {
          id: pendingId,
          role: "assistant",
          content: "",
          isPending: true,
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
    setInputSegments([]);
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
          setMessages((prev) => prev.filter((m) => m.id !== tempId && m.id !== pendingId));
          setPendingAssistantId(null);
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
      const codeContext = buildContextFromCodeSelections(inputSegments);
      const fullPrompt = fileContext + codeContext + promptToSend;
      const apiKeys = JSON.parse(localStorage.getItem("cursor_api_keys") || "{}");

      // Initialize AbortController
      abortControllerRef.current = new AbortController();
      const requestStartedAt = Date.now();

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
      const responseDurationMs = Date.now() - requestStartedAt;
      
      if (data.error) {
        setMessages(prev =>
          prev.map(m =>
            m.id === pendingId
              ? { ...m, content: `Error: ${data.error}`, isError: true, isPending: false }
              : m
          )
        );
        setPendingAssistantId(null);
      } else if (data.multipleResults) {
        setMessages(prev => prev.filter(m => m.id !== pendingId));
        setPendingAssistantId(null);
        // Multiple Models mode: 複数の結果を表示
        for (const result of data.multipleResults) {
          const modelName = availableModels.find(m => m.id === result.model)?.name || result.model;
          if (result.error) {
            setMessages(prev => [...prev, { 
              id: Date.now().toString() + result.model, 
              role: "assistant", 
              content: `**[${modelName}]** Error: ${result.error}`,
              isError: true,
              thoughtTrace: Array.isArray(result.thoughtTrace) ? result.thoughtTrace : undefined,
            }]);
          } else {
            const tempAssistantId = Date.now().toString() + result.model;
            setMessages(prev => [
              ...prev,
              { 
                id: tempAssistantId, 
                role: "assistant", 
                content: `**[${modelName}]**\n\n${result.content}`,
                thoughtTrace: Array.isArray(result.thoughtTrace) ? result.thoughtTrace : undefined,
              }
            ]);
            const thoughtTrace = Array.isArray(result.thoughtTrace) ? result.thoughtTrace : undefined;
            const savedAssistantId = await saveMessage(activeSessionId, "assistant", `**[${modelName}]**\n\n${result.content}`, undefined, thoughtTrace);
            if (savedAssistantId) {
              setMessages(prev => prev.map(m => m.id === tempAssistantId ? { ...m, id: savedAssistantId } : m));
              if (thoughtTrace) {
                storeThoughtTrace(savedAssistantId, thoughtTrace);
              }
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
        const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : undefined;
        const rawThoughtTrace = Array.isArray(data.thoughtTrace) ? data.thoughtTrace : undefined;
        const thoughtTrace = rawThoughtTrace && rawThoughtTrace.length > 0
          ? rawThoughtTrace
          : [{ type: "thought", durationMs: responseDurationMs }];
        setMessages(prev =>
          prev.map(m =>
            m.id === pendingId
              ? { ...m, content: assistantMsg, toolCalls, thoughtTrace, isPending: false }
              : m
          )
        );
        const savedAssistantMsgId = await saveMessage(activeSessionId, "assistant", assistantMsg, undefined, thoughtTrace);
        const finalAssistantMsgId = savedAssistantMsgId ?? pendingId;
        if (savedAssistantMsgId) {
          setMessages(prev => prev.map(m => m.id === pendingId ? { ...m, id: savedAssistantMsgId } : m));
          storeThoughtTrace(savedAssistantMsgId, thoughtTrace);
        }
        setPendingAssistantId(null);

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
          setMessages(prev =>
            prev.map(m =>
              m.id === pendingId
                ? { ...m, content: `Error: ${error}`, isError: true, isPending: false }
                : m
            )
          );
      }
    } finally {
        setLoading(false);
        abortControllerRef.current = null;
        isSubmittingRef.current = false; // 送信完了
        setPendingAssistantId(null);
    }
  };

  const submitFromPreviousMessage = async (opts: { revert: boolean }) => {
    if (editingMessageIndex === null) return;
    let pendingId: string | null = null;
    if (!currentSessionId || currentSessionId.startsWith("new-")) {
      // New Chat状態では通常送信にフォールバック
      cancelEditingMessage();
      await onSubmit();
      return;
    }

    const target = messages[editingMessageIndex];
    if (!target || target.role !== "user") return;

    const promptToSend = getTextFromSegments(inputSegments);
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
    setInputSegments([]);
      setDraftBeforeEdit("");
      setShowSubmitPrevDialog(false);
      setSubmitPrevDontAskAgain(false);
      setPrompt("");

      pendingId = `pending-${Date.now().toString(36)}`;
      setPendingAssistantId(pendingId);
      setMessages(prev => [
        ...prev,
        {
          id: pendingId!,
          role: "assistant",
          content: "",
          isPending: true,
        },
      ]);

      // Build context
      const fileContext = await buildContextFromMentions(promptToSend);
      const codeContext = buildContextFromCodeSelections(inputSegments);
      const fullPrompt = fileContext + codeContext + promptToSend;
      const apiKeys = JSON.parse(localStorage.getItem("cursor_api_keys") || "{}");

      const requestStartedAt = Date.now();
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
      const responseDurationMs = Date.now() - requestStartedAt;

      if (data.error) {
        setMessages(prev =>
          prev.map(m =>
            m.id === pendingId
              ? { ...m, content: `Error: ${data.error}`, isError: true, isPending: false }
              : m
          )
        );
        setPendingAssistantId(null);
      } else if (data.multipleResults) {
        setMessages(prev => prev.filter(m => m.id !== pendingId));
        setPendingAssistantId(null);
        for (const result of data.multipleResults) {
          const modelName = availableModels.find(m => m.id === result.model)?.name || result.model;
          if (result.error) {
            setMessages(prev => [...prev, { 
              id: Date.now().toString() + result.model, 
              role: "assistant", 
              content: `**[${modelName}]** Error: ${result.error}`,
              isError: true,
              thoughtTrace: Array.isArray(result.thoughtTrace) ? result.thoughtTrace : undefined,
            }]);
          } else {
            const tempAssistantId = Date.now().toString() + result.model;
            setMessages(prev => [
              ...prev,
              { 
                id: tempAssistantId, 
                role: "assistant", 
                content: `**[${modelName}]**\n\n${result.content}`,
                thoughtTrace: Array.isArray(result.thoughtTrace) ? result.thoughtTrace : undefined,
              }
            ]);
            const thoughtTrace = Array.isArray(result.thoughtTrace) ? result.thoughtTrace : undefined;
            const savedAssistantId = await saveMessage(activeSessionId, "assistant", `**[${modelName}]**\n\n${result.content}`, undefined, thoughtTrace);
            if (savedAssistantId) {
              setMessages(prev => prev.map(m => m.id === tempAssistantId ? { ...m, id: savedAssistantId } : m));
              if (thoughtTrace) {
                storeThoughtTrace(savedAssistantId, thoughtTrace);
              }
            }
          }
        }
      } else {
        const usedModelName = data.usedModel 
          ? (availableModels.find(m => m.id === data.usedModel)?.name || data.usedModel)
          : null;
        const prefix = autoMode && usedModelName ? `*[Auto: ${usedModelName}]*\n\n` : "";
        const assistantMsg = prefix + data.content;
        const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : undefined;
        const rawThoughtTrace = Array.isArray(data.thoughtTrace) ? data.thoughtTrace : undefined;
        const thoughtTrace = rawThoughtTrace && rawThoughtTrace.length > 0
          ? rawThoughtTrace
          : [{ type: "thought", durationMs: responseDurationMs }];

        setMessages(prev =>
          prev.map(m =>
            m.id === pendingId
              ? { ...m, content: assistantMsg, toolCalls, thoughtTrace, isPending: false }
              : m
          )
        );
        const savedAssistantMsgId = await saveMessage(activeSessionId, "assistant", assistantMsg, undefined, thoughtTrace);
        const finalAssistantMsgId = savedAssistantMsgId ?? pendingId;
        if (savedAssistantMsgId) {
          setMessages(prev => prev.map(m => m.id === pendingId ? { ...m, id: savedAssistantMsgId } : m));
          storeThoughtTrace(savedAssistantMsgId, thoughtTrace);
        }
        setPendingAssistantId(null);

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
        if (pendingId) {
          setMessages(prev =>
            prev.map(m =>
              m.id === pendingId
                ? { ...m, content: `Error: ${error}`, isError: true, isPending: false }
                : m
            )
          );
        } else {
          setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: `Error: ${error}`, isError: true }]);
        }
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      isSubmittingRef.current = false;
      setPendingAssistantId(null);
    }
  };

  const submitCurrent = () => {
    if (editingMessageIndex !== null) {
      const hasEditContent = inputSegments.length > 0 || attachedImages.length > 0 || editingImageUrls.length > 0;
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

  const insertFileReference = (file: { id: string; name: string; type: 'file' | 'folder' }) => {
    // Insert file as a segment
    insertFileSegment(file);
    setShowFilesPopup(false);
    setFilesSearchQuery("");
    setAtSymbolPosition(null);
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
        insertFileReference(filteredFiles[selectedFileIndex]);
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

  // Contenteditable input handler - sync DOM to state
  const handleContentEditableInput = () => {
    const el = contentEditableRef.current;
    if (!el) return;

    const newSegments: InputSegment[] = [];
    el.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || "").replace(ZERO_WIDTH_SPACE_REGEX, "");
        if (text) {
          newSegments.push({ type: 'text', content: text });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        if (element.dataset.fileId) {
          newSegments.push({
            type: 'file',
            id: element.dataset.fileId,
            name: element.dataset.fileName || '',
            fileType: (element.dataset.fileType as 'file' | 'folder') || 'file'
          });
        } else if (element.dataset.codeId) {
          // Parse code segment - find the stored content
          const existingCode = inputSegments.find(s =>
            s.type === 'code' && s.id === element.dataset.codeId
          ) as Extract<InputSegment, { type: 'code' }> | undefined;
          if (existingCode) {
            newSegments.push({
              type: 'code',
              id: element.dataset.codeId,
              fileName: element.dataset.fileName || existingCode.fileName,
              lineStart: parseInt(element.dataset.lineStart || '0', 10) || existingCode.lineStart,
              lineEnd: parseInt(element.dataset.lineEnd || '0', 10) || existingCode.lineEnd,
              content: existingCode.content
            });
          }
        }
      }
    });

    // Consolidate consecutive text segments
    const consolidated: InputSegment[] = [];
    for (const seg of newSegments) {
      if (seg.type === 'text' && consolidated.length > 0) {
        const last = consolidated[consolidated.length - 1];
        if (last.type === 'text') {
          last.content += seg.content;
          continue;
        }
      }
      consolidated.push(seg);
    }

    // Mark this as user input so we don't re-render
    isInputFromUserRef.current = true;
    lastSegmentsRef.current = consolidated;
    setInputSegments(consolidated);
  };

  // Sync contenteditable DOM when segments change from external sources
  useEffect(() => {
    if (isInputFromUserRef.current) {
      // Change came from user input, don't update DOM (would reset cursor)
      isInputFromUserRef.current = false;
      return;
    }

    // Only update if the contenteditable exists and segments have file elements
    const el = contentEditableRef.current;
    if (!el) return;

    // Check if we actually need to update (different from last rendered)
    const currentHTML = el.innerHTML;
    const newHTML = renderSegmentsToHTML(inputSegments);
    if (currentHTML !== newHTML) {
      el.innerHTML = newHTML;
      // Move cursor to end after updating
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    lastSegmentsRef.current = inputSegments;
  }, [inputSegments]);

  // Contenteditable keydown handler
  const handleContentEditableKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Enter to submit (Shift+Enter for newline)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitCurrent();
      return;
    }

    // Backspace to delete file pill when cursor is right next to it
    if (e.key === "Backspace") {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const container = range.startContainer;
        const offset = range.startOffset;

        // Check if cursor is right after a file pill
        if (container.nodeType === Node.ELEMENT_NODE) {
          const element = container as HTMLElement;
          const childBefore = element.childNodes[offset - 1] as HTMLElement;
          if (childBefore?.classList?.contains('file-pill')) {
            e.preventDefault();
            const fileId = childBefore.dataset.fileId;
            if (fileId) {
              removeFileSegment(fileId);
            }
            return;
          }
        } else if (container.nodeType === Node.TEXT_NODE && offset === 0) {
          // Cursor at start of text node, check previous sibling
          const prevSibling = container.previousSibling as HTMLElement;
          if (prevSibling?.classList?.contains('file-pill')) {
            e.preventDefault();
            const fileId = prevSibling.dataset.fileId;
            if (fileId) {
              removeFileSegment(fileId);
            }
            return;
          }
        }
      }
    }

    // Handle other keyboard shortcuts
    handleKeyDown(e);
  };

  // Get SVG string for file icon based on filename/extension
  const getFileIconSvg = (fileName: string, isFolder: boolean): string => {
    if (isFolder) {
      // Folder icon - matches FileIcons.Folder
      return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="5" width="13" height="8.5" rx="1.5"></rect><path d="M1.5 5V4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h4"></path></svg>`;
    }

    const name = fileName.toLowerCase();
    const dotIndex = fileName.lastIndexOf(".");
    const hasExtension = dotIndex > 0 && dotIndex < fileName.length - 1;
    const ext = hasExtension ? fileName.slice(dotIndex + 1).toLowerCase() : "";

    // Config files
    if (name.includes("config") || name.includes(".config.") || ext === "cfg" || ext === "ini") {
      return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" fill-opacity="0.7"></path><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319z" fill-opacity="0.7"></path></svg>`;
    }

    // Environment files
    if (name.startsWith(".env") || ext === "env") {
      return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="2" fill="#ecd53f" fill-opacity="0.9"></rect><path d="M4 5h8v1h-8v-1zm0 2.5h6v1h-6v-1zm0 2.5h5v1h-5v-1z" fill="#323232" fill-opacity="0.8"></path></svg>`;
    }

    // Git files
    if (name === ".gitignore" || name === ".gitattributes") {
      return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><path d="M15.698 7.287L8.712.302a1.03 1.03 0 0 0-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 0 1 1.55 1.56l1.773 1.774a1.224 1.224 0 1 1-.733.693L8.57 5.953v4.17a1.225 1.225 0 1 1-1.008-.036V5.917a1.224 1.224 0 0 1-.665-1.608L5.09 2.5l-4.788 4.79a1.03 1.03 0 0 0 0 1.456l6.986 6.986a1.03 1.03 0 0 0 1.457 0l6.953-6.953a1.031 1.031 0 0 0 0-1.492" fill="#f05033"></path></svg>`;
    }

    switch (ext) {
      case "md":
      case "mdx":
        return `<svg class="file-pill-icon text-sky-500" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #0ea5e9;"><path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z"></path><path d="M9.5 1.5v5h5"></path><path d="M5 9v3l1.5-2 1.5 2V9"></path></svg>`;
      case "ts":
      case "tsx":
      case "mts":
      case "cts":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#3178c6"></rect><path d="M4.5 7h4v1h-1.5v4h-1v-4h-1.5v-1zm4.5 0h1.75c.414 0 .75.336.75.75v.5a.75.75 0 0 1-.75.75h-1v1.25h1.75v.75h-2c-.414 0-.75-.336-.75-.75v-2.5c0-.414.336-.75.75-.75z" fill="white"></path></svg>`;
      case "js":
      case "jsx":
      case "mjs":
      case "cjs":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#f7df1e"></rect><path d="M5.5 7v4.5c0 .5-.5 1-1 1s-1-.25-1.25-.75l-.75.5c.25.75 1 1.25 2 1.25s2-.5 2-2v-4.5h-1zm3.5 0v5.5h1v-2.5h1c1 0 1.75-.75 1.75-1.5s-.75-1.5-1.75-1.5h-2zm1 1h.75c.5 0 .75.25.75.5s-.25.5-.75.5h-.75v-1z" fill="#323232"></path></svg>`;
      case "json":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#cbcb41" fill-opacity="0.9"></rect><path d="M5 5c-.55 0-1 .45-1 1v1c0 .55-.45 1-1 1v1c.55 0 1 .45 1 1v1c0 .55.45 1 1 1h1v-1h-.5c-.28 0-.5-.22-.5-.5v-1.5c0-.55-.45-1-1-1 .55 0 1-.45 1-1v-1.5c0-.28.22-.5.5-.5h.5v-1h-1zm6 0h-1v1h.5c.28 0 .5.22.5.5v1.5c0 .55.45 1 1 1-.55 0-1 .45-1 1v1.5c0 .28-.22.5-.5.5h-.5v1h1c.55 0 1-.45 1-1v-1c0-.55.45-1 1-1v-1c-.55 0-1-.45-1-1v-1c0-.55-.45-1-1-1z" fill="#323232"></path></svg>`;
      case "lua":
      case "luau":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#000080"></circle><circle cx="8" cy="8" r="4" fill="none" stroke="white" stroke-width="1.5"></circle><circle cx="11.5" cy="4.5" r="1.5" fill="white"></circle></svg>`;
      case "css":
      case "scss":
      case "sass":
      case "less":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#264de4"></rect><path d="M3 3l.8 9.2L8 14l4.2-1.8L13 3H3zm7.5 3.5H5.7l.1 1.2h4.5l-.3 3.5-2 .7-2-.7-.1-1.7h1.2l.1.9.8.3.8-.3.1-1.3H5.5L5.2 5h5.5l-.2 1.5z" fill="white"></path></svg>`;
      case "html":
      case "htm":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#e34f26"></rect><path d="M3 3l.8 9.2L8 14l4.2-1.8L13 3H3zm7.7 3.5l-.1 1h-5l.1 1h4.7l-.3 3.5-2.1.7-2.1-.7-.1-1.5h1l.1.8.9.3 1-.3.1-1.3h-4l-.3-3.5h7.2z" fill="white"></path></svg>`;
      case "py":
      case "pyw":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><defs><linearGradient id="python-grad-pill" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#387eb8"></stop><stop offset="100%" stop-color="#366994"></stop></linearGradient></defs><rect x="1" y="1" width="14" height="14" rx="2" fill="url(#python-grad-pill)"></rect><path d="M8 3c-2 0-1.9 1-1.9 1v1h2v.5h-3s-1.5-.1-1.5 2c0 2.1 1.3 2 1.3 2h.8v-1s0-1.3 1.3-1.3h2s1.2 0 1.2-1.2v-2s.2-1-2.2-1zm-.9.6c.2 0 .4.2.4.4s-.2.4-.4.4-.4-.2-.4-.4.2-.4.4-.4zM8 13c2 0 1.9-1 1.9-1v-1h-2v-.5h3s1.5.1 1.5-2c0-2.1-1.3-2-1.3-2h-.8v1s0 1.3-1.3 1.3h-2s-1.2 0-1.2 1.2v2s-.2 1 2.2 1zm.9-.6c-.2 0-.4-.2-.4-.4s.2-.4.4-.4.4.2.4.4-.2.4-.4.4z" fill="white"></path></svg>`;
      case "sql":
      case "sqlite":
      case "sqlite3":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#16a34a"></rect><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h7" stroke="white" stroke-width="1.2" stroke-linecap="round"></path></svg>`;
      case "txt":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z"></path><path d="M9.5 1.5v5h5"></path><path d="M5 8h6"></path><path d="M5 10h6"></path><path d="M5 12h4"></path></svg>`;
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
      case "svg":
      case "webp":
      case "ico":
      case "bmp":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="color: #10b981;"><rect x="2" y="2" width="12" height="12" rx="2"></rect><circle cx="5.5" cy="5.5" r="1.5"></circle><path d="M14 10l-3-3-5 5"></path><path d="M14 14l-8-8-4 4"></path></svg>`;
      case "mp4":
      case "webm":
      case "mov":
      case "avi":
      case "mkv":
      case "m4v":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="color: #ef4444;"><rect x="2" y="3" width="12" height="10" rx="1.6"></rect><path d="M2 6h12"></path><path d="M7 7.5l3 2-3 2z" fill="currentColor" stroke="none"></path></svg>`;
      case "mp3":
      case "wav":
      case "ogg":
      case "m4a":
      case "flac":
      case "aac":
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="color: #ef4444;"><circle cx="5" cy="11.5" r="1.5"></circle><circle cx="10" cy="10" r="1.5"></circle><path d="M6.5 11.5V4.5"></path><path d="M11.5 10V4"></path><path d="M6.5 4.5 11.5 4"></path></svg>`;
      default:
        // Plain file icon
        return `<svg class="file-pill-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z"></path><path d="M9.5 1.5v5h5"></path></svg>`;
    }
  };

  // Render segments to contenteditable HTML
  const renderSegmentsToHTML = (segments: InputSegment[]): string => {
    return segments.map((seg, index) => {
      if (seg.type === 'text') {
        return seg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      } else if (seg.type === 'file') {
        // File pill HTML - non-editable with blue styling, truncation, and delete button overlaying icon
        // Icon container with fixed size, × overlays the icon without changing dimensions
        const isFolder = seg.fileType === 'folder';
        const iconSvg = getFileIconSvg(seg.name, isFolder);
        const iconContainer = `<span class="file-pill-icon-container" style="position: relative; width: 14px; height: 14px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;">
          ${iconSvg}
          <span class="file-pill-delete" data-delete-file="${seg.id}" style="display: none; position: absolute; top: 0; left: 0; width: 14px; height: 14px; cursor: pointer; font-size: 14px; font-weight: 500; color: #64748b; line-height: 14px; text-align: center;">&times;</span>
        </span>`;
        const filePill = `<span contenteditable="false" data-file-id="${seg.id}" data-file-name="${seg.name}" data-file-type="${seg.fileType}" class="file-pill" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; margin: 2px 6px 2px 0; background: #dbeafe; border: 1px solid #93c5fd; border-radius: 9999px; font-size: 12px; color: #1e40af; cursor: default; vertical-align: middle; user-select: all; max-width: 180px;">${iconContainer}<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${seg.name}</span></span>`;
        const isFirst = index === 0;
        const isLast = index === segments.length - 1;
        const nextIsPill = !isLast && (segments[index + 1].type === "file" || segments[index + 1].type === "code");
        const leadingAnchor = isFirst ? ZERO_WIDTH_SPACE : "";
        const trailingAnchor = (nextIsPill || isLast) ? ZERO_WIDTH_SPACE : "";
        return `${leadingAnchor}${filePill}${trailingAnchor}`;
      } else if (seg.type === 'code') {
        // Code selection pill - shows filename with line range
        const lineRange = seg.lineStart === seg.lineEnd ? `(${seg.lineStart})` : `(${seg.lineStart}-${seg.lineEnd})`;
        const displayName = `${seg.fileName} ${lineRange}`;
        const codeIconSvg = getFileIconSvg(seg.fileName, false);
        const iconContainer = `<span class="file-pill-icon-container" style="position: relative; width: 14px; height: 14px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;">
          ${codeIconSvg}
          <span class="file-pill-delete" data-delete-code="${seg.id}" style="display: none; position: absolute; top: 0; left: 0; width: 14px; height: 14px; cursor: pointer; font-size: 14px; font-weight: 500; color: #64748b; line-height: 14px; text-align: center;">&times;</span>
        </span>`;
        const codePill = `<span contenteditable="false" data-code-id="${seg.id}" data-file-name="${seg.fileName}" data-line-start="${seg.lineStart}" data-line-end="${seg.lineEnd}" class="file-pill code-pill" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; margin: 2px 6px 2px 0; background: #dbeafe; border: 1px solid #93c5fd; border-radius: 9999px; font-size: 12px; color: #1e40af; cursor: default; vertical-align: middle; user-select: all; max-width: 220px;">${iconContainer}<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName}</span></span>`;
        const isFirst = index === 0;
        const isLast = index === segments.length - 1;
        const nextIsPill = !isLast && (segments[index + 1].type === "file" || segments[index + 1].type === "code");
        const leadingAnchor = isFirst ? ZERO_WIDTH_SPACE : "";
        const trailingAnchor = (nextIsPill || isLast) ? ZERO_WIDTH_SPACE : "";
        return `${leadingAnchor}${codePill}${trailingAnchor}`;
      }
      return '';
    }).join('');
  };

  // Handle click on file/code pill delete button
  const handleContentEditableClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Check if clicked on delete button for file
    if (target.classList.contains('file-pill-delete')) {
      const fileId = target.dataset.deleteFile;
      if (fileId) {
        e.preventDefault();
        e.stopPropagation();
        removeFileSegment(fileId);
        return;
      }
      // Check for code deletion
      const codeId = target.dataset.deleteCode;
      if (codeId) {
        e.preventDefault();
        e.stopPropagation();
        removeCodeSegment(codeId);
        return;
      }
    }
  };

  // Remove code segment by id
  const removeCodeSegment = (codeId: string) => {
    setInputSegments(prev => prev.filter(s => !(s.type === 'code' && s.id === codeId)));
  };

  // Handle mouse over/out for file pills to show/hide delete button
  const handleContentEditableMouseOver = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const pill = target.closest('.file-pill') as HTMLElement;
    if (pill) {
      const deleteBtn = pill.querySelector('.file-pill-delete') as HTMLElement;
      const fileIcon = pill.querySelector('.file-pill-icon') as SVGElement;
      if (deleteBtn) deleteBtn.style.display = 'block';
      if (fileIcon) fileIcon.style.visibility = 'hidden';
    }
  };

  const handleContentEditableMouseOut = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const pill = target.closest('.file-pill') as HTMLElement;
    if (pill) {
      // Don't hide × if pill is selected
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (pill.contains(range.startContainer) || pill.contains(range.endContainer) || range.intersectsNode(pill)) {
          return; // Keep × visible if pill is selected
        }
      }
      const deleteBtn = pill.querySelector('.file-pill-delete') as HTMLElement;
      const fileIcon = pill.querySelector('.file-pill-icon') as SVGElement;
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (fileIcon) fileIcon.style.visibility = 'visible';
    }
  };

  const isZeroWidthTextNode = (node: Node | null): node is Text => {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const text = node.textContent || "";
    return text.replace(ZERO_WIDTH_SPACE_REGEX, "") === "";
  };

  // Keep caret inside a text node so it stays normal-sized near file pills.
  const normalizeCollapsedSelectionNearPills = () => {
    const el = contentEditableRef.current;
    if (!el) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    if (!el.contains(container)) return;

    if (container.nodeType === Node.TEXT_NODE) {
      return;
    }

    if (container !== el) return;

    const offset = range.startOffset;
    const afterNode = el.childNodes[offset] ?? null;
    const beforeNode = el.childNodes[offset - 1] ?? null;

    if (isZeroWidthTextNode(afterNode)) {
      const newRange = document.createRange();
      newRange.setStart(afterNode, 0);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
      return;
    }

    if (isZeroWidthTextNode(beforeNode)) {
      const textLength = beforeNode.textContent?.length ?? 0;
      const newRange = document.createRange();
      newRange.setStart(beforeNode, textLength);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }
  };

  // Handle selection change to show/hide delete button on selected pills
  useEffect(() => {
    const handleSelectionChange = () => {
      const el = contentEditableRef.current;
      if (!el) return;

      const selection = window.getSelection();
      const pills = el.querySelectorAll('.file-pill') as NodeListOf<HTMLElement>;

      pills.forEach((pill) => {
        const deleteBtn = pill.querySelector('.file-pill-delete') as HTMLElement;
        const fileIcon = pill.querySelector('.file-pill-icon') as SVGElement;
        if (!deleteBtn || !fileIcon) return;

        let cursorOnPill = false;
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          // Check if cursor/selection start or end is directly on/in the pill
          cursorOnPill = pill.contains(range.startContainer) ||
                         pill.contains(range.endContainer);
        }

        if (cursorOnPill) {
          // Cursor is on the pill - show ×, hide selection highlight
          deleteBtn.style.display = 'block';
          fileIcon.style.visibility = 'hidden';
          pill.style.userSelect = 'none';
          pill.classList.add('cursor-on-pill');
        } else {
          // Cursor is not on the pill - show icon, allow selection highlight
          deleteBtn.style.display = 'none';
          fileIcon.style.visibility = 'visible';
          pill.style.userSelect = 'all';
          pill.classList.remove('cursor-on-pill');
        }
      });

      normalizeCollapsedSelectionNearPills();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

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

  // Add code context to input (called from MainEditor via ref)
  const addCodeContext = (fileName: string, lineStart: number, lineEnd: number, content: string) => {
    const id = `code-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setInputSegments(prev => {
      // Allow duplicates - each selection gets a unique ID
      return [...prev, { type: 'code', id, fileName, lineStart, lineEnd, content }];
    });
    // Focus the contenteditable
    setTimeout(() => contentEditableRef.current?.focus(), 0);
  };

  useImperativeHandle(ref, () => ({ triggerAction, sendPrompt, recordAgentCheckpoint, addCodeContext }));

  const currentModelName = availableModels.find(m => m.id === selectedModel)?.name || selectedModel;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  // Insert file segment at end of input (or could be enhanced for cursor position)
  const insertFileSegment = (file: { id: string; name: string; type: 'file' | 'folder' }) => {
    // Generate unique ID for each insertion to allow duplicates
    const uniqueId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setInputSegments(prev => {
      // Add file segment at end (allow duplicates)
      return [...prev, { type: 'file', id: uniqueId, name: file.name, fileType: file.type }];
    });
    // Focus the contenteditable
    setTimeout(() => contentEditableRef.current?.focus(), 0);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // Try to get node data (new format with full info)
    const nodeDataStr = e.dataTransfer.getData("application/cursor-node-data");
    if (nodeDataStr) {
      try {
        const nodesData = JSON.parse(nodeDataStr) as { id: string; name: string; type: "file" | "folder" }[];
        if (Array.isArray(nodesData) && nodesData.length > 0) {
          // Insert each file as a segment
          nodesData.forEach(node => insertFileSegment(node));
          return;
        }
      } catch {
        // Fall through to legacy handling
      }
    }

    // Legacy: just the node name - treat as text
    const fileName = e.dataTransfer.getData("application/cursor-node");
    if (fileName) {
      setInputSegments(prev => [...prev, { type: 'text', content: `@${fileName} ` }]);
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
    setInputSegments([]);
    
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
      thought_trace: msg.thoughtTrace || null,
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

  const removeFileSegment = (fileId: string) => {
    setInputSegments(prev => prev.filter(s => !(s.type === 'file' && s.id === fileId)));
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
      setInputSegments([]);
      setDraftBeforeEdit("");
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

  useEffect(() => {
    const ResizeObserverCtor = globalThis.ResizeObserver;
    if (!ResizeObserverCtor) return;
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserverCtor((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setPanelWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compactControls = panelWidth > 0 && panelWidth < 300;
  const inputPlaceholder =
    panelWidth > 0 && panelWidth < 320
      ? "Plan, @, /"
      : panelWidth > 0 && panelWidth < 380
        ? "Plan, @, / commands"
        : "Plan, @ for context, / for commands";

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

  const formatDuration = (durationMs?: number) => {
    if (!durationMs || !Number.isFinite(durationMs)) return null;
    const seconds = Math.max(1, Math.round(durationMs / 1000));
    return `${seconds}s`;
  };

  const MAX_TOOL_OUTPUT_CHARS = 2000;

  const truncateToolOutput = (value: string) => {
    if (value.length <= MAX_TOOL_OUTPUT_CHARS) return value;
    return `${value.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... (truncated)`;
  };

  const formatToolCommand = (tool?: string, args?: any) => {
    if (!tool) return undefined;
    const safeArgs = args && typeof args === "object" ? args : {};
    const path = safeArgs.path ? String(safeArgs.path) : "";
    const query = safeArgs.query ? String(safeArgs.query) : "";
    const pattern = safeArgs.pattern ? String(safeArgs.pattern) : "";
    const filePattern = safeArgs.filePattern ? String(safeArgs.filePattern) : "";
    const caseSensitive = Boolean(safeArgs.caseSensitive);

    switch (tool) {
      case "read_file":
        return path ? `cat ${path}` : "cat";
      case "list_directory":
        return path ? `ls ${path}` : "ls";
      case "list_files":
        return "ls";
      case "grep": {
        const flag = caseSensitive ? "" : "-i ";
        const scope = path ? ` ${path}` : "";
        return `rg ${flag}"${pattern}"${scope}`.trim();
      }
      case "file_search":
        return query ? `fd "${query}"` : "fd";
      case "codebase_search": {
        const glob = filePattern ? ` -g "${filePattern}"` : "";
        return query ? `rg "${query}"${glob}` : "rg";
      }
      case "web_search":
        return query ? `web_search "${query}"` : "web_search";
      default:
        return undefined;
    }
  };

  const formatToolOutput = (tool?: string, result?: any) => {
    if (!tool || !result) return undefined;
    if (result.error) return truncateToolOutput(`Error: ${result.error}`);

    let output = "";
    switch (tool) {
      case "read_file": {
        const isImage = Boolean(result.isImage);
        if (isImage) {
          const mimeType = result.mimeType ? String(result.mimeType) : "binary";
          return `[image file: ${mimeType}]`;
        }
        if (typeof result.content === "string") {
          output = result.content;
        }
        break;
      }
      case "list_directory": {
        const entries = Array.isArray(result.entries)
          ? (result.entries as DirectoryEntry[])
          : [];
        output = entries
          .map((entry) => {
            if (!entry?.name) return "";
            return entry.type === "folder" ? `${entry.name}/` : String(entry.name);
          })
          .filter(Boolean)
          .join("\n");
        break;
      }
      case "list_files": {
        const list = Array.isArray(result) ? (result as FileListEntry[]) : [];
        output = list
          .map((item) => item?.path || item?.name || "")
          .filter(Boolean)
          .join("\n");
        break;
      }
      case "grep": {
        const results = Array.isArray(result.results)
          ? (result.results as GrepResultEntry[])
          : [];
        const lines = results.map((item) => `${item.path}:${item.lineNumber}:${item.line}`);
        output = lines.join("\n");
        if (result.matchCount && result.matchCount > results.length) {
          output = `${output}\n... and ${result.matchCount - results.length} more`;
        }
        break;
      }
      case "file_search": {
        const results = Array.isArray(result.results)
          ? (result.results as SearchResultEntry[])
          : [];
        output = results.map((item) => item.path).filter(Boolean).join("\n");
        break;
      }
      case "codebase_search": {
        const results = Array.isArray(result.results)
          ? (result.results as SearchResultEntry[])
          : [];
        output = results
          .map((item) => {
            if (!item?.path) return "";
            const snippet = String(item.relevantSnippet || "").trim();
            if (!snippet) return String(item.path);
            const indented = snippet
              .split("\n")
              .map((line) => `  ${line}`)
              .join("\n");
            return `${item.path}\n${indented}`;
          })
          .filter(Boolean)
          .join("\n\n");
        break;
      }
      case "web_search": {
        const results = Array.isArray(result.results)
          ? (result.results as WebSearchResultEntry[])
          : [];
        output = results
          .map((item) => {
            const title = item?.title ? String(item.title) : "Result";
            const url = item?.url ? String(item.url) : "";
            const snippet = item?.snippet ? String(item.snippet) : "";
            return [title, url, snippet].filter(Boolean).join("\n");
          })
          .filter(Boolean)
          .join("\n\n");
        break;
      }
      default:
        output = "";
    }

    if (!output) {
      switch (tool) {
        case "read_file":
          output = "(empty file)";
          break;
        case "list_directory":
        case "list_files":
          output = "(empty)";
          break;
        case "grep":
        case "file_search":
        case "codebase_search":
          output = "No matches";
          break;
        case "web_search":
          output = "No results";
          break;
        default:
          output = "";
      }
    }

    if (!output) return undefined;
    return truncateToolOutput(output);
  };

  const truncateLabel = (value: string, maxLength = 60) => {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
  };

  const getPathBase = (path?: string) => {
    if (!path) return "";
    const parts = String(path).split("/");
    return parts[parts.length - 1] || String(path);
  };

  const formatToolLabel = (tool?: string, args?: any) => {
    const path = args?.path ? String(args.path) : "";
    const fileName = getPathBase(path);
    switch (tool) {
      case "read_file":
        return fileName ? `Read ${fileName}` : "Read file";
      case "list_files":
        return "List files";
      case "list_directory":
        return path ? `List ${getPathBase(path)}` : "List directory";
      case "codebase_search":
        return args?.query ? `Search codebase: "${truncateLabel(String(args.query), 36)}"` : "Search codebase";
      case "grep": {
        const pattern = args?.pattern ? `"${truncateLabel(String(args.pattern), 30)}"` : "";
        const scope = path ? ` in ${getPathBase(path)}` : "";
        return `Search ${pattern}${scope}`.trim();
      }
      case "file_search":
        return args?.query ? `Find files: "${truncateLabel(String(args.query), 36)}"` : "Find files";
      case "web_search":
        return args?.query ? `Web search: "${truncateLabel(String(args.query), 36)}"` : "Web search";
      case "create_file":
        return fileName ? `Create ${fileName}` : "Create file";
      case "update_file":
        return fileName ? `Update ${fileName}` : "Update file";
      case "edit_file":
        return fileName ? `Edit ${fileName}` : "Edit file";
      case "delete_file":
        return fileName ? `Delete ${fileName}` : "Delete file";
      case "create_folder":
        return path ? `Create folder ${getPathBase(path)}` : "Create folder";
      default:
        return tool ? `Run ${tool}` : "Run tool";
    }
  };

  const buildTraceFromToolCalls = (toolCalls?: ToolCall[]): ThoughtTraceStep[] => {
    if (!toolCalls || toolCalls.length === 0) return [];
    return toolCalls.map(call => ({
      type: "tool",
      tool: call.tool,
      args: call.args,
      durationMs: call.durationMs,
      status: call.result?.error ? "error" : "success",
      command: formatToolCommand(call.tool, call.args),
      output: formatToolOutput(call.tool, call.result),
    }));
  };

  const estimateThoughtMs = (message: Message, previous?: Message) => {
    const currentTime = message.created_at ? Date.parse(message.created_at) : null;
    const prevTime = previous?.created_at ? Date.parse(previous.created_at) : null;
    if (currentTime && prevTime && Number.isFinite(currentTime) && Number.isFinite(prevTime)) {
      const delta = currentTime - prevTime;
      if (delta > 0) {
        return Math.min(Math.max(delta, 1000), 60000);
      }
    }
    const contentLength = message.content ? message.content.length : 0;
    const seconds = Math.max(1, Math.min(8, Math.round(contentLength / 200)));
    return seconds * 1000;
  };

  const normalizeThoughtTrace = (trace: ThoughtTraceStep[], toolCalls?: ToolCall[]): ThoughtTraceStep[] => {
    let toolIndex = 0;
    return trace.map(step => {
      if (step.type !== "tool") return step;
      const fallback = toolCalls && toolIndex < toolCalls.length ? toolCalls[toolIndex] : undefined;
      toolIndex += 1;
      return {
        ...step,
        command: step.command ?? formatToolCommand(step.tool || fallback?.tool, step.args ?? fallback?.args),
        output: step.output ?? (fallback ? formatToolOutput(fallback.tool, fallback.result) : undefined),
      };
    });
  };

  const getThoughtTrace = (message: Message, previous?: Message): ThoughtTraceStep[] => {
    if (message.thoughtTrace && message.thoughtTrace.length > 0) {
      return normalizeThoughtTrace(message.thoughtTrace, message.toolCalls);
    }
    const toolTrace = buildTraceFromToolCalls(message.toolCalls);
    const thoughtStep: ThoughtTraceStep = { type: "thought", durationMs: estimateThoughtMs(message, previous) };
    if (toolTrace.length > 0) {
      return [thoughtStep, ...toolTrace];
    }
    return [thoughtStep];
  };

  const getThoughtSummaryMs = (trace: ThoughtTraceStep[], message: Message, previous?: Message) => {
    const totalMs = trace.reduce((sum, step) => sum + (step.durationMs || 0), 0);
    return totalMs > 0 ? totalMs : estimateThoughtMs(message, previous);
  };

  const getThoughtDetailSteps = (trace: ThoughtTraceStep[]) => {
    const hasTools = trace.some(step => step.type === "tool");
    if (hasTools) return trace;
    const thoughtSteps = trace.filter(step => step.type === "thought");
    return thoughtSteps.length > 1 ? thoughtSteps : [];
  };

  return (
    <div ref={panelRef} className="flex flex-col h-full bg-[#f9fafb] text-zinc-900 relative">
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
                      onMouseEnter={() => onHoverNode?.(file.id)}
                      onClick={() => insertFileReference(file)}
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

              {/* Mixed Content Input - contenteditable */}
              <div
                ref={contentEditableRef}
                contentEditable={!loading}
                suppressContentEditableWarning
                className={`w-full min-h-[44px] max-h-60 overflow-y-auto bg-transparent px-4 py-3 text-sm text-zinc-800 focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300 ${attachedImages.length > 0 ? "" : "rounded-t-xl"}`}
                style={{ lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                data-placeholder={inputPlaceholder}
                onInput={handleContentEditableInput}
                onKeyDown={handleContentEditableKeyDown}
                onPaste={handlePaste}
                onClick={handleContentEditableClick}
                onMouseOver={handleContentEditableMouseOver}
                onMouseOut={handleContentEditableMouseOut}
              />
              
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-2 pr-3 py-1.5 border-t border-zinc-100 bg-zinc-50/30 rounded-b-xl">
                <div className="flex items-center gap-1 min-w-0">
                  {/* Agent Dropdown */}
                  <div className="relative flex-shrink-0" ref={agentDropdownRef}>
                    <button
                      onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                      title={mode}
                      className={`flex items-center gap-1.5 text-[11px] font-medium rounded px-2 py-1 transition-colors min-w-0 max-w-[120px] overflow-hidden flex-shrink-0 ${getModeStyles(mode)}`}
                    >
                      {getModeIcon(mode, "w-3.5 h-3.5")}
                      {!compactControls && <span className="truncate capitalize">{mode}</span>}
                      <Icons.ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
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
                  <div
                    className={`relative min-w-0 ${compactControls ? "max-w-[110px]" : "max-w-[200px]"}`}
                    ref={dropdownRef}
                  >
                    <button
                      onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                      title={getModelDisplay()}
                      className="flex w-full min-w-0 items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded px-2 py-1 transition-colors text-left overflow-hidden"
                    >
                      <span className="flex-1 min-w-0 truncate">{getModelDisplay()}</span>
                      <Icons.ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
                    </button>
                    
                    {isModelDropdownOpen && (
                      <div className="absolute top-full right-0 mt-2 w-72 max-w-[calc(100vw-24px)] bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-[500px] overflow-y-auto">
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
                    disabled={loading || (inputSegments.length === 0 && attachedImages.length === 0 && (editingMessageIndex === null || editingImageUrls.length === 0))}
                    className={`p-1.5 rounded-full transition-all flex-shrink-0 flex items-center justify-center ${getSubmitButtonStyles(mode, inputSegments.length > 0 || attachedImages.length > 0 || (editingMessageIndex !== null && editingImageUrls.length > 0))}`}
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
          const isPending = Boolean(msg.isPending);
          const previousMessage = idx > 0 ? messages[idx - 1] : undefined;
          const thoughtTrace = msg.role === "assistant" && !isPending ? getThoughtTrace(msg, previousMessage) : [];
          const thoughtSummaryMs = msg.role === "assistant" && !isPending ? getThoughtSummaryMs(thoughtTrace, msg, previousMessage) : 0;
          const detailSteps = getThoughtDetailSteps(thoughtTrace);
          const showThoughtDetails = isPending || detailSteps.length > 0;
          const thoughtSummary = isPending ? "Thinking..." : `Thought for ${formatDuration(thoughtSummaryMs) ?? "1s"}`;
          
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
                           className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors shadow-sm ${
                             isFuture
                               ? "border-zinc-200 bg-zinc-50 text-zinc-400 cursor-not-allowed shadow-none"
                               : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                           }`}
                         >
                           <span className="flex items-center gap-1.5">
                             <Icons.Restore className="w-3 h-3" />
                             <span>Restore checkpoint</span>
                           </span>
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
               {/* Thought Trace (Cursor-like) */}
               <div className="flex flex-col gap-1">
                 <button
                   onClick={() => {
                     if (!showThoughtDetails) return;
                     toggleThought(msg.id);
                   }}
                   className={`flex items-center gap-2 text-xs w-fit select-none ${showThoughtDetails ? "text-zinc-400 hover:text-zinc-600" : "text-zinc-400 cursor-default"}`}
                 >
                   <Icons.ChevronDown className={`w-3 h-3 transition-transform ${isThoughtExpanded && showThoughtDetails ? "" : "-rotate-90"}`} />
                   <span>{thoughtSummary}</span>
                 </button>
                 {isThoughtExpanded && showThoughtDetails && (
                   <div className="pl-5 text-xs text-zinc-500 border-l-2 border-zinc-200 ml-1.5 py-1 space-y-1">
                     {isPending ? (
                       <div className="flex items-center gap-2 text-zinc-400">
                         <span>Thinking</span>
                         <div className="flex items-center gap-1">
                           <span className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce" />
                           <span className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce delay-150" />
                           <span className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce delay-300" />
                         </div>
                       </div>
                     ) : (
                       detailSteps.map((step, stepIndex) => {
                         const isTool = step.type === "tool";
                         const stepDuration = formatDuration(step.durationMs);
                         const label = isTool
                           ? formatToolLabel(step.tool, step.args)
                           : `Thought for ${formatDuration(step.durationMs) ?? "1s"}`;
                         const labelClass = step.status === "error" ? "text-red-600" : "text-zinc-600";
                         const title = isTool && step.args?.path ? String(step.args.path) : undefined;
                         const command = isTool ? step.command : undefined;
                         const output = isTool ? step.output : undefined;
                         const hasOutput = typeof output === "string";
                         const outputBody = hasOutput ? (output.trim() ? output : "(no output)") : "";

                         return (
                           <div key={`${msg.id}-trace-${stepIndex}`} className="space-y-1">
                             <div className="flex items-center justify-between gap-3 text-xs">
                               <div className="flex items-center gap-2 min-w-0">
                                 {isTool && getToolIcon(step.tool || "", "w-3 h-3 text-zinc-400 flex-shrink-0")}
                                 <span className={`truncate ${labelClass}`} title={title}>
                                   {label}
                                 </span>
                               </div>
                               {isTool && stepDuration && (
                                 <span className="text-[10px] text-zinc-400 flex-shrink-0">{stepDuration}</span>
                               )}
                             </div>
                             {isTool && command && hasOutput && (
                               <div className="ml-5 rounded-md border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-600 overflow-hidden">
                                 <div className="flex items-center gap-2 px-2 py-1 border-b border-zinc-200 text-[10px] text-zinc-400">
                                   <Icons.Terminal className="w-3 h-3 text-zinc-400" />
                                   <span>Auto-Ran command:</span>
                                   <span className="font-mono text-zinc-700 truncate">{command}</span>
                                 </div>
                                 <pre className="px-2 py-1.5 whitespace-pre-wrap font-mono text-[11px] text-zinc-700 max-h-40 overflow-auto">
                                   {outputBody}
                                 </pre>
                               </div>
                             )}
                           </div>
                         );
                       })
                     )}
                   </div>
                 )}
               </div>

               {!isPending && (
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
               )}
               
               {!isPending && (
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
               )}
            </div>
          );
        })}
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
                      onMouseEnter={() => onHoverNode?.(file.id)}
                      onClick={() => insertFileReference(file)}
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

          {/* Mixed Content Input - contenteditable */}
          <div
            ref={contentEditableRef}
            contentEditable={!loading}
            suppressContentEditableWarning
            className={`w-full min-h-[44px] max-h-60 overflow-y-auto bg-transparent px-4 py-3 text-sm text-zinc-800 focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300 ${(attachedImages.length > 0 || (editingMessageIndex !== null && editingImageUrls.length > 0)) ? "" : "rounded-t-xl"}`}
            style={{ lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            data-placeholder="Add a follow-up"
            onInput={handleContentEditableInput}
            onKeyDown={handleContentEditableKeyDown}
            onPaste={handlePaste}
            onClick={handleContentEditableClick}
            onMouseOver={handleContentEditableMouseOver}
            onMouseOut={handleContentEditableMouseOut}
          />
          
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-2 pr-3 py-1.5 border-t border-zinc-100 bg-zinc-50/30 rounded-b-xl">
             <div className="flex items-center gap-1 min-w-0">
                {/* Agent Dropdown */}
                <div className="relative flex-shrink-0" ref={agentDropdownRef}>
                    <button
                        onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                        title={mode}
                        className={`flex items-center gap-1.5 text-[11px] font-medium rounded px-2 py-1 transition-colors min-w-0 max-w-[120px] overflow-hidden flex-shrink-0 ${getModeStyles(mode)}`}
                    >
                        {getModeIcon(mode, "w-3.5 h-3.5")}
                        {!compactControls && <span className="truncate capitalize">{mode}</span>}
                        <Icons.ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
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
                <div
                  className={`relative min-w-0 ${compactControls ? "max-w-[110px]" : "max-w-[200px]"}`}
                  ref={dropdownRef}
                >
                  <button
                    onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                    title={getModelDisplay()}
                    className="flex w-full min-w-0 items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded px-2 py-1 transition-colors text-left overflow-hidden"
                  >
                    <span className="flex-1 min-w-0 truncate">{getModelDisplay()}</span>
                    <Icons.ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
                  </button>
                  
                  {isModelDropdownOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-72 max-w-[calc(100vw-24px)] bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden max-h-[500px] overflow-y-auto">
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
                 className={`p-1.5 hover:bg-zinc-200 rounded transition-colors ${
                   attachedImages.length > 0 ? "text-blue-500" : "text-zinc-400 hover:text-zinc-600"
                 }`}
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
                   disabled={
                     loading ||
                     (inputSegments.length === 0 &&
                       attachedImages.length === 0 &&
                       (editingMessageIndex === null || editingImageUrls.length === 0))
                   }
                   className={`p-1.5 rounded-full transition-all flex-shrink-0 flex items-center justify-center ${getSubmitButtonStyles(
                     mode,
                     inputSegments.length > 0 ||
                       attachedImages.length > 0 ||
                       (editingMessageIndex !== null && editingImageUrls.length > 0)
                   )}`}
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
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-zinc-200 rounded-xl shadow-2xl w-[420px] overflow-hidden">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
                  <Icons.Warning className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-zinc-900 font-medium text-sm">
                    Discard all changes up to this checkpoint?
                  </h3>
                  <p className="text-zinc-500 text-xs mt-1">
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
                  className="w-3.5 h-3.5 rounded border-zinc-300 bg-white text-blue-600 focus:ring-2 focus:ring-blue-200 focus:ring-offset-0"
                />
                <label htmlFor="dontAskAgain" className="text-zinc-500 text-xs">
                  Don't ask again
                </label>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-zinc-50 border-t border-zinc-200">
              <button
                onClick={() => {
                  setShowRestoreDialog(false);
                  setRestoreToIndex(null);
                  setDontAskAgain(false);
                }}
                className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
              >
                Cancel (esc)
              </button>
              <button
                onClick={confirmRestore}
                className="px-3.5 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-1.5"
              >
                Continue
                <Icons.ChevronRight className="w-3 h-3" />
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

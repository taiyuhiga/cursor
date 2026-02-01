"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { diffLines } from "diff";
import JSZip from "jszip";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AiPanel, AiPanelHandle } from "@/components/AiPanel";
import { TabBar } from "@/components/TabBar";
import { getFileIcon, FileIcons } from "@/components/fileIcons";
import { MainEditor } from "@/components/MainEditor";
import { DiffView } from "@/components/DiffView";
import { CommandPalette } from "@/components/CommandPalette";
import { FileTree } from "@/components/FileTree";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { SettingsView } from "@/components/SettingsView";
import { ReviewPanel } from "@/components/ReviewPanel";
import { SourceControlPanel, type SourceControlChange } from "@/components/SourceControlPanel";
import { MediaPreview, isMediaFile, prefetchMediaUrl } from "@/components/MediaPreview";
import { FolderPageView } from "@/components/FolderPageView";
import { ReplaceConfirmDialog } from "@/components/ReplaceConfirmDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { UndoConfirmDialog } from "@/components/UndoConfirmDialog";
import { SharePopover } from "@/components/SharePopover";
import type { PendingChange, ReviewIssue } from "@/lib/review/types";
import type { AgentCheckpointChange, AgentCheckpointRecordInput } from "@/lib/checkpoints/types";

type Node = {
  id: string;
  project_id: string;
  parent_id: string | null;
  type: "file" | "folder";
  name: string;
  is_public?: boolean | null;
  public_access_role?: "viewer" | "editor" | null;
  created_at: string;
};

type ShareSettingsUser = {
  id: string;
  email: string;
  displayName: string;
  role: "viewer" | "editor";
  userId: string | null;
};

type ShareSettings = {
  nodeId: string;
  isPublic: boolean;
  publicAccessRole: "viewer" | "editor";
  sharedUsers: ShareSettingsUser[];
  fetchedAt: number;
};

const SHARE_SETTINGS_TTL_MS = 30000;
const LOCAL_EDIT_GRACE_MS = 1200;

type UploadItem = {
  file: File;
  relativePath: string;
  isDirectory?: boolean;
};

type WebkitEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: WebkitEntry[]) => void, error?: (error: DOMException) => void) => void;
  };
};

type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  role: string;
};

type Props = {
  projectId: string;
  workspaces: Workspace[];
  currentWorkspace: Workspace;
  userEmail: string;
  initialNodes?: Node[];
  sharedNodeId?: string;
  initialSharedFileData?: SharedFileData | null;
};

type SharedFileData = {
  node: {
    id: string;
    name: string;
    type: "file" | "folder";
    isPublic: boolean;
    publicAccessRole: "viewer" | "editor";
    createdAt: string;
  };
  path: string;
  content: string | null;
  signedUrl: string | null;
};

function extractJsonCandidate(text: string): string | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
  const candidate = fence ? fence[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return candidate.slice(first, last + 1);
}

function normalizeSeverity(value: any): "high" | "medium" | "low" {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("h")) return "high";
  if (v.startsWith("m")) return "medium";
  return "low";
}

function parseAgentReviewIssues(text: string): ReviewIssue[] | null {
  const jsonStr = extractJsonCandidate(text);
  if (!jsonStr) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  const issues = Array.isArray(parsed) ? parsed : parsed?.issues;
  if (!Array.isArray(issues)) return null;

  const makeId = () => {
    try {
      return crypto.randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  };

  const out: ReviewIssue[] = [];
  for (const i of issues) {
    const filePath = String(i?.filePath || i?.path || "").trim();
    const title = String(i?.title || i?.summary || "Issue").trim();
    const description = String(i?.description || i?.details || "").trim();
    if (!filePath || !description) continue;

    const startLine = Number.isFinite(i?.startLine) ? Number(i.startLine) : undefined;
    const endLine = Number.isFinite(i?.endLine) ? Number(i.endLine) : undefined;

    out.push({
      id: String(i?.id || makeId()),
      filePath,
      title,
      description,
      severity: normalizeSeverity(i?.severity),
      startLine,
      endLine,
      fixPrompt: typeof i?.fixPrompt === "string" ? i.fixPrompt : undefined,
      status: "open",
    });
  }

  return out;
}

type Activity = "explorer" | "search" | "git" | "ai" | "settings";

type VirtualDoc = {
  id: string; // virtual-plan:...
  kind: "plan";
  title: string;
  fileName: string; // e.g. plan-YYYYMMDD-HHMMSS.md
  pathHint: string; // e.g. .cursor/plans/...
  content: string;
  created_at: string;
};

// Helper to get/set localStorage cache for nodes
const NODES_CACHE_KEY = "fileTreeCache";

const dedupeNodesById = (list: Node[]) => {
  const seen = new Set<string>();
  const unique: Node[] = [];
  for (const node of list) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    unique.push(node);
  }
  return unique;
};

function getCachedNodes(projectId: string): Node[] | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(`${NODES_CACHE_KEY}:${projectId}`);
    if (!cached) return null;
    const { nodes } = JSON.parse(cached);
    return Array.isArray(nodes) ? dedupeNodesById(nodes) : null;
  } catch {
    return null;
  }
}

function setCachedNodes(projectId: string, nodes: Node[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${NODES_CACHE_KEY}:${projectId}`,
      JSON.stringify({ nodes: dedupeNodesById(nodes) })
    );
  } catch {
    // Ignore storage errors
  }
}

export default function AppLayout({ projectId, workspaces, currentWorkspace, userEmail, initialNodes = [], sharedNodeId, initialSharedFileData }: Props) {
  const router = useRouter();
  // Use initialNodes from server, or cached nodes, for instant display
  const [nodes, setNodes] = useState<Node[]>(() => {
    if (initialNodes.length > 0) return initialNodes;
    const cached = getCachedNodes(projectId);
    return cached || [];
  });
  const [openTabs, setOpenTabs] = useState<string[]>(() => {
    if (initialSharedFileData && sharedNodeId) {
      return [`shared:${sharedNodeId}`];
    }
    return [];
  });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(() => {
    if (initialSharedFileData && sharedNodeId) {
      return `shared:${sharedNodeId}`;
    }
    return null;
  });
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [previewTabId, setPreviewTabId] = useState<string | null>(null);
  const [activeActivity, setActiveActivity] = useState<Activity>("explorer");
  const [fileContent, setFileContent] = useState<string>("");
  const [tempFileContents, setTempFileContents] = useState<Record<string, string>>({});
  const [draftContents, setDraftContents] = useState<Record<string, string>>({});
  const [folderDirtyIds, setFolderDirtyIds] = useState<Set<string>>(new Set());
  const [contentCache, setContentCache] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isSharePublic, setIsSharePublic] = useState(false);
  const [isSharePublicLoaded, setIsSharePublicLoaded] = useState(false);
  const [shareSettings, setShareSettings] = useState<ShareSettings | null>(null);
  const [isShareViewReady, setIsShareViewReady] = useState(true);
  const [isHoveringLeftResize, setIsHoveringLeftResize] = useState(false);
  const [shareTargetNodeId, setShareTargetNodeId] = useState<string | null>(null);
  const [shareWorkspaceId, setShareWorkspaceId] = useState<string | null>(null);
  // Start with loading=false if we have initial data (server-side or cached)
  const [isLoading, setIsLoading] = useState(() => {
    if (initialNodes.length > 0) return false;
    const cached = getCachedNodes(projectId);
    return !cached || cached.length === 0;
  });
  const [diffState, setDiffState] = useState<{
    show: boolean;
    newCode: string;
  }>({ show: false, newCode: "" });
  const [virtualDocs, setVirtualDocs] = useState<Record<string, VirtualDoc>>({});
  const [reviewOverlayOpen, setReviewOverlayOpen] = useState(false);
  const [reviewSelectedChangeId, setReviewSelectedChangeId] = useState<string | null>(null);
  const [reviewFocusIssue, setReviewFocusIssue] = useState<{ id: string; nonce: number } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [reviewOrigin, setReviewOrigin] = useState<{ sessionId: string; userMessageId: string; assistantMessageId: string } | null>(null);
  const [reviewIssues, setReviewIssues] = useState<ReviewIssue[] | null>(null);
  const [isFindingReviewIssues, setIsFindingReviewIssues] = useState(false);

  // Source Control (Cursor-like, localStorage-based baseline)
  const [scCommitMessage, setScCommitMessage] = useState("");
  const [scBaseline, setScBaseline] = useState<Record<string, { nodeId?: string; content: string }> | null>(null);
  const [scChanges, setScChanges] = useState<SourceControlChange[]>([]);
  const [scChangeDetails, setScChangeDetails] = useState<
    Record<string, { nodeId?: string; filePath: string; oldContent: string; newContent: string }>
  >({});
  const [scIssues, setScIssues] = useState<ReviewIssue[] | null>(null);
  const [isFindingScIssues, setIsFindingScIssues] = useState(false);
  const [isWorkspacePopoverOpen, setIsWorkspacePopoverOpen] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [currentWorkspaces, setCurrentWorkspaces] = useState(workspaces);
  const [activeWorkspace, setActiveWorkspace] = useState(currentWorkspace);
  const [showDeleteWorkspaceConfirm, setShowDeleteWorkspaceConfirm] = useState(false);
  // ワークスペース削除対象（コンテキストメニューから）
  const [deletingWorkspace, setDeletingWorkspace] = useState<{ id: string; name: string } | null>(null);

  // Shared file state (when viewing a shared file from another user)
  const [sharedFileData, setSharedFileData] = useState<SharedFileData | null>(initialSharedFileData || null);
  const [sharedFileContent, setSharedFileContent] = useState<string>(initialSharedFileData?.content || "");
  const [sharedFileOriginalContent, setSharedFileOriginalContent] = useState<string>(initialSharedFileData?.content || "");
  const sharedFileContentRef = useRef<string>(initialSharedFileData?.content || "");
  const sharedFileOriginalContentRef = useRef<string>(initialSharedFileData?.content || "");

  // Resizable panel widths (persisted to localStorage)
  const [leftPanelWidth, setLeftPanelWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [panelWidthsLoaded, setPanelWidthsLoaded] = useState(false);

  // Load panel widths from localStorage after hydration
  useEffect(() => {
    const savedLeft = localStorage.getItem("leftPanelWidth");
    const savedRight = localStorage.getItem("rightPanelRight");
    if (savedLeft) setLeftPanelWidth(parseInt(savedLeft, 10));
    if (savedRight) setRightPanelWidth(parseInt(savedRight, 10));
    setPanelWidthsLoaded(true);
  }, []);

  // Fetch shared file data when sharedNodeId is provided (skip if already prefetched from server)
  useEffect(() => {
    // Skip if no sharedNodeId or if we already have prefetched data
    if (!sharedNodeId || initialSharedFileData) return;

    const fetchSharedFile = async () => {
      try {
        const res = await fetch(`/api/public/node?nodeId=${sharedNodeId}`);
        const data = await res.json();

        if (!res.ok) {
          console.error("Failed to fetch shared file:", data.error);
          return;
        }

        setSharedFileData(data);
        setSharedFileContent(data.content || "");
        setSharedFileOriginalContent(data.content || "");

        // Open the shared file in a tab with a special ID prefix
        const sharedTabId = `shared:${sharedNodeId}`;
        setOpenTabs((prev) => {
          if (prev.includes(sharedTabId)) return prev;
          return [...prev, sharedTabId];
        });
        setActiveNodeId(sharedTabId);
      } catch (err) {
        console.error("Error fetching shared file:", err);
      }
    };

    fetchSharedFile();
  }, [sharedNodeId, initialSharedFileData]);

  // Real-time subscription for shared file changes
  useEffect(() => {
    if (!sharedNodeId) return;

    const supabaseClient = createClient();
    const channelName = `file-content-${sharedNodeId}`;
    const applySharedUpdate = (nextContent: string, source?: string) => {
      if (!sharedNodeId) return;
      // Ignore our own broadcasts and avoid clobbering unsaved edits.
      if (source && source === realtimeClientIdRef.current) return;
      if (sharedFileContentRef.current !== sharedFileOriginalContentRef.current) return;
      setSharedFileContent((current) => (current === nextContent ? current : nextContent));
      setSharedFileOriginalContent((current) => (current === nextContent ? current : nextContent));
      sharedFileContentRef.current = nextContent;
      sharedFileOriginalContentRef.current = nextContent;
    };

    const channel = supabaseClient
      .channel(channelName)
      .on(
        "broadcast",
        { event: "file_content_updated" },
        ({ payload }: { payload: { nodeId?: string; text?: string; source?: string } }) => {
          const nextContent = typeof payload?.text === "string" ? payload.text : null;
          const nodeId = payload?.nodeId as string | undefined;
          if (!nextContent || nodeId !== sharedNodeId) return;
          applySharedUpdate(nextContent, payload?.source);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*", // Listen for INSERT, UPDATE, DELETE
          schema: "public",
          table: "file_contents",
          filter: `node_id=eq.${sharedNodeId}`,
        },
        (payload: { new: { text?: string; node_id?: string } | null; eventType: string }) => {
          console.log("Realtime event received:", payload.eventType, payload.new?.node_id);
          const newContent = payload.new?.text || "";
          applySharedUpdate(newContent);
        }
      )
      .subscribe((status: string) => {
        console.log("Realtime subscription status:", status);
        sharedFileChannelRef.current = channel;
        sharedFileChannelNodeIdRef.current = sharedNodeId;
        sharedFileChannelSubscribedRef.current = status === "SUBSCRIBED";
      });

    return () => {
      if (sharedFileChannelRef.current === channel) {
        sharedFileChannelRef.current = null;
        sharedFileChannelNodeIdRef.current = null;
        sharedFileChannelSubscribedRef.current = false;
      }
      supabaseClient.removeChannel(channel);
    };
  }, [sharedNodeId]);

  const aiPanelRef = useRef<AiPanelHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetParentId, setUploadTargetParentId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [revealNodeId, setRevealNodeId] = useState<string | null>(null);

  // Replace confirmation dialog state
  const [replaceDialog, setReplaceDialog] = useState<{
    isOpen: boolean;
    fileName: string;
    isFolder: boolean;
    existingNodeId: string;
    resolve: ((replace: boolean) => void) | null;
  }>({
    isOpen: false,
    fileName: "",
    isFolder: false,
    existingNodeId: "",
    resolve: null,
  });
  const replaceQueueRef = useRef<{
    items: { key: string; label: string; isFolder: boolean; existingNodeId: string }[];
    index: number;
    results: boolean[];
    resolve: (map: Map<string, boolean>) => void;
  } | null>(null);

  // Delete confirmation dialog state
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    names: string[];
    itemType: "file" | "folder" | "mixed";
  }>({
    isOpen: false,
    names: [],
    itemType: "file",
  });
  const deleteDialogResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  // Undo confirmation dialog state
  const [undoDialog, setUndoDialog] = useState<{
    isOpen: boolean;
    actionName: string;
    actionType: "create" | "copy" | "upload";
  }>({
    isOpen: false,
    actionName: "",
    actionType: "create",
  });
  const undoDialogResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const prefetchedMediaIdsRef = useRef<Set<string>>(new Set());
  const pendingNodeIdsRef = useRef<Set<string>>(new Set());
  const pendingPathResolversRef = useRef<Map<string, { path: string; resolve: (id: string | null) => void; timeoutId: number }>>(new Map());
  const pendingTempResolversRef = useRef<Map<string, { resolve: (id: string | null) => void; timeoutId: number }[]>>(new Map());
  // tempノードID→パスのマッピング（楽観的更新時に保存、fetchNodes後も解決に使用）
  const tempIdPathMapRef = useRef<Map<string, string>>(new Map());
  // tempノードID→実ノードIDのマッピング（コピーの連鎖対応）
  const tempIdRealIdMapRef = useRef<Map<string, string>>(new Map());
  const editableTempNodeIdsRef = useRef<Set<string>>(new Set());
  const pendingContentByRealIdRef = useRef<Map<string, string>>(new Map());
  const tempFileContentsRef = useRef<Record<string, string>>({});
  const draftContentsRef = useRef<Record<string, string>>({});
  const contentCacheRef = useRef<Record<string, string>>({});
  const lastLocalEditAtRef = useRef<Map<string, number>>(new Map());
  const pendingRemoteContentRef = useRef<Map<string, string>>(new Map());
  const remoteApplyTimeoutsRef = useRef<Map<string, number>>(new Map());
  const activeNodeIdRef = useRef<string | null>(null);
  const previewTabIdRef = useRef<string | null>(null);
  const openTabsRef = useRef<string[]>([]);
  const layoutRef = useRef<HTMLDivElement>(null);
  const leftResizeHoverRef = useRef(false);
  const isSharePublicRef = useRef(isSharePublic);
  const shareSettingsCacheRef = useRef<Map<string, ShareSettings>>(new Map());
  const shareSettingsPromiseRef = useRef<Map<string, Promise<ShareSettings | null>>>(new Map());
  const shareSettingsFetchVersionRef = useRef<Map<string, number>>(new Map());
  const shareTargetIdRef = useRef<string | null>(null);
  const realtimeClientIdRef = useRef(`client-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const activeFileChannelRef = useRef<RealtimeChannel | null>(null);
  const activeFileChannelNodeIdRef = useRef<string | null>(null);
  const activeFileChannelSubscribedRef = useRef(false);
  const sharedFileChannelRef = useRef<RealtimeChannel | null>(null);
  const sharedFileChannelNodeIdRef = useRef<string | null>(null);
  const sharedFileChannelSubscribedRef = useRef(false);
  const supabase = createClient();

  useEffect(() => {
    tempFileContentsRef.current = tempFileContents;
  }, [tempFileContents]);

  useEffect(() => {
    sharedFileContentRef.current = sharedFileContent;
  }, [sharedFileContent]);

  useEffect(() => {
    sharedFileOriginalContentRef.current = sharedFileOriginalContent;
  }, [sharedFileOriginalContent]);

  useEffect(() => {
    draftContentsRef.current = draftContents;
  }, [draftContents]);

  useEffect(() => {
    contentCacheRef.current = contentCache;
  }, [contentCache]);

  useEffect(() => {
    activeNodeIdRef.current = activeNodeId;
  }, [activeNodeId]);

  useEffect(() => {
    setIsShareOpen(false);
    setIsSharePublic(false);
    setIsSharePublicLoaded(false);
    setShareSettings(null);
    setIsShareViewReady(true);
  }, [activeNodeId]);

  useEffect(() => {
    previewTabIdRef.current = previewTabId;
  }, [previewTabId]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    isSharePublicRef.current = isSharePublic;
  }, [isSharePublic]);

  const getFileChannelName = useCallback((nodeId: string) => `file-content-${nodeId}`, []);

  const applyRemoteContentNow = useCallback((nodeId: string, nextContent: string) => {
    setContentCache((prev) => {
      if (prev[nodeId] === nextContent) return prev;
      const next = { ...prev, [nodeId]: nextContent };
      contentCacheRef.current = next;
      return next;
    });

    if (activeNodeIdRef.current === nodeId) {
      setFileContent((current) => (current === nextContent ? current : nextContent));
    }
  }, []);

  const schedulePendingRemoteApply = useCallback((nodeId: string) => {
    const existingTimeout = remoteApplyTimeoutsRef.current.get(nodeId);
    if (existingTimeout) window.clearTimeout(existingTimeout);
    const timeoutId = window.setTimeout(() => {
      remoteApplyTimeoutsRef.current.delete(nodeId);
      const lastLocalEditAt = lastLocalEditAtRef.current.get(nodeId) ?? 0;
      if (Date.now() - lastLocalEditAt < LOCAL_EDIT_GRACE_MS) {
        schedulePendingRemoteApply(nodeId);
        return;
      }
      const pending = pendingRemoteContentRef.current.get(nodeId);
      if (pending === undefined) return;
      if (draftContentsRef.current[nodeId] !== undefined) return;
      if (pendingContentByRealIdRef.current.has(nodeId)) return;
      pendingRemoteContentRef.current.delete(nodeId);
      applyRemoteContentNow(nodeId, pending);
    }, LOCAL_EDIT_GRACE_MS);
    remoteApplyTimeoutsRef.current.set(nodeId, timeoutId);
  }, [applyRemoteContentNow]);

  const noteLocalEdit = useCallback((nodeId: string) => {
    lastLocalEditAtRef.current.set(nodeId, Date.now());
    if (pendingRemoteContentRef.current.has(nodeId)) {
      schedulePendingRemoteApply(nodeId);
    }
  }, [schedulePendingRemoteApply]);

  const applyRemoteContentUpdate = useCallback((nodeId: string, nextContent: string, source?: string) => {
    if (source && source === realtimeClientIdRef.current) return;
    if (draftContentsRef.current[nodeId] !== undefined) return;
    if (pendingContentByRealIdRef.current.has(nodeId)) return;

    const lastLocalEditAt = lastLocalEditAtRef.current.get(nodeId) ?? 0;
    if (Date.now() - lastLocalEditAt < LOCAL_EDIT_GRACE_MS) {
      pendingRemoteContentRef.current.set(nodeId, nextContent);
      schedulePendingRemoteApply(nodeId);
      return;
    }

    pendingRemoteContentRef.current.delete(nodeId);
    applyRemoteContentNow(nodeId, nextContent);
  }, [applyRemoteContentNow, schedulePendingRemoteApply]);

  useEffect(() => () => {
    remoteApplyTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    remoteApplyTimeoutsRef.current.clear();
  }, []);

  const broadcastFileContentUpdate = useCallback(async (nodeId: string, text: string) => {
    const channelName = getFileChannelName(nodeId);
    const payload = {
      nodeId,
      text,
      source: realtimeClientIdRef.current,
      updatedAt: Date.now(),
    };

    const sendOnChannel = async (channel: RealtimeChannel) => {
      try {
        await channel.send({
          type: "broadcast",
          event: "file_content_updated",
          payload,
        });
      } catch (error) {
        console.error("Broadcast send failed:", error);
      }
    };

    if (
      activeFileChannelRef.current &&
      activeFileChannelNodeIdRef.current === nodeId &&
      activeFileChannelSubscribedRef.current
    ) {
      await sendOnChannel(activeFileChannelRef.current);
      return;
    }

    if (
      sharedFileChannelRef.current &&
      sharedFileChannelNodeIdRef.current === nodeId &&
      sharedFileChannelSubscribedRef.current
    ) {
      await sendOnChannel(sharedFileChannelRef.current);
      return;
    }

    const tempChannel = supabase.channel(channelName);
    try {
      await new Promise<void>((resolve) => {
        const timeoutId = window.setTimeout(() => resolve(), 1500);
        tempChannel.subscribe((status: string) => {
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            window.clearTimeout(timeoutId);
            resolve();
          }
        });
      });
      await sendOnChannel(tempChannel);
    } finally {
      supabase.removeChannel(tempChannel);
    }
  }, [getFileChannelName, supabase]);

  const dirtyTabIds = useMemo(() => {
    const ids = new Set(Object.keys(draftContents));
    Object.keys(tempFileContents).forEach((id) => ids.add(id));
    // Include folder dirty tabs
    folderDirtyIds.forEach((id) => ids.add(id));
    // Include shared file tab if content has been modified
    if (sharedNodeId && sharedFileData && sharedFileContent !== sharedFileOriginalContent) {
      ids.add(`shared:${sharedNodeId}`);
    }
    return ids;
  }, [draftContents, tempFileContents, folderDirtyIds, sharedNodeId, sharedFileData, sharedFileContent, sharedFileOriginalContent]);


  const getNodeKey = (node: Node) => `${node.type}:${node.parent_id ?? "root"}:${node.name}`;

  // Undo/Redo stack for file operations
  type UndoAction =
    | { type: "delete"; nodeId: string; node: Node; content?: string; children?: { node: Node; content?: string }[] }
    | { type: "create"; nodeId: string; node?: Node; content?: string; source?: "create" | "upload"; batchId?: string }
    | { type: "rename"; nodeId: string; oldName: string; newName: string }
    | { type: "move"; nodeIds: string[]; oldParentIds: (string | null)[]; newParentId: string | null }
    | { type: "copy"; nodeIds: string[]; names?: string[] };
  type UploadSession = {
    canceled: boolean;
    done: boolean;
    donePromise: Promise<void>;
    resolveDone: () => void;
    realId?: string;
  };
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const MAX_UNDO_STACK = 50;
  const folderUploadSessionsRef = useRef<Map<string, UploadSession>>(new Map());

  const pushUndoAction = useCallback((action: UndoAction) => {
    setUndoStack(prev => {
      // Prevent duplicate consecutive actions (e.g., from React StrictMode or double events)
      const lastAction = prev[prev.length - 1];
      if (lastAction) {
        const isDuplicate = (() => {
          if (lastAction.type !== action.type) return false;
          if (action.type === "copy" && lastAction.type === "copy") {
            return JSON.stringify(action.nodeIds) === JSON.stringify(lastAction.nodeIds);
          }
          if (action.type === "create" && lastAction.type === "create") {
            return action.nodeId === lastAction.nodeId;
          }
          if (action.type === "delete" && lastAction.type === "delete") {
            return action.nodeId === lastAction.nodeId;
          }
          if (action.type === "rename" && lastAction.type === "rename") {
            return action.nodeId === lastAction.nodeId && action.oldName === lastAction.oldName && action.newName === lastAction.newName;
          }
          if (action.type === "move" && lastAction.type === "move") {
            return JSON.stringify(action.nodeIds) === JSON.stringify(lastAction.nodeIds);
          }
          return false;
        })();
        if (isDuplicate) {
          // Skip duplicate action
          return prev;
        }
      }
      const newStack = [...prev, action];
      // #region agent log
      // #endregion
      if (newStack.length > MAX_UNDO_STACK) {
        return newStack.slice(-MAX_UNDO_STACK);
      }
      return newStack;
    });
    // Clear redo stack when a new action is performed
    setRedoStack([]);
  }, []);

  const updateUndoCreateNodeId = useCallback((tempId: string, realId: string) => {
    setUndoStack(prev => prev.map(action => {
      if (action.type !== "create" || action.nodeId !== tempId) return action;
      const node = action.node ? { ...action.node, id: realId } : action.node;
      return { ...action, nodeId: realId, node };
    }));
  }, []);

  const updateUndoCopyNodeIds = useCallback((tempIds: string[], realIds: string[]) => {
    if (tempIds.length === 0 || realIds.length === 0) return;
    if (tempIds.length !== realIds.length) return;
    const tempKey = JSON.stringify(tempIds);
    setUndoStack(prev => prev.map(action => {
      if (action.type !== "copy") return action;
      const actionKey = JSON.stringify(action.nodeIds);
      if (actionKey !== tempKey) return action;
      return { ...action, nodeIds: realIds };
    }));
  }, []);

  const removeUndoCreateAction = useCallback((nodeId: string) => {
    setUndoStack(prev => prev.filter(action => !(action.type === "create" && action.nodeId === nodeId)));
  }, []);

  const runWithConcurrency = useCallback(async <T,>(items: T[], limit: number, worker: (item: T) => Promise<void>) => {
    if (items.length === 0) return;
    const queue = items.slice();
    const concurrency = Math.max(1, Math.min(limit, queue.length));
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) return;
        await worker(next);
      }
    });
    await Promise.all(workers);
  }, []);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const shareTargetId = useMemo(() => {
    const targetId = shareTargetNodeId || activeNodeId;
    if (!targetId || targetId.startsWith("virtual-plan:")) return null;
    const node = nodeById.get(targetId);
    if (!node || node.id.startsWith("temp-")) return null;
    return node.id;
  }, [shareTargetNodeId, activeNodeId, nodeById]);
  useEffect(() => {
    shareTargetIdRef.current = shareTargetId;
  }, [shareTargetId]);
  const updateNodeShareSettings = useCallback((nodeId: string, nextIsPublic: boolean, nextRole?: "viewer" | "editor") => {
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((node) => {
        if (node.id !== nodeId) return node;
        const currentRole = node.public_access_role ?? null;
        const resolvedRole = nextRole ?? currentRole;
        if (node.is_public === nextIsPublic && currentRole === resolvedRole) {
          return node;
        }
        changed = true;
        return {
          ...node,
          is_public: nextIsPublic,
          ...(nextRole ? { public_access_role: nextRole } : {}),
        };
      });
      return changed ? next : prev;
    });
  }, []);
  const applyShareSettings = useCallback((
    nodeId: string,
    changes: {
      isPublic?: boolean;
      publicAccessRole?: "viewer" | "editor";
      sharedUsers?: ShareSettingsUser[];
    },
    applyIfActive = true,
    fetchedAtOverride?: number
  ) => {
    const prev = shareSettingsCacheRef.current.get(nodeId) ?? null;
    const localIsPublic = Boolean(nodeById.get(nodeId)?.is_public);
    const nextIsPublic = changes.isPublic ?? prev?.isPublic ?? localIsPublic;
    const nextRole = changes.publicAccessRole ?? prev?.publicAccessRole ?? "viewer";
    const nextSharedUsers = changes.sharedUsers ?? prev?.sharedUsers ?? [];
    const isComplete = changes.isPublic !== undefined && changes.publicAccessRole !== undefined;
    const fetchedAt = fetchedAtOverride ?? (prev || isComplete ? Date.now() : 0);
    const next: ShareSettings = {
      nodeId,
      isPublic: nextIsPublic,
      publicAccessRole: nextRole,
      sharedUsers: nextSharedUsers,
      fetchedAt,
    };
    shareSettingsCacheRef.current.set(nodeId, next);
    updateNodeShareSettings(nodeId, next.isPublic, next.publicAccessRole);
    if (applyIfActive && shareTargetIdRef.current === nodeId) {
      setShareSettings(next);
      setIsSharePublic(next.isPublic);
      isSharePublicRef.current = next.isPublic;
      setIsSharePublicLoaded(true);
      setIsShareViewReady(true);
    }
    return next;
  }, [nodeById, updateNodeShareSettings]);
  const fetchShareSettings = useCallback(async (nodeId: string, applyIfActive: boolean, force = false) => {
    let awaitedPromise: Promise<ShareSettings | null> | null = null;
    try {
      const cached = shareSettingsCacheRef.current.get(nodeId);
      if (!force && cached?.fetchedAt && Date.now() - cached.fetchedAt < SHARE_SETTINGS_TTL_MS) {
        if (applyIfActive && shareTargetIdRef.current === nodeId) {
          setShareSettings(cached);
          setIsSharePublic(cached.isPublic);
          isSharePublicRef.current = cached.isPublic;
          setIsSharePublicLoaded(true);
        }
        return cached;
      }

      const nextVersion = (shareSettingsFetchVersionRef.current.get(nodeId) ?? 0) + 1;
      shareSettingsFetchVersionRef.current.set(nodeId, nextVersion);

      if (!force) {
        const pending = shareSettingsPromiseRef.current.get(nodeId);
        if (pending) {
          awaitedPromise = pending;
          const settings = await pending;
          if (settings && shareSettingsFetchVersionRef.current.get(nodeId) === nextVersion) {
            applyShareSettings(nodeId, settings, applyIfActive, settings.fetchedAt);
          }
          return settings;
        }
      }

      const promise = (async () => {
        const res = await fetch(`/api/share?nodeId=${nodeId}`);
        if (!res.ok) return null;
        const data = await res.json();
        const publicAccessRole = data.publicAccessRole === "editor" ? "editor" : "viewer";
        const settings: ShareSettings = {
          nodeId,
          isPublic: Boolean(data.isPublic),
          publicAccessRole,
          sharedUsers: Array.isArray(data.sharedUsers) ? data.sharedUsers : [],
          fetchedAt: Date.now(),
        };
        if (shareSettingsFetchVersionRef.current.get(nodeId) === nextVersion) {
          applyShareSettings(nodeId, settings, applyIfActive, settings.fetchedAt);
        }
        return settings;
      })();

      awaitedPromise = promise;
      shareSettingsPromiseRef.current.set(nodeId, promise);
      const settings = await promise;
      if (shareSettingsPromiseRef.current.get(nodeId) === promise) {
        shareSettingsPromiseRef.current.delete(nodeId);
      }
      return settings;
    } catch {
      if (awaitedPromise && shareSettingsPromiseRef.current.get(nodeId) === awaitedPromise) {
        shareSettingsPromiseRef.current.delete(nodeId);
      }
      return null;
    }
  }, [applyShareSettings]);
  const refreshShareSettings = useCallback((nodeId: string) => {
    void fetchShareSettings(nodeId, true, true);
  }, [fetchShareSettings]);
  const activeRealtimeNodeId = useMemo(() => {
    if (!activeNodeId) return null;
    if (
      activeNodeId.startsWith("virtual-plan:") ||
      activeNodeId.startsWith("shared:") ||
      activeNodeId.startsWith("temp-")
    ) {
      return null;
    }
    const node = nodeById.get(activeNodeId);
    if (!node || node.type !== "file") return null;
    return node.id;
  }, [activeNodeId, nodeById]);

  // Real-time subscription for the currently active file
  useEffect(() => {
    if (!activeRealtimeNodeId) return;
    const channelName = getFileChannelName(activeRealtimeNodeId);
    const channel = supabase
      .channel(channelName)
      .on(
        "broadcast",
        { event: "file_content_updated" },
        ({ payload }: { payload: { nodeId?: string; text?: string; source?: string } }) => {
          const nodeId = payload?.nodeId;
          const nextContent = payload?.text;
          if (!nodeId || nodeId !== activeRealtimeNodeId || typeof nextContent !== "string") return;
          applyRemoteContentUpdate(nodeId, nextContent, payload?.source);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "file_contents",
          filter: `node_id=eq.${activeRealtimeNodeId}`,
        },
        (payload: { new: { text?: string } | null }) => {
          const nextContent = payload.new?.text;
          if (typeof nextContent !== "string") return;
          applyRemoteContentUpdate(activeRealtimeNodeId, nextContent);
        }
      )
      .subscribe((status: string) => {
        activeFileChannelRef.current = channel;
        activeFileChannelNodeIdRef.current = activeRealtimeNodeId;
        activeFileChannelSubscribedRef.current = status === "SUBSCRIBED";
      });

    return () => {
      if (activeFileChannelRef.current === channel) {
        activeFileChannelRef.current = null;
        activeFileChannelNodeIdRef.current = null;
        activeFileChannelSubscribedRef.current = false;
      }
      supabase.removeChannel(channel);
    };
  }, [activeRealtimeNodeId, applyRemoteContentUpdate, getFileChannelName, supabase]);

  useEffect(() => {
    if (!isShareOpen) return;
    if (shareWorkspaceId) {
      setShareSettings(null);
      setIsSharePublic(false);
      isSharePublicRef.current = false;
      setIsSharePublicLoaded(true);
      return;
    }
    if (!shareTargetId) {
      setShareSettings(null);
      setIsSharePublicLoaded(true);
      return;
    }

    const cached = shareSettingsCacheRef.current.get(shareTargetId);
    if (cached) {
      setShareSettings(cached);
      setIsSharePublic(cached.isPublic);
      isSharePublicRef.current = cached.isPublic;
      setIsSharePublicLoaded(true);
    } else {
      setShareSettings(null);
      const localNode = nodeById.get(shareTargetId);
      const localIsPublic = Boolean(localNode?.is_public);
      setIsSharePublic(localIsPublic);
      isSharePublicRef.current = localIsPublic;
      setIsSharePublicLoaded(true);
    }

    void fetchShareSettings(shareTargetId, true);
  }, [isShareOpen, shareTargetId, shareWorkspaceId, nodeById, fetchShareSettings]);

  useEffect(() => {
    if (!activeNodeId) return;
    if (
      activeNodeId.startsWith("temp-") ||
      activeNodeId.startsWith("virtual-plan:") ||
      activeNodeId.startsWith("shared:")
    ) {
      return;
    }
    void fetchShareSettings(activeNodeId, false);
  }, [activeNodeId, fetchShareSettings]);

  const pathByNodeId = useMemo(() => {
    const cache = new Map<string, string>();

    const build = (id: string, seen: Set<string>): string => {
      if (cache.has(id)) return cache.get(id)!;
      if (seen.has(id)) return ""; // cycle guard
      const node = nodeById.get(id);
      if (!node) return "";
      seen.add(id);
      const parentPath = node.parent_id ? build(node.parent_id, seen) : "";
      const full = parentPath ? `${parentPath}/${node.name}` : node.name;
      cache.set(id, full);
      return full;
    };

    for (const n of nodes) {
      build(n.id, new Set());
    }

    return cache;
  }, [nodeById, nodes]);

  const nodeIdByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes) {
      if (String(node.id).startsWith("temp-")) continue;
      const path = pathByNodeId.get(node.id);
      if (path) {
        map.set(path, node.id);
      }
    }
    return map;
  }, [nodes, pathByNodeId]);

  const waitForRealNodeIdByPath = useCallback((path: string, timeoutMs: number = 70000) => {
    const existing = nodeIdByPath.get(path);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<string | null>((resolve) => {
      const key = `${path}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const timeoutId = window.setTimeout(() => {
        pendingPathResolversRef.current.delete(key);
        resolve(null);
      }, timeoutMs);
      pendingPathResolversRef.current.set(key, { path, resolve, timeoutId });
    });
  }, [nodeIdByPath]);

  const registerTempIdMapping = useCallback((tempId: string, realId: string) => {
    if (!tempId || !realId) return;
    tempIdRealIdMapRef.current.set(tempId, realId);
    const pending = pendingTempResolversRef.current.get(tempId);
    if (pending) {
      for (const entry of pending) {
        window.clearTimeout(entry.timeoutId);
        entry.resolve(realId);
      }
      pendingTempResolversRef.current.delete(tempId);
    }

    if (!editableTempNodeIdsRef.current.has(tempId)) {
      return;
    }

    editableTempNodeIdsRef.current.delete(tempId);
    const hasTempContent = Object.prototype.hasOwnProperty.call(tempFileContentsRef.current, tempId);
    if (!hasTempContent) return;

    const content = tempFileContentsRef.current[tempId] ?? "";
    setTempFileContents((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, tempId)) return prev;
      const next = { ...prev };
      delete next[tempId];
      tempFileContentsRef.current = next;
      return next;
    });
    pendingContentByRealIdRef.current.set(realId, content);
    const activeId = activeNodeIdRef.current;
    if (activeId === tempId || activeId === realId) {
      setFileContent(content);
    }

    void supabase
      .from("file_contents")
      .upsert({ node_id: realId, text: content }, { onConflict: "node_id" })
      .then(({ error }: { error: Error | null }) => {
        if (error) throw error;
        pendingContentByRealIdRef.current.delete(realId);
      })
      .catch((error: Error) => {
        console.error("Failed to save temp content:", error?.message ?? error);
      });
  }, [supabase]);

  const waitForRealNodeIdByTempId = useCallback((tempId: string, timeoutMs: number = 70000) => {
    const existing = tempIdRealIdMapRef.current.get(tempId);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<string | null>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        const pending = pendingTempResolversRef.current.get(tempId);
        if (pending) {
          const nextPending = pending.filter((entry) => entry.resolve !== resolve);
          if (nextPending.length > 0) {
            pendingTempResolversRef.current.set(tempId, nextPending);
          } else {
            pendingTempResolversRef.current.delete(tempId);
          }
        }
        resolve(null);
      }, timeoutMs);
      const entry = { resolve, timeoutId };
      const pending = pendingTempResolversRef.current.get(tempId);
      if (pending) {
        pending.push(entry);
      } else {
        pendingTempResolversRef.current.set(tempId, [entry]);
      }
    });
  }, []);

  const resolveMaybeTempNodeId = useCallback(async (nodeId: string | null, timeoutMs: number = 70000) => {
    if (!nodeId) return null;
    if (!String(nodeId).startsWith("temp-")) return nodeId;
    const mapped = tempIdRealIdMapRef.current.get(nodeId);
    if (mapped) return mapped;
    // pathByNodeIdから取得を試み、なければtempIdPathMapRefから取得
    const path = pathByNodeId.get(nodeId) ?? tempIdPathMapRef.current.get(nodeId);
    const waitForTempId = waitForRealNodeIdByTempId(nodeId, timeoutMs);

    if (!path) {
      return await waitForTempId;
    }

    const waitForPath = waitForRealNodeIdByPath(path, timeoutMs);

    return await new Promise<string | null>((resolve) => {
      let pending = 2;
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        if (value) {
          settled = true;
          registerTempIdMapping(nodeId, value);
          resolve(value);
          return;
        }
        pending -= 1;
        if (pending === 0) {
          settled = true;
          resolve(null);
        }
      };
      waitForTempId.then(finish).catch(() => finish(null));
      waitForPath.then(finish).catch(() => finish(null));
    });
  }, [pathByNodeId, registerTempIdMapping, waitForRealNodeIdByPath, waitForRealNodeIdByTempId]);

  useEffect(() => {
    if (pendingPathResolversRef.current.size === 0) return;
    for (const [key, pending] of pendingPathResolversRef.current) {
      const resolvedId = nodeIdByPath.get(pending.path);
      if (!resolvedId) continue;
      window.clearTimeout(pending.timeoutId);
      pending.resolve(resolvedId);
      pendingPathResolversRef.current.delete(key);
    }
  }, [nodeIdByPath]);

  // ノード一覧を取得
  const fetchNodes = useCallback(async (showLoading = true) => {
    // Only show loading skeleton if we don't have any data yet
    if (showLoading) {
      setIsLoading((prev) => prev);
      setNodes((prev) => {
        if (prev.length === 0) setIsLoading(true);
        return prev;
      });
    }
    // #region agent log
    // #endregion
    // Supabase REST defaults to 1000 rows; paginate to load everything.
    const pageSize = 1000;
    const allNodes: Node[] = [];
    let page = 0;
    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("nodes")
        .select("*")
        .eq("project_id", projectId)
        .order("parent_id", { ascending: true, nullsFirst: true })
        .order("type", { ascending: false })
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      if (error) {
        // #region agent log
        // #endregion
        console.error("Error fetching nodes:", error);
        setIsLoading(false);
        return [];
      }

      const pageData = data || [];
      // #region agent log
      // #endregion
      allNodes.push(...pageData);
      if (pageData.length < pageSize) break;
      page += 1;
    }

    setNodes((prev) => {
      const serverNodes = dedupeNodesById(allNodes);
      const serverKeys = new Set(serverNodes.map(getNodeKey));
      const serverIds = new Set(serverNodes.map((node) => node.id));
      for (const id of Array.from(pendingNodeIdsRef.current)) {
        if (serverIds.has(id)) {
          pendingNodeIdsRef.current.delete(id);
        }
      }
      const pendingNodes = prev.filter((node) => {
        const isTemp = String(node.id).startsWith("temp-");
        if (isTemp) {
          return !serverKeys.has(getNodeKey(node));
        }
        return pendingNodeIdsRef.current.has(node.id) && !serverIds.has(node.id);
      });
      const newNodes = dedupeNodesById([...serverNodes, ...pendingNodes]);
      // Cache nodes for faster reload
      setCachedNodes(projectId, serverNodes);
      return newNodes;
    });
    setIsLoading(false);
    return allNodes;
  }, [projectId, supabase]);

  // Cache initial nodes from server on mount
  useEffect(() => {
    if (initialNodes.length > 0) {
      setCachedNodes(projectId, initialNodes);
    }
  }, [projectId, initialNodes]);

  // Fetch nodes on mount - silent background refresh if we have initial data
  const hasInitialDataRef = useRef(initialNodes.length > 0);
  useEffect(() => {
    fetchNodes(!hasInitialDataRef.current);
  }, [fetchNodes]);

  // Prompt user for undo confirmation
  const promptUndoConfirmation = useCallback((actionName: string, actionType: "create" | "copy" | "upload"): Promise<boolean> => {
    return new Promise((resolve) => {
      undoDialogResolveRef.current = resolve;
      setUndoDialog({
        isOpen: true,
        actionName,
        actionType,
      });
    });
  }, []);

  // Handle undo dialog response
  const handleUndoDialogResponse = useCallback((confirmed: boolean) => {
    const resolve = undoDialogResolveRef.current;
    undoDialogResolveRef.current = null;

    // Close dialog immediately
    setUndoDialog({
      isOpen: false,
      actionName: "",
      actionType: "create",
    });

    // Resolve after dialog closes
    if (resolve) {
      resolve(confirmed);
    }
  }, []);

  // Undo/Redo handlers (must be after fetchNodes)
  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    // #region agent log
    // #endregion

    let lastIndex = undoStack.length - 1;
    while (lastIndex >= 0 && undoStack[lastIndex].type === "delete") {
      lastIndex -= 1;
    }
    if (lastIndex < 0) {
      setUndoStack([]);
      return;
    }

    const trimmedStack = undoStack.slice(0, lastIndex + 1);
    const action = trimmedStack[trimmedStack.length - 1];
    const uploadGroup = (action.type === "create" && action.source === "upload")
      ? (() => {
        if (!action.batchId) return [action];
        const group: UndoAction[] = [];
        for (let i = trimmedStack.length - 1; i >= 0; i -= 1) {
          const candidate = trimmedStack[i];
          if (candidate.type === "create" && candidate.source === "upload" && candidate.batchId === action.batchId) {
            group.unshift(candidate);
            continue;
          }
          break;
        }
        return group;
      })()
      : [];
    const actionsToUndo = uploadGroup.length > 0 ? uploadGroup : [action];
    // #region agent log
    // #endregion

    // Show confirmation dialog for create and copy actions
    if (action.type === "create" || action.type === "copy") {
      let actionName: string;
      let actionType: "create" | "copy" | "upload";

      if (action.type === "create") {
        const isUpload = action.source === "upload";
        if (isUpload) {
          const countResources = (rootId: string, fallbackNode?: Node) => {
            const node = nodes.find(n => n.id === rootId);
            const snapshot = node ? nodes : [...nodes, ...(fallbackNode ? [fallbackNode] : [])];
            let count = 0;
            const collectChildren = (id: string) => {
              count += 1;
              snapshot
                .filter(n => n.parent_id === id)
                .forEach(child => collectChildren(child.id));
            };
            collectChildren(rootId);
            return count;
          };
          const count = actionsToUndo.reduce((sum, act) => {
            if (act.type !== "create") return sum;
            return sum + countResources(act.nodeId, act.node);
          }, 0);
          actionName = `${count} リソース`;
          actionType = "upload";
        } else {
        const node = nodes.find(n => n.id === action.nodeId);
        actionName = node?.name || action.node?.name || "ファイル";
          actionType = "create";
        }
      } else {
        // copy action
        const count = action.nodeIds.length;
        if (count > 1) {
          actionName = `${count} ファイル`;
        } else {
        actionName = action.names?.[0] || "項目";
        }
        actionType = "copy";
      }

      const confirmed = await promptUndoConfirmation(actionName, actionType);
      if (!confirmed) {
        if (trimmedStack.length !== undoStack.length) {
          setUndoStack(trimmedStack);
        }
        return;
      }
    }

    setUndoStack(trimmedStack.slice(0, -actionsToUndo.length));

    try {
      switch (action.type) {
        case "create": {
          const undoCreateAction = async (createAction: UndoAction) => {
            if (createAction.type !== "create") return;
            console.log("[Undo] action.nodeId:", createAction.nodeId);
            const resolveCreateNodeId = async (): Promise<string | null> => {
              if (!String(createAction.nodeId).startsWith("temp-")) {
                console.log("[Undo] nodeId is not temp, returning as is:", createAction.nodeId);
                return createAction.nodeId;
              }
              const mapped = tempIdRealIdMapRef.current.get(createAction.nodeId);
              console.log("[Undo] mapped from tempIdRealIdMapRef:", mapped);
              if (mapped) return mapped;
              const path = tempIdPathMapRef.current.get(createAction.nodeId) ?? pathByNodeId.get(createAction.nodeId);
              console.log("[Undo] path:", path);
              if (path) {
                const existing = nodeIdByPath.get(path);
                console.log("[Undo] existing from nodeIdByPath:", existing);
                if (existing) return existing;
              }
              console.log("[Undo] falling back to resolveMaybeTempNodeId");
              return await resolveMaybeTempNodeId(createAction.nodeId, 10000);
            };

            const resolvePromise = resolveCreateNodeId();
            const nodeFromState = nodes.find(n => n.id === createAction.nodeId) ?? createAction.node;
            const currentNodes = nodes;
            const nodeToDelete = nodeFromState ?? createAction.node;
            const isFolder = nodeToDelete?.type === "folder";
            console.log("[Undo] nodeToDelete (initial):", nodeToDelete);

            const buildIdsToRemove = (rootId: string, snapshot: Node[]) => {
              const ids = new Set<string>();
              if (isFolder) {
                const collectChildren = (id: string) => {
                  ids.add(id);
                  snapshot.filter((n: Node) => n.parent_id === id).forEach((child: Node) => collectChildren(child.id));
                };
                collectChildren(rootId);
              } else {
                ids.add(rootId);
              }
              return ids;
            };

            const removeIdsFromUi = (ids: Set<string>) => {
              setNodes(prev => {
                const filtered = prev.filter(n => !ids.has(n.id));
                console.log("[Undo] nodes before:", prev.length, "after:", filtered.length);
                return filtered;
              });
              setOpenTabs(prev => prev.filter(id => !ids.has(id)));
              if (activeNodeId && ids.has(activeNodeId)) {
                setActiveNodeId(null);
              }
              setSelectedNodeIds(prev => {
                if (prev.size === 0) return prev;
                const next = new Set(prev);
                ids.forEach((id) => next.delete(id));
                return next;
              });
            };

            const idsToRemove = buildIdsToRemove(createAction.nodeId, currentNodes);
            console.log("[Undo] idsToRemove (temp):", Array.from(idsToRemove));

            // Optimistic: update UI immediately
            removeIdsFromUi(idsToRemove);

            const resolvedNodeId = await resolvePromise;
            if (!resolvedNodeId) {
              console.log("[Undo] resolvedNodeId is null, skipping server delete");
              return;
            }

            if (resolvedNodeId !== createAction.nodeId) {
              const resolvedIdsToRemove = buildIdsToRemove(resolvedNodeId, nodes);
              if (resolvedIdsToRemove.size > 0) {
                console.log("[Undo] idsToRemove (resolved):", Array.from(resolvedIdsToRemove));
                removeIdsFromUi(resolvedIdsToRemove);
              }
            }

          const contentPromise = nodeToDelete?.type === "file"
            ? supabase
              .from("file_contents")
              .select("text")
                .eq("node_id", resolvedNodeId)
              .single()
                .then(({ data }: { data: { text?: string } | null }) => data?.text)
              .catch(() => undefined)
            : Promise.resolve(undefined);

            // Delete the created node
            console.log("[Undo] Calling API to delete node:", resolvedNodeId);
            const res = await fetch("/api/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete_node", id: resolvedNodeId }),
            });
            console.log("[Undo] API response status:", res.status);
            if (!res.ok) throw new Error("Failed to undo create");

            const contentToSave = await contentPromise;
            // Push to redo stack (delete action to redo = create again)
            if (nodeToDelete) {
              const nodeForRedo = nodeToDelete.id === resolvedNodeId ? nodeToDelete : { ...nodeToDelete, id: resolvedNodeId };
              setRedoStack(prev => [...prev, { type: "delete", nodeId: resolvedNodeId, node: nodeForRedo, content: contentToSave }]);
            }
          };

          const createActions = actionsToUndo.filter((a): a is Extract<UndoAction, { type: "create" }> => a.type === "create");
          if (createActions.length > 1) {
            const currentNodes = nodes;
            const buildIdsToRemove = (rootId: string, snapshot: Node[], isFolder: boolean) => {
              const ids = new Set<string>();
              if (isFolder) {
                const collectChildren = (id: string) => {
                  ids.add(id);
                  snapshot.filter((n: Node) => n.parent_id === id).forEach((child: Node) => collectChildren(child.id));
                };
                collectChildren(rootId);
              } else {
                ids.add(rootId);
              }
              return ids;
            };
            const removeIdsFromUi = (ids: Set<string>) => {
              if (ids.size === 0) return;
              setNodes(prev => prev.filter(n => !ids.has(n.id)));
              setOpenTabs(prev => prev.filter(id => !ids.has(id)));
              if (activeNodeId && ids.has(activeNodeId)) {
            setActiveNodeId(null);
          }
          setSelectedNodeIds(prev => {
                if (prev.size === 0) return prev;
            const next = new Set(prev);
                ids.forEach((id) => next.delete(id));
            return next;
          });
            };
            const resolveCreateNodeId = async (createAction: UndoAction): Promise<string | null> => {
              if (createAction.type !== "create") return null;
              if (!String(createAction.nodeId).startsWith("temp-")) {
                return createAction.nodeId;
              }
              const mapped = tempIdRealIdMapRef.current.get(createAction.nodeId);
              if (mapped) return mapped;
              const path = tempIdPathMapRef.current.get(createAction.nodeId) ?? pathByNodeId.get(createAction.nodeId);
              if (path) {
                const existing = nodeIdByPath.get(path);
                if (existing) return existing;
              }
              return await resolveMaybeTempNodeId(createAction.nodeId, 10000);
            };

            const actionMeta = createActions.map((createAction) => {
              const nodeFromState = nodes.find(n => n.id === createAction.nodeId) ?? createAction.node;
              const nodeToDelete = nodeFromState ?? createAction.node;
              const isFolder = nodeToDelete?.type === "folder";
              return { createAction, nodeToDelete, isFolder };
            });

            const idsToRemove = new Set<string>();
            for (const meta of actionMeta) {
              const ids = buildIdsToRemove(meta.createAction.nodeId, currentNodes, Boolean(meta.isFolder));
              ids.forEach((id) => idsToRemove.add(id));
            }
            removeIdsFromUi(idsToRemove);

            const resolvedIds = await Promise.all(actionMeta.map((meta) => resolveCreateNodeId(meta.createAction)));
            const resolvedIdsToRemove = new Set<string>();
            for (let i = 0; i < actionMeta.length; i += 1) {
              const resolvedNodeId = resolvedIds[i];
              if (!resolvedNodeId) continue;
              const meta = actionMeta[i];
              if (resolvedNodeId !== meta.createAction.nodeId) {
                const ids = buildIdsToRemove(resolvedNodeId, nodes, Boolean(meta.isFolder));
                ids.forEach((id) => resolvedIdsToRemove.add(id));
              }
            }
            removeIdsFromUi(resolvedIdsToRemove);

            const deletePromises = resolvedIds
              .filter((id): id is string => Boolean(id))
              .map((resolvedNodeId) => fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "delete_node", id: resolvedNodeId }),
              }));
            await Promise.all(deletePromises);

            const contentResults = await Promise.all(actionMeta.map(async (meta, index) => {
              const resolvedNodeId = resolvedIds[index];
              if (!resolvedNodeId) return { resolvedNodeId: null, content: undefined, nodeToDelete: meta.nodeToDelete };
              if (meta.nodeToDelete?.type !== "file") {
                return { resolvedNodeId, content: undefined, nodeToDelete: meta.nodeToDelete };
              }
              const { data } = await supabase
                .from("file_contents")
                .select("text")
                .eq("node_id", resolvedNodeId)
                .single();
              return { resolvedNodeId, content: data?.text, nodeToDelete: meta.nodeToDelete };
            }));

            const redoActions = contentResults
              .filter((entry) => entry.resolvedNodeId && entry.nodeToDelete)
              .map((entry) => {
                const resolvedNodeId = entry.resolvedNodeId as string;
                const nodeToDelete = entry.nodeToDelete as Node;
                const nodeForRedo = nodeToDelete.id === resolvedNodeId ? nodeToDelete : { ...nodeToDelete, id: resolvedNodeId };
                return { type: "delete", nodeId: resolvedNodeId, node: nodeForRedo, content: entry.content } as UndoAction;
              });
            if (redoActions.length > 0) {
              setRedoStack(prev => [...prev, ...redoActions]);
            }
            break;
          }

          for (const act of createActions) {
            await undoCreateAction(act);
          }
          break;
        }
        case "rename": {
          // Optimistic: rename back to old name
          setNodes(prev => prev.map(n => n.id === action.nodeId ? { ...n, name: action.oldName } : n));

          // Rename back to old name
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "rename_node", id: action.nodeId, newName: action.oldName }),
          });
          if (!res.ok) {
            setNodes(prev => prev.map(n => n.id === action.nodeId ? { ...n, name: action.newName } : n));
            throw new Error("Failed to undo rename");
          }

          // Push to redo stack (swap old and new names)
          setRedoStack(prev => [...prev, { type: "rename", nodeId: action.nodeId, oldName: action.newName, newName: action.oldName }]);
          break;
        }
        case "move": {
          // Optimistic: move back to original parents
          setNodes(prev => prev.map(n => {
            const index = action.nodeIds.indexOf(n.id);
            if (index >= 0) {
              return { ...n, parent_id: action.oldParentIds[index] };
            }
            return n;
          }));

          // Move back to original parent
          try {
            await Promise.all(action.nodeIds.map(async (nodeId, index) => {
              const res = await fetch("/api/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "move_node", id: nodeId, newParentId: action.oldParentIds[index] }),
              });
              if (!res.ok) throw new Error(`Failed to undo move for ${nodeId}`);
            }));
          } catch (error) {
            setNodes(prev => prev.map(n => {
              if (action.nodeIds.includes(n.id)) {
                return { ...n, parent_id: action.newParentId };
              }
              return n;
            }));
            throw error;
          }

          // Push to redo stack (swap old and new parent IDs)
          const currentParentIds = action.nodeIds.map(() => action.newParentId);
          setRedoStack(prev => [...prev, { type: "move", nodeIds: action.nodeIds, oldParentIds: currentParentIds, newParentId: action.oldParentIds[0] }]);
          break;
        }
        case "copy": {
          // #region agent log
          // #endregion
          const snapshotNodes = nodes;
          const resolveCopyNodeId = (id: string) => tempIdRealIdMapRef.current.get(id) ?? id;
          const resolvedNodeIds = action.nodeIds.map(resolveCopyNodeId);
          const missingInState = resolvedNodeIds.some((id) => !snapshotNodes.some((n) => n.id === id));
          if (missingInState) {
            // #region agent log
            // #endregion
          }

          const idsToRemove = new Set<string>();
          const collectChildren = (parentId: string) => {
            idsToRemove.add(parentId);
            snapshotNodes
              .filter(n => n.parent_id === parentId)
              .forEach(child => collectChildren(child.id));
          };
          action.nodeIds.forEach((nodeId) => collectChildren(nodeId));
          resolvedNodeIds.forEach((nodeId) => collectChildren(nodeId));
          const tempIdsToRemove: string[] = [];
          for (const [tempId, realId] of tempIdRealIdMapRef.current.entries()) {
            if (resolvedNodeIds.includes(realId)) {
              tempIdsToRemove.push(tempId);
              idsToRemove.add(tempId);
            }
          }
          action.nodeIds.forEach((nodeId) => idsToRemove.add(nodeId));
          resolvedNodeIds.forEach((nodeId) => idsToRemove.add(nodeId));
          // #region agent log
          // #endregion

          // Optimistic: remove copied nodes immediately
          setNodes(prev => prev.filter(n => !idsToRemove.has(n.id)));
          setOpenTabs(prev => prev.filter(id => !idsToRemove.has(id)));
          if (activeNodeId && idsToRemove.has(activeNodeId)) {
            setActiveNodeId(null);
          }
          setSelectedNodeIds(prev => {
            if (prev.size === 0) return prev;
            const next = new Set(prev);
            idsToRemove.forEach((nodeId) => next.delete(nodeId));
            return next;
          });
          if (tempIdsToRemove.length > 0) {
            for (const tempId of tempIdsToRemove) {
              tempIdPathMapRef.current.delete(tempId);
              tempIdRealIdMapRef.current.delete(tempId);
            }
          }

          // Delete the copied nodes
          // #region agent log
          // #endregion
          const deletableIds = resolvedNodeIds.filter((id) => !String(id).startsWith("temp-"));
          const unresolvedTempIds = action.nodeIds.filter((id) => String(id).startsWith("temp-") && !tempIdRealIdMapRef.current.get(id));
          const deleteResults = await Promise.all(deletableIds.map(async (nodeId) => {
            const res = await fetch("/api/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete_node", id: nodeId }),
            });
            return res.status;
          }));
          for (const tempId of unresolvedTempIds) {
            void (async () => {
              const realId = await waitForRealNodeIdByTempId(tempId);
              if (!realId) return;
              await fetch("/api/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "delete_node", id: realId }),
              });
            })();
          }
          // #region agent log
          // #endregion
          // Refresh nodes to sync UI after deletion (in background, no loading)
          void fetchNodes(false);
          // Push to redo stack (copy action - but we can't easily redo copy, so skip)
          break;
        }
      }
    } catch (error: any) {
      alert(`元に戻せませんでした: ${error.message}`);
      // Put the action back on the stack if it failed
      setUndoStack(prev => [...prev, action]);
      void fetchNodes(false);
    }
  }, [undoStack, nodes, activeNodeId, fetchNodes, supabase, promptUndoConfirmation, nodeIdByPath, pathByNodeId, resolveMaybeTempNodeId]);

  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0) return;

    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));

    try {
      switch (action.type) {
        case "delete": {
          // Redo delete = restore deleted node
          const { node, content } = action;

          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: node.type === "file" ? "create_file" : "create_folder",
              path: node.name,
              content: content || "",
              projectId: node.project_id,
              parentId: node.parent_id,
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || "Failed to redo");

          // Push back to undo stack
          setUndoStack(prev => [...prev, { type: "create", nodeId: json.nodeId, node, content }]);
          fetchNodes();
          break;
        }
        case "create": {
          // Redo create = delete the node again
          const nodeToDelete = nodes.find(n => n.id === action.nodeId);
          const contentPromise = (action.node?.type === "file" || nodeToDelete?.type === "file")
            ? supabase
              .from("file_contents")
              .select("text")
              .eq("node_id", action.nodeId)
              .single()
              .then(({ data }: { data: { text?: string } | null }) => data?.text)
              .catch(() => action.content)
            : Promise.resolve(action.content);

          // Optimistic: remove immediately
          setNodes(prev => prev.filter(n => n.id !== action.nodeId));
          setOpenTabs(prev => prev.filter(id => id !== action.nodeId));
          if (activeNodeId === action.nodeId) {
            setActiveNodeId(null);
          }
          setSelectedNodeIds(prev => {
            if (!prev.has(action.nodeId)) return prev;
            const next = new Set(prev);
            next.delete(action.nodeId);
            return next;
          });

          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete_node", id: action.nodeId }),
          });
          if (!res.ok) throw new Error("Failed to redo delete");

          const contentToSave = await contentPromise;
          // Push back to undo stack
          const nodeInfo = nodeToDelete || action.node;
          if (nodeInfo) {
            setUndoStack(prev => [...prev, { type: "delete", nodeId: action.nodeId, node: nodeInfo, content: contentToSave }]);
          }
          break;
        }
        case "rename": {
          // Optimistic: apply rename immediately
          setNodes(prev => prev.map(n => n.id === action.nodeId ? { ...n, name: action.oldName } : n));

          // Redo rename = rename back to the "new" name (which is now oldName in redo action)
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "rename_node", id: action.nodeId, newName: action.oldName }),
          });
          if (!res.ok) {
            setNodes(prev => prev.map(n => n.id === action.nodeId ? { ...n, name: action.newName } : n));
            throw new Error("Failed to redo rename");
          }

          // Push back to undo stack (swap names again)
          setUndoStack(prev => [...prev, { type: "rename", nodeId: action.nodeId, oldName: action.newName, newName: action.oldName }]);
          break;
        }
        case "move": {
          // Optimistic: move to the "new" parent (which is now in oldParentIds)
          setNodes(prev => prev.map(n => {
            const index = action.nodeIds.indexOf(n.id);
            if (index >= 0) {
              return { ...n, parent_id: action.oldParentIds[index] };
            }
            return n;
          }));

          // Redo move = move to the "new" parent (which is now in oldParentIds)
          try {
            await Promise.all(action.nodeIds.map(async (nodeId, index) => {
              const res = await fetch("/api/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "move_node", id: nodeId, newParentId: action.oldParentIds[index] }),
              });
              if (!res.ok) throw new Error(`Failed to redo move for ${nodeId}`);
            }));
          } catch (error) {
            setNodes(prev => prev.map(n => {
              if (action.nodeIds.includes(n.id)) {
                return { ...n, parent_id: action.newParentId };
              }
              return n;
            }));
            throw error;
          }

          // Push back to undo stack
          const currentParentIds = action.nodeIds.map(() => action.newParentId);
          setUndoStack(prev => [...prev, { type: "move", nodeIds: action.nodeIds, oldParentIds: currentParentIds, newParentId: action.oldParentIds[0] }]);
          break;
        }
        case "copy": {
          // Cannot redo copy easily, skip
          break;
        }
      }
    } catch (error: any) {
      alert(`やり直せませんでした: ${error.message}`);
      // Put the action back on the redo stack if it failed
      setRedoStack(prev => [...prev, action]);
      void fetchNodes(false);
    }
  }, [redoStack, nodes, activeNodeId, fetchNodes, supabase]);

  // --- Source Control helpers ---
  const scBaselineStorageKey = useMemo(() => `cursor_sc_baseline_${projectId}`, [projectId]);

  const loadScBaseline = useCallback(() => {
    try {
      const raw = localStorage.getItem(scBaselineStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as Record<string, { nodeId?: string; content: string }>;
    } catch {
      return null;
    }
  }, [scBaselineStorageKey]);

  const saveScBaseline = useCallback(
    (snapshot: Record<string, { nodeId?: string; content: string }>) => {
      try {
        localStorage.setItem(scBaselineStorageKey, JSON.stringify(snapshot));
      } catch {
        // ignore
      }
    },
    [scBaselineStorageKey]
  );

  const countAddedRemoved = useCallback((oldContent: string, newContent: string) => {
    const parts = diffLines(oldContent, newContent);
    let added = 0;
    let removed = 0;
    for (const part of parts) {
      const split = part.value.split("\n").filter((line, i, arr) => !(i === arr.length - 1 && line === ""));
      if (part.added) added += split.length;
      else if (part.removed) removed += split.length;
    }
    return { added, removed };
  }, []);

  const buildCurrentSnapshot = useCallback(async () => {
    const fileNodes = nodes.filter((n) => n.type === "file" && !String(n.id).startsWith("temp-"));
    const ids = fileNodes.map((n) => n.id);
    if (ids.length === 0) return {} as Record<string, { nodeId?: string; content: string }>;

    const { data, error } = await supabase
      .from("file_contents")
      .select("node_id, text")
      .in("node_id", ids);
    if (error) throw new Error(error.message);

    const contentById = new Map<string, string>();
    for (const row of data || []) {
      contentById.set(String(row.node_id), String((row as any).text || ""));
    }

    const snap: Record<string, { nodeId?: string; content: string }> = {};
    for (const n of fileNodes) {
      const path = pathByNodeId.get(n.id) || n.name;
      snap[path] = { nodeId: n.id, content: contentById.get(n.id) ?? "" };
    }
    return snap;
  }, [nodes, pathByNodeId, supabase]);

  const refreshSourceControl = useCallback(async () => {
    let includeUntrackedFiles = true;
    try {
      const raw = localStorage.getItem("cursor_agent_review_settings");
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && parsed.includeUntrackedFiles === false) {
        includeUntrackedFiles = false;
      }
    } catch {
      // ignore
    }

    const baseline = scBaseline ?? loadScBaseline();
    if (!baseline) {
      const current = await buildCurrentSnapshot();
      setScBaseline(current);
      saveScBaseline(current);
      setScChanges([]);
      setScChangeDetails({});
      return;
    }

    setScBaseline(baseline);
    const current = await buildCurrentSnapshot();

    const allPaths = new Set<string>([...Object.keys(baseline), ...Object.keys(current)]);
    const nextChanges: SourceControlChange[] = [];
    const nextDetails: Record<string, { nodeId?: string; filePath: string; oldContent: string; newContent: string }> = {};

    for (const filePath of Array.from(allPaths)) {
      const base = baseline[filePath];
      const cur = current[filePath];
      const oldContent = base?.content ?? "";
      const newContent = cur?.content ?? "";

      if (!base && cur) {
        if (!includeUntrackedFiles) continue;
        const { added, removed } = countAddedRemoved("", newContent);
        nextChanges.push({
          id: filePath,
          filePath,
          fileName: filePath.split("/").pop() || filePath,
          status: "added",
          added,
          removed,
        });
        nextDetails[filePath] = { nodeId: cur.nodeId, filePath, oldContent: "", newContent };
        continue;
      }

      if (base && !cur) {
        const { added, removed } = countAddedRemoved(oldContent, "");
        nextChanges.push({
          id: filePath,
          filePath,
          fileName: filePath.split("/").pop() || filePath,
          status: "deleted",
          added,
          removed,
        });
        nextDetails[filePath] = { nodeId: base.nodeId, filePath, oldContent, newContent: "" };
        continue;
      }

      if (base && cur && oldContent !== newContent) {
        const { added, removed } = countAddedRemoved(oldContent, newContent);
        nextChanges.push({
          id: filePath,
          filePath,
          fileName: filePath.split("/").pop() || filePath,
          status: "modified",
          added,
          removed,
        });
        nextDetails[filePath] = { nodeId: cur.nodeId, filePath, oldContent, newContent };
      }
    }

    nextChanges.sort((a, b) => a.filePath.localeCompare(b.filePath));
    setScChanges(nextChanges);
    setScChangeDetails(nextDetails);
  }, [buildCurrentSnapshot, countAddedRemoved, loadScBaseline, saveScBaseline, scBaseline]);

  useEffect(() => {
    if (activeActivity !== "git") return;
    void refreshSourceControl();
  }, [activeActivity, refreshSourceControl]);

  // ファイル操作アクション（Optimistic UI）
  const handleCreateFile = async (path: string, explicitParentId?: string | null) => {
    // パスから名前とparent_idを計算
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const tempId = `temp-${Date.now()}`;
    const prevActiveId = activeNodeId;
    const prevSelectedIds = new Set(selectedNodeIds);

    // 明示的なparentIdが渡された場合はそれを使用、そうでなければパスから推測
    let parentId: string | null = explicitParentId !== undefined ? explicitParentId : null;
    if (explicitParentId === undefined && parts.length > 1) {
      const parentName = parts[parts.length - 2];
      const parentNode = nodes.find(n => n.name === parentName && n.type === "folder");
      parentId = parentNode?.id || null;
    }

    // Optimistic: 即座にUIに追加
    const tempNode: Node = {
      id: tempId,
      project_id: projectId,
      parent_id: parentId,
      type: "file",
      name,
      is_public: false,
      created_at: new Date().toISOString(),
    };
    editableTempNodeIdsRef.current.add(tempId);
    setNodes(prev => [...prev, tempNode]);
    setSelectedNodeIds(new Set([tempId]));
    setOpenTabs((prev) => (prev.includes(tempId) ? prev : [...prev, tempId]));
    setActiveNodeId(tempId);
    setRevealNodeId(tempId);
    if (activeActivity !== "explorer") {
      setActiveActivity("explorer");
    }
    tempIdPathMapRef.current.set(tempId, path);
    pushUndoAction({ type: "create", nodeId: tempId, node: tempNode });

    // バックグラウンドでAPI処理を実行（UIブロックしない）
    (async () => {
      try {
        let parentIdForRequest: string | null = parentId;
        if (parentId && parentId.startsWith("temp-")) {
          const resolvedParentId = await resolveMaybeTempNodeId(parentId, 10000);
          parentIdForRequest = resolvedParentId ?? null;
        }
        const requestBody = {
          action: "create_file",
          path,
          projectId,
          ...(parentIdForRequest ? { parentId: parentIdForRequest } : {}),
        };
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const raw = await res.text();
        let json: any = {};
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error("Failed to parse server response.");
        }
        if (!res.ok) throw new Error(json?.error || "Failed to create file");
        if (json?.nodeId) {
          registerTempIdMapping(tempId, json.nodeId);
          pendingNodeIdsRef.current.add(json.nodeId);
          setNodes(prev => {
            const hasReal = prev.some(n => n.id === json.nodeId);
            if (hasReal) {
              return prev.filter(n => n.id !== tempId);
            }
            return prev.map(n => n.id === tempId ? { ...n, id: json.nodeId } : n);
          });
          setOpenTabs(prev => prev.map(id => id === tempId ? json.nodeId : id));
          setActiveNodeId(json.nodeId);
          setSelectedNodeIds(new Set([json.nodeId]));
          // Update undo action for create
          updateUndoCreateNodeId(tempId, json.nodeId);
          tempIdPathMapRef.current.delete(tempId);
        }
        // 成功したら正式なデータで更新
        fetchNodes();
      } catch (error: any) {
        console.error("Failed to create file:", error);
        let recovered = false;
        try {
          const refreshedNodes = await fetchNodes();
          const recoveredNode = refreshedNodes.find(
            (node: Node) => node.type === "file" && node.name === name && node.parent_id === parentId
          );
          if (recoveredNode) {
            recovered = true;
            registerTempIdMapping(tempId, recoveredNode.id);
            setOpenTabs(prev => prev.map(id => id === tempId ? recoveredNode.id : id));
            if (activeNodeId === tempId) {
              setActiveNodeId(recoveredNode.id);
            }
            setSelectedNodeIds(new Set([recoveredNode.id]));
            updateUndoCreateNodeId(tempId, recoveredNode.id);
            tempIdPathMapRef.current.delete(tempId);
          }
        } catch (refreshError) {
          console.error("Failed to refresh nodes after create error:", refreshError);
        }
      if (!recovered) {
        // 失敗したらロールバック
          removeUndoCreateAction(tempId);
          tempIdPathMapRef.current.delete(tempId);
        setNodes(prev => prev.filter(n => n.id !== tempId));
        setOpenTabs(prev => prev.filter(id => id !== tempId));
        setActiveNodeId(prevActiveId ?? null);
        setSelectedNodeIds(new Set(prevSelectedIds));
        editableTempNodeIdsRef.current.delete(tempId);
        setTempFileContents((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, tempId)) return prev;
          const next = { ...prev };
          delete next[tempId];
          tempFileContentsRef.current = next;
          return next;
        });
        alert(`Error: ${error.message}`);
      }
      }
    })();
  };

  const handleCreateFolder = async (path: string, explicitParentId?: string | null) => {
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const tempId = `temp-${Date.now()}`;
    const prevSelectedIds = new Set(selectedNodeIds);

    // 明示的なparentIdが渡された場合はそれを使用
    let parentId: string | null = explicitParentId !== undefined ? explicitParentId : null;
    if (explicitParentId === undefined && parts.length > 1) {
      const parentName = parts[parts.length - 2];
      const parentNode = nodes.find(n => n.name === parentName && n.type === "folder");
      parentId = parentNode?.id || null;
    }

    const tempNode: Node = {
      id: tempId,
      project_id: projectId,
      parent_id: parentId,
      type: "folder",
      name,
      is_public: false,
      created_at: new Date().toISOString(),
    };
    setNodes(prev => [...prev, tempNode]);
    setSelectedNodeIds(new Set([tempId]));
    setRevealNodeId(tempId);
    tempIdPathMapRef.current.set(tempId, path);
    pushUndoAction({ type: "create", nodeId: tempId, node: tempNode });
    // フォルダーをタブとして開いてアクティブにする
    setOpenTabs(prev => prev.includes(tempId) ? prev : [...prev, tempId]);
    setActiveNodeId(tempId);

    // バックグラウンドでAPI処理を実行（UIブロックしない）
    (async () => {
      try {
        let parentIdForRequest: string | null = parentId;
        if (parentId && parentId.startsWith("temp-")) {
          const resolvedParentId = await resolveMaybeTempNodeId(parentId, 10000);
          parentIdForRequest = resolvedParentId ?? null;
        }
        const requestBody = {
          action: "create_folder",
          path,
          projectId,
          ...(parentIdForRequest ? { parentId: parentIdForRequest } : {}),
        };
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const raw = await res.text();
        let json: any = {};
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error("Failed to parse server response.");
        }
        if (!res.ok) throw new Error(json?.error || "Failed to create folder");
        if (json?.nodeId) {
          registerTempIdMapping(tempId, json.nodeId);
          pendingNodeIdsRef.current.add(json.nodeId);
          setNodes(prev => {
            const hasReal = prev.some(n => n.id === json.nodeId);
            if (hasReal) {
              return prev.filter(n => n.id !== tempId);
            }
            return prev.map(n => n.id === tempId ? { ...n, id: json.nodeId } : n);
          });
          setSelectedNodeIds(new Set([json.nodeId]));
          // Update open tabs and active node from temp to real ID
          setOpenTabs(prev => prev.map(id => id === tempId ? json.nodeId : id));
          setActiveNodeId(prev => prev === tempId ? json.nodeId : prev);
          // Update undo action for create
          updateUndoCreateNodeId(tempId, json.nodeId);
          tempIdPathMapRef.current.delete(tempId);
        }
        fetchNodes();
      } catch (error: any) {
        console.error("Failed to create folder:", error);
        let recovered = false;
        try {
          const refreshedNodes = await fetchNodes();
          const recoveredNode = refreshedNodes.find(
            (node: Node) => node.type === "folder" && node.name === name && node.parent_id === parentId
          );
          if (recoveredNode) {
            recovered = true;
            registerTempIdMapping(tempId, recoveredNode.id);
            setSelectedNodeIds(new Set([recoveredNode.id]));
            setOpenTabs(prev => prev.map(id => id === tempId ? recoveredNode.id : id));
            setActiveNodeId(prev => prev === tempId ? recoveredNode.id : prev);
            updateUndoCreateNodeId(tempId, recoveredNode.id);
            tempIdPathMapRef.current.delete(tempId);
          }
        } catch (refreshError) {
          console.error("Failed to refresh nodes after create error:", refreshError);
        }
        if (!recovered) {
          removeUndoCreateAction(tempId);
          tempIdPathMapRef.current.delete(tempId);
          setNodes(prev => prev.filter(n => n.id !== tempId));
          setOpenTabs(prev => prev.filter(id => id !== tempId));
          setActiveNodeId(prev => prev === tempId ? null : prev);
          setSelectedNodeIds(new Set(prevSelectedIds));
          alert(`Error: ${error.message}`);
        }
      }
    })();
  };

  const handleRenameNode = async (id: string, newName: string) => {
    // Optimistic: 即座にUIを更新
    const oldNode = nodes.find(n => n.id === id);
    if (!oldNode) return;

    const oldName = oldNode.name;
    setNodes(prev => prev.map(n => n.id === id ? { ...n, name: newName } : n));

    try {
      // temp IDの場合は実IDに解決してからAPI呼び出し
      const resolvedId = id.startsWith("temp-") ? await resolveMaybeTempNodeId(id, 30000) : id;
      if (!resolvedId) throw new Error("ノードがまだ作成中です。しばらくお待ちください。");
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename_node", id: resolvedId, newName }),
      });
      if (!res.ok) throw new Error("Failed to rename");
      // Push undo action for rename
      pushUndoAction({ type: "rename", nodeId: resolvedId, oldName, newName });
    } catch (error: any) {
      // 失敗したらロールバック
      setNodes(prev => prev.map(n => n.id === id ? oldNode : n));
      alert(`Error: ${error.message}`);
    }
  };

  const handleMoveNodes = async (nodeIds: string[], newParentId: string | null) => {
    // Optimistic: 即座にUIを更新
    const oldNodes = nodes.filter(n => nodeIds.includes(n.id));
    if (oldNodes.length === 0) return;

    // Filter out nodes that are already in the target folder
    const nodesToMove = oldNodes.filter(n => n.parent_id !== newParentId);
    if (nodesToMove.length === 0) return;

    const idsToMove = nodesToMove.map(n => n.id);
    const oldParentIds = nodesToMove.map(n => n.parent_id);
    setNodes(prev => prev.map(n => idsToMove.includes(n.id) ? { ...n, parent_id: newParentId } : n));

    // 移動されたフォルダーが1つの場合、タブとして開く
    if (nodesToMove.length === 1 && nodesToMove[0].type === "folder") {
      const folderId = nodesToMove[0].id;
      setOpenTabs(prev => prev.includes(folderId) ? prev : [...prev, folderId]);
      setActiveNodeId(folderId);
    }

    try {
      // Move all nodes in parallel
      await Promise.all(idsToMove.map(async (id) => {
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "move_node", id, newParentId }),
        });
        if (!res.ok) throw new Error(`Failed to move node ${id}`);
      }));
      // Push undo action for move
      pushUndoAction({ type: "move", nodeIds: idsToMove, oldParentIds, newParentId });
    } catch (error: any) {
      // 失敗したらロールバック
      const oldNodeMap = new Map(oldNodes.map(n => [n.id, n]));
      setNodes(prev => prev.map(n => oldNodeMap.has(n.id) ? oldNodeMap.get(n.id)! : n));
      alert(`Error: ${error.message}`);
    }
  };

  const handleCopyNodes = async (nodeIds: string[], newParentId: string | null): Promise<string[]> => {
    if (nodeIds.length === 0) {
      return []; // Nothing to copy
    }

    const resolvedNodeIdsPromise = Promise.all(nodeIds.map((id) => resolveMaybeTempNodeId(id)));
    const resolvedParentIdPromise = resolveMaybeTempNodeId(newParentId);

    // Helper to generate copy name
    const generateCopyName = (originalName: string, existingNames: string[], isFile: boolean) => {
      let baseName: string;
      let extension: string;

      if (isFile) {
        const lastDotIndex = originalName.lastIndexOf(".");
        if (lastDotIndex > 0) {
          baseName = originalName.substring(0, lastDotIndex);
          extension = originalName.substring(lastDotIndex);
        } else {
          baseName = originalName;
          extension = "";
        }
      } else {
        baseName = originalName;
        extension = "";
      }

      const copyPattern = / copy( \d+)?$/;
      const baseWithoutCopy = baseName.replace(copyPattern, "");

      // Find existing copy numbers
      const copyNames = existingNames.filter((name: string) => {
        const expectedBase = `${baseWithoutCopy} copy`;
        if (extension) {
          const escapedBase = baseWithoutCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const escapedExt = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return name === `${expectedBase}${extension}` ||
                 name.match(new RegExp(`^${escapedBase} copy \\d+${escapedExt}$`));
        } else {
          const escapedBase = baseWithoutCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return name === expectedBase ||
                 name.match(new RegExp(`^${escapedBase} copy \\d+$`));
        }
      });

      let counter = 1;
      if (copyNames.length > 0) {
        const numbers = copyNames.map((name: string) => {
          const nameWithoutExt = extension ? name.replace(extension, "") : name;
          const match = nameWithoutExt.match(/ copy( (\d+))?$/);
          if (match) {
            return match[2] ? parseInt(match[2], 10) : 1;
          }
          return 0;
        });
        counter = Math.max(...numbers, 0) + 1;
      }

      if (counter === 1) {
        return `${baseWithoutCopy} copy${extension}`;
      } else {
        return `${baseWithoutCopy} copy ${counter}${extension}`;
      }
    };

    // Optimistic update: add temporary nodes immediately (including children for folders)
    const tempNodes: Node[] = [];
    const rootTempIds: string[] = [];
    const existingNames = nodes
      .filter(n => n.parent_id === newParentId)
      .map(n => n.name);

    // Recursive function to copy node tree locally
    const visited = new Set<string>();
    const copyNodeTreeLocally = (sourceId: string, targetParentId: string | null, isRoot: boolean) => {
      if (visited.has(sourceId)) return;
      visited.add(sourceId);
      const sourceNode = nodes.find(n => n.id === sourceId);
      if (!sourceNode) return;

      // 貼り付け先に同名のノードが存在する場合は copy 名を生成
      const siblingNames = [
        ...existingNames,
        ...tempNodes.filter(t => t.parent_id === targetParentId).map(t => t.name),
      ];
      const hasDuplicate = siblingNames.includes(sourceNode.name);
      const newName = (isRoot && hasDuplicate)
        ? generateCopyName(sourceNode.name, siblingNames, sourceNode.type === "file")
        : sourceNode.name;

      const tempId = `temp-copy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${sourceId}`;
      const tempNode: Node = {
        id: tempId,
        project_id: projectId,
        parent_id: targetParentId,
        type: sourceNode.type,
        name: newName,
        is_public: false,
        created_at: new Date().toISOString(),
      };
      tempNodes.push(tempNode);

      // tempIdとパスのマッピングを保存（fetchNodes後も解決に使用）
      let parentPath = "";
      if (targetParentId) {
        // 親がtempノードの場合はtempIdPathMapRefから、通常ノードの場合はpathByNodeIdから取得
        parentPath = tempIdPathMapRef.current.get(targetParentId) ?? pathByNodeId.get(targetParentId) ?? "";
      }
      const tempNodePath = parentPath ? `${parentPath}/${newName}` : newName;
      tempIdPathMapRef.current.set(tempId, tempNodePath);

      if (isRoot) {
        rootTempIds.push(tempId);
      }

      // Recursively copy children if it's a folder
      if (sourceNode.type === "folder") {
        const children = nodes.filter(n => n.parent_id === sourceId);
        for (const child of children) {
          copyNodeTreeLocally(child.id, tempId, false);
        }
      }
    };

    for (const nodeId of nodeIds) {
      copyNodeTreeLocally(nodeId, newParentId, true);
    }

    const tempNodeIds = new Set(tempNodes.map((node) => node.id));

    // Immediately update UI with temp nodes and select root nodes
    setNodes(prev => [...prev, ...tempNodes]);
    setSelectedNodeIds(new Set(rootTempIds));
    // 即座に中央表示
    if (rootTempIds.length > 0) {
      setRevealNodeId(rootTempIds[0]);
    }
    // コピーされたルートノードがフォルダーの場合、タブとして開く
    if (rootTempIds.length === 1) {
      const rootTemp = tempNodes.find(n => n.id === rootTempIds[0]);
      if (rootTemp?.type === "folder") {
        setOpenTabs(prev => prev.includes(rootTempIds[0]) ? prev : [...prev, rootTempIds[0]]);
        setActiveNodeId(rootTempIds[0]);
      }
    }
    // Push undo action for copy immediately (use temp IDs for instant undo)
    if (rootTempIds.length > 0) {
      const copiedNames = rootTempIds.map(tempId => {
        const tempNode = tempNodes.find(n => n.id === tempId);
        return tempNode?.name || "";
      }).filter(Boolean);
      pushUndoAction({ type: "copy", nodeIds: rootTempIds, names: copiedNames });
    }

    try {
      const resolvedNodeIds = await resolvedNodeIdsPromise;
      const resolvedParentId = await resolvedParentIdPromise;

      if (resolvedNodeIds.some((id) => !id)) {
        throw new Error("コピーが完了してからもう一度お試しください。");
      }

      if (newParentId && !resolvedParentId) {
        throw new Error("コピー先のフォルダがまだ作成中です。");
      }

      const realNodeIds = resolvedNodeIds as string[];
      const serverParentId = resolvedParentId ?? null;

      // Copy each node sequentially (to avoid overwhelming the server for large folders)
      const newNodeIds: string[] = [];
      for (const nodeId of realNodeIds) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

        try {
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "copy_node", id: nodeId, newParentId: serverParentId }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || `Failed to copy node`);
          }
          const json = await res.json();
          if (json.nodeId) {
            newNodeIds.push(json.nodeId);
          }
        } catch (err: any) {
          clearTimeout(timeoutId);
          if (err.name === 'AbortError') {
            throw new Error('コピーがタイムアウトしました。もう一度お試しください。');
          }
          throw err;
        }
      }

      if (newNodeIds.length > 0) {
        for (let index = 0; index < newNodeIds.length; index += 1) {
          const tempId = rootTempIds[index];
          if (tempId) {
            registerTempIdMapping(tempId, newNodeIds[index]);
          }
        }
      }

      // Update undo action with real IDs once copy completes
      if (newNodeIds.length > 0 && rootTempIds.length > 0) {
        updateUndoCopyNodeIds(rootTempIds, newNodeIds);
      }

      const ensureCopiedNodesVisible = async () => {
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const refreshedNodes = await fetchNodes(attempt === 0);
          const refreshedIds = new Set(refreshedNodes.map((node) => node.id));
          if (newNodeIds.every((id) => refreshedIds.has(id))) {
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
        }
        throw new Error("コピー結果を取得できませんでした。もう一度お試しください。");
      };

      // Refresh to get the actual nodes (replaces temp nodes) and select the new nodes
      await ensureCopiedNodesVisible();
      if (tempNodeIds.size > 0) {
        setNodes(prev => prev.filter((node) => !tempNodeIds.has(node.id)));
        for (const tempId of tempNodeIds) {
          tempIdPathMapRef.current.delete(tempId);
        }
      }
      setSelectedNodeIds(new Set(newNodeIds));
      if (newNodeIds.length > 0) {
        setRevealNodeId(newNodeIds[0]);
      }
      return newNodeIds;
    } catch (error: any) {
      // Revert optimistic update on error
      setNodes(prev => prev.filter(n => !tempNodes.some(t => t.id === n.id)));
      for (const tempNode of tempNodes) {
        tempIdPathMapRef.current.delete(tempNode.id);
      }
      setSelectedNodeIds(new Set());
      alert(`コピーエラー: ${error.message}`);
      return [];
    }
  };

  // Prompt user for delete confirmation
  const promptDeleteConfirmation = useCallback((names: string[], itemType: "file" | "folder" | "mixed"): Promise<boolean> => {
    return new Promise((resolve) => {
      deleteDialogResolveRef.current = resolve;
      setDeleteDialog({
        isOpen: true,
        names,
        itemType,
      });
    });
  }, []);

  // Handle delete dialog response
  const handleDeleteDialogResponse = useCallback((confirmed: boolean) => {
    const resolve = deleteDialogResolveRef.current;
    deleteDialogResolveRef.current = null;

    // Close dialog immediately
    setDeleteDialog({
      isOpen: false,
      names: [],
      itemType: "file",
    });

    // Resolve after dialog closes
    if (resolve) {
      resolve(confirmed);
    }
  }, []);

  const handleDeleteNodes = async (ids: string[]) => {
    if (ids.length === 0) return;

    // 削除するノード情報を保存
    const nodesToDelete = ids.map(id => nodes.find(n => n.id === id)).filter(Boolean) as Node[];
    if (nodesToDelete.length === 0) return;

    // Determine names and type for dialog
    const names = nodesToDelete.map(n => n.name);
    const hasFiles = nodesToDelete.some(n => n.type === "file");
    const hasFolders = nodesToDelete.some(n => n.type === "folder");
    let itemType: "file" | "folder" | "mixed";
    if (hasFiles && hasFolders) {
      itemType = "mixed";
    } else if (hasFolders) {
      itemType = "folder";
    } else {
      itemType = "file";
    }

    // Show confirmation dialog
    const confirmed = await promptDeleteConfirmation(names, itemType);
    if (!confirmed) return;

    // 子ノードも含めて削除対象を収集
    const allIdsToDelete = new Set<string>();
    const collectChildren = (parentId: string) => {
      allIdsToDelete.add(parentId);
      nodes.filter(n => n.parent_id === parentId).forEach(child => collectChildren(child.id));
    };
    ids.forEach(id => collectChildren(id));

    // ロールバック用に現在のノードを保存
    const oldNodes = [...nodes];

    // 即座にUIから削除（楽観的更新）
    setNodes(prev => prev.filter(n => !allIdsToDelete.has(n.id)));
    setOpenTabs(prev => prev.filter(tabId => !allIdsToDelete.has(tabId)));
    if (activeNodeId && allIdsToDelete.has(activeNodeId)) {
      setActiveNodeId(null);
    }
    setSelectedNodeIds(prev => {
      const next = new Set(prev);
      allIdsToDelete.forEach((nodeId) => next.delete(nodeId));
      return next;
    });

    // バックグラウンドでAPI削除を並列実行
    (async () => {
      try {
        // 並列削除
        await Promise.all(ids.map(id =>
          fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete_node", id }),
          })
        ));

        // undo用のコンテンツ取得（単一ノード削除の場合のみ）
        if (nodesToDelete.length === 1) {
          const nodeToDelete = nodesToDelete[0];
          let content: string | undefined;
          const allChildren: { node: Node; content?: string }[] = [];

          if (nodeToDelete.type === "file") {
            try {
              const { data } = await supabase
                .from("file_contents")
                .select("text")
                .eq("node_id", nodeToDelete.id)
                .single();
              content = data?.text;
            } catch {
              // ignore
            }
          }

          // 子ノードのコンテンツも取得
          for (const nodeId of allIdsToDelete) {
            if (nodeId === nodeToDelete.id) continue;
            const childNode = oldNodes.find(n => n.id === nodeId);
            if (childNode) {
              let childContent: string | undefined;
              if (childNode.type === "file") {
                try {
                  const { data } = await supabase
                    .from("file_contents")
                    .select("text")
                    .eq("node_id", nodeId)
                    .single();
                  childContent = data?.text;
                } catch {
                  // ignore
                }
              }
              allChildren.push({ node: childNode, content: childContent });
            }
          }

          pushUndoAction({
            type: "delete",
            nodeId: nodeToDelete.id,
            node: nodeToDelete,
            content,
            children: allChildren.length > 0 ? allChildren : undefined,
          });
        }
      } catch (error: any) {
        // 失敗したらロールバック
        setNodes(oldNodes);
        console.error("Delete failed:", error);
      }
    })();
  };

  const handleOpenNode = useCallback((nodeId: string, options?: { preview?: boolean }) => {
    // フォルダかどうかはFileTree側で判断して展開/ファイルオープンを呼び分けてもらう形にするが、
    // ここではファイルを開く処理のみ
    const isTempNode = nodeId.startsWith("temp-");
    const node = nodeById.get(nodeId);
    if (!isTempNode && node && isMediaFile(node.name)) {
      prefetchMediaUrl(nodeId);
    }
    const isPreview = options?.preview ?? false;
    const alreadyOpen = openTabsRef.current.includes(nodeId);
    const currentPreview = previewTabIdRef.current;
    const currentPreviewIsDirty = currentPreview ? dirtyTabIds.has(currentPreview) : false;

    setOpenTabs((prev) => {
      if (prev.includes(nodeId)) return prev;
      if (isPreview) {
        if (currentPreview && !currentPreviewIsDirty) {
          return prev.map((id) => (id === currentPreview ? nodeId : id));
        }
      }
      return [...prev, nodeId];
    });
    setActiveNodeId(nodeId);
    setSelectedNodeIds(new Set([nodeId]));
    if (activeActivity !== "explorer") {
      setActiveActivity("explorer");
    }
    if (isPreview) {
      if (!alreadyOpen || currentPreview === nodeId) {
        if (currentPreview && currentPreviewIsDirty) {
          setPreviewTabId(null);
        }
        setPreviewTabId(nodeId);
      }
    } else if (currentPreview === nodeId) {
      setPreviewTabId(null);
    }
  }, [activeActivity, dirtyTabIds, nodeById]);

  const handleHoverNode = useCallback((nodeId: string) => {
    if (nodeId.startsWith("temp-")) return;
    const node = nodeById.get(nodeId);
    if (node && isMediaFile(node.name)) {
      prefetchMediaUrl(nodeId);
    }
  }, [nodeById]);

  useEffect(() => {
    if (!nodes.length) return;
    const mediaNodes = nodes.filter((node) =>
      node.type === "file" &&
      !node.id.startsWith("temp-") &&
      isMediaFile(node.name)
    );
    if (mediaNodes.length === 0) return;

    const pending = mediaNodes.filter((node) => !prefetchedMediaIdsRef.current.has(node.id));
    if (pending.length === 0) return;

    let cancelled = false;
    const queue = pending.slice(0, 256);
    const concurrency = 4;

    const worker = async () => {
      while (!cancelled) {
        const next = queue.shift();
        if (!next) return;
        prefetchedMediaIdsRef.current.add(next.id);
        await prefetchMediaUrl(next.id);
      }
    };

    const timer = window.setTimeout(() => {
      for (let i = 0; i < concurrency; i += 1) {
        void worker();
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [nodes]);

  const handleToggleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleSelectFolder = useCallback((nodeId: string) => {
    setSelectedNodeIds(new Set([nodeId]));
    // フォルダーもタブとして開いて表示する
    setOpenTabs((prev) => {
      if (prev.includes(nodeId)) return prev;
      return [...prev, nodeId];
    });
    setActiveNodeId(nodeId);
  }, []);

  // Create file from FolderPageView slash command
  const handleCreateFileInFolder = useCallback((parentId: string | null) => {
    const siblings = nodes.filter((n) => n.parent_id === parentId);
    const siblingNames = new Set(siblings.map((n) => n.name));
    let name = "Untitled";
    let counter = 1;
    while (siblingNames.has(name)) {
      name = `Untitled ${counter}`;
      counter++;
    }
    handleCreateFile(name, parentId);
  }, [nodes, handleCreateFile]);

  // Create folder from FolderPageView slash command
  const handleCreateFolderInFolder = useCallback((parentId: string | null) => {
    const siblings = nodes.filter((n) => n.parent_id === parentId);
    const siblingNames = new Set(siblings.map((n) => n.name));
    let name = "Untitled";
    let counter = 1;
    while (siblingNames.has(name)) {
      name = `Untitled ${counter}`;
      counter++;
    }
    handleCreateFolder(name, parentId);
  }, [nodes, handleCreateFolder]);

  // ── Folder/Workspace block content ──
  const folderBlocksCache = useRef<Record<string, unknown[]>>({});
  const [folderBlocks, setFolderBlocks] = useState<Record<string, unknown[]>>({});

  // Load folder blocks when a folder tab becomes active
  useEffect(() => {
    if (!activeNodeId) return;
    const node = nodeById.get(activeNodeId);
    if (!node || node.type !== "folder") return;
    // Already loaded
    if (folderBlocksCache.current[activeNodeId] !== undefined) {
      setFolderBlocks((prev) => {
        if (prev[activeNodeId] === folderBlocksCache.current[activeNodeId]) return prev;
        return { ...prev, [activeNodeId]: folderBlocksCache.current[activeNodeId] };
      });
      return;
    }
    // Fetch from DB
    supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", activeNodeId)
      .maybeSingle()
      .then(({ data }: { data: { text: string | null } | null }) => {
        let blocks: unknown[] = [];
        if (data?.text) {
          try {
            const parsed = JSON.parse(data.text);
            if (Array.isArray(parsed)) blocks = parsed;
          } catch { /* ignore */ }
        }
        folderBlocksCache.current[activeNodeId] = blocks;
        setFolderBlocks((prev) => ({ ...prev, [activeNodeId]: blocks }));
      });
  }, [activeNodeId, nodeById, supabase]);

  // Load workspace blocks
  useEffect(() => {
    if (!activeWorkspace) return;
    const wsKey = `workspace:${activeWorkspace.id}`;
    if (folderBlocksCache.current[wsKey] !== undefined) return;
    supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", activeWorkspace.id)
      .maybeSingle()
      .then(({ data }: { data: { text: string | null } | null }) => {
        let blocks: unknown[] = [];
        if (data?.text) {
          try {
            const parsed = JSON.parse(data.text);
            if (Array.isArray(parsed)) blocks = parsed;
          } catch { /* ignore */ }
        }
        folderBlocksCache.current[wsKey] = blocks;
        setFolderBlocks((prev) => ({ ...prev, [wsKey]: blocks }));
      });
  }, [activeWorkspace, supabase]);

  // Save folder blocks
  const handleSaveFolderBlocks = useCallback((nodeId: string, blocks: unknown[]) => {
    folderBlocksCache.current[nodeId] = blocks;
    setFolderBlocks((prev) => ({ ...prev, [nodeId]: blocks }));
    const text = JSON.stringify(blocks);
    supabase
      .from("file_contents")
      .upsert({ node_id: nodeId, text }, { onConflict: "node_id" })
      .then(({ error }: { error: Error | null }) => {
        if (error) console.error("Failed to save folder blocks:", error);
      });
  }, [supabase]);

  const handleClearSelection = useCallback(() => {
    setSelectedNodeIds(new Set());
  }, []);

  // Upload files handler
  const handleUploadFiles = useCallback((parentId: string | null) => {
    setUploadTargetParentId(parentId);
    fileInputRef.current?.click();
  }, []);

  // Upload media for inline block embedding
  const handleUploadMedia = useCallback(
    async (accept: string, parentId: string | null): Promise<{ nodeId: string; fileName: string } | null> => {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.style.display = "none";
        document.body.appendChild(input);

        let resolved = false;
        const cleanup = () => {
          if (input.parentNode) document.body.removeChild(input);
        };

        input.onchange = async () => {
          const file = input.files?.[0];
          cleanup();

          if (!file) {
            resolved = true;
            resolve(null);
            return;
          }

          try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("projectId", projectId);
            formData.append("parentId", parentId ?? "");
            formData.append("fileName", file.name);

            const resp = await fetch("/api/storage/upload", {
              method: "POST",
              body: formData,
            });

            if (!resp.ok) {
              resolved = true;
              resolve(null);
              return;
            }

            const data = await resp.json();
            // Refresh nodes so the uploaded file appears in the tree
            void fetchNodes(false);
            resolved = true;
            resolve({ nodeId: data.nodeId, fileName: file.name });
          } catch {
            resolved = true;
            resolve(null);
          }
        };

        // Handle cancel
        input.addEventListener("cancel", () => {
          cleanup();
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        });

        input.click();
      });
    },
    [projectId, fetchNodes]
  );

  // Get signed URL for media block display
  const handleGetMediaUrl = useCallback(
    async (nodeId: string): Promise<string | null> => {
      try {
        const resp = await fetch("/api/storage/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId }),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.url ?? null;
      } catch {
        return null;
      }
    },
    []
  );

  // Upload folder handler
  const handleUploadFolder = useCallback((parentId: string | null) => {
    setUploadTargetParentId(parentId);
    folderInputRef.current?.click();
  }, []);

  // Check if file is binary (image, video, audio, documents, etc.)
  const isBinaryFile = (fileName: string): boolean => {
    const binaryExtensions = [
      "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
      "mp4", "webm", "mov", "avi", "mkv", "m4v",
      "mp3", "wav", "ogg", "m4a", "flac", "aac",
      "pdf", "zip", "rar", "7z", "tar", "gz",
      "ttf", "otf", "woff", "woff2", "eot",
      "xlsx", "xls", "docx", "doc", "pptx", "ppt"
    ];
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return binaryExtensions.includes(ext);
  };

  const shouldIgnoreUploadPath = (relativePath: string, isDirectory: boolean): boolean => {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized) return false;
    const parts = normalized.split("/");
    if (parts.some((part) => part === "__MACOSX")) return true;
    const name = parts[parts.length - 1];
    if (name === ".DS_Store") return true;
    if (!isDirectory && name.startsWith("._")) return true;
    return false;
  };

  // Read file as base64 for binary files, text for others
  const readFileContent = async (file: File): Promise<string> => {
    if (isBinaryFile(file.name)) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result); // Data URL format: data:mime/type;base64,...
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } else {
      return file.text();
    }
  };

  const hasUnsupportedJsonUnicode = (text: string): boolean => {
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code === 0x0000) return true;
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          i += 1;
          continue;
        }
        return true;
      }
      if (code >= 0xDC00 && code <= 0xDFFF) return true;
    }
    return false;
  };

  const uploadFileToSignedUrl = useCallback((uploadUrl: string, file: File | Blob, onProgress: (percent: number | null) => void) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          onProgress(null);
          return;
        }
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(percent);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve();
        } else {
          reject(new Error(`Failed to upload file to storage (status ${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Failed to upload file to storage"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.send(file);
    });
  }, []);

  // Check if a file/folder with the same name exists in the target folder
  const findExistingNode = useCallback((name: string, parentId: string | null): Node | undefined => {
    return nodes.find(n => n.name === name && n.parent_id === parentId);
  }, [nodes]);

  // Prompt user for replace confirmation
  const promptReplaceConfirmation = useCallback((fileName: string, isFolder: boolean, existingNodeId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setReplaceDialog({
        isOpen: true,
        fileName,
        isFolder,
        existingNodeId,
        resolve,
      });
    });
  }, []);

  const promptReplaceConfirmations = useCallback((items: { key: string; label: string; isFolder: boolean; existingNodeId: string }[]): Promise<Map<string, boolean>> => {
    return new Promise((resolve) => {
      if (items.length === 0) {
        resolve(new Map());
        return;
      }
      replaceQueueRef.current = {
        items,
        index: 0,
        results: [],
        resolve,
      };
      const current = items[0];
      flushSync(() => {
        setReplaceDialog({
          isOpen: true,
          fileName: current.label,
          isFolder: current.isFolder,
          existingNodeId: current.existingNodeId,
          resolve: null,
        });
      });
    });
  }, []);

  // Handle replace dialog response
  const handleReplaceDialogResponse = useCallback(async (replace: boolean) => {
    const queue = replaceQueueRef.current;
    if (queue) {
      queue.results[queue.index] = replace;
      const nextIndex = queue.index + 1;
      if (nextIndex < queue.items.length) {
        queue.index = nextIndex;
        const next = queue.items[nextIndex];
        // Close then immediately show the next dialog
        flushSync(() => {
          setReplaceDialog({
            isOpen: false,
            fileName: "",
            isFolder: false,
            existingNodeId: "",
            resolve: null,
          });
        });
        requestAnimationFrame(() => {
          setReplaceDialog({
            isOpen: true,
            fileName: next.label,
            isFolder: next.isFolder,
            existingNodeId: next.existingNodeId,
            resolve: null,
          });
        });
        return;
      }
      // Finish queue
      replaceQueueRef.current = null;
      flushSync(() => {
        setReplaceDialog({
          isOpen: false,
          fileName: "",
          isFolder: false,
          existingNodeId: "",
          resolve: null,
        });
      });
      const map = new Map<string, boolean>();
      queue.items.forEach((item, idx) => map.set(item.key, queue.results[idx]));
      queue.resolve(map);
      return;
    }

    const { resolve, existingNodeId } = replaceDialog;

    // Close dialog immediately
    setReplaceDialog({
      isOpen: false,
      fileName: "",
      isFolder: false,
      existingNodeId: "",
      resolve: null,
    });

    if (replace && existingNodeId) {
      // Helper to get all descendant IDs recursively
      const getDescendantIds = (parentId: string, allNodes: Node[]): string[] => {
        const result: string[] = [];
        const children = allNodes.filter(n => n.parent_id === parentId);
        for (const child of children) {
          result.push(child.id);
          result.push(...getDescendantIds(child.id, allNodes));
        }
        return result;
      };

      // Get all IDs to remove (existing node + all descendants)
      const idsToRemove = new Set([existingNodeId, ...getDescendantIds(existingNodeId, nodes)]);

      // Optimistic: Update local state immediately (including all descendants)
      setNodes(prev => prev.filter(n => !idsToRemove.has(n.id)));
      setOpenTabs(prev => prev.filter(id => !idsToRemove.has(id)));
      if (activeNodeId && idsToRemove.has(activeNodeId)) {
        setActiveNodeId(null);
      }

      // Wait for delete to complete before resolving
      try {
        await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete_node",
            id: existingNodeId,
          }),
        });
      } catch (error) {
        console.error("Error deleting existing file:", error);
      }
    }

    // Resolve after delete is complete
    resolve?.(replace);
  }, [replaceDialog, activeNodeId, nodes]);

  const uploadFiles = useCallback(async (files: File[], parentId: string | null) => {
    const filteredFiles = files.filter((file) => !shouldIgnoreUploadPath(file.name, false));
    if (!filteredFiles.length) return;
    const parentPath = parentId ? pathByNodeId.get(parentId) || "" : "";

    // Threshold for using Storage (2MB for binary, 5MB for text)
    const STORAGE_THRESHOLD_BINARY = 2 * 1024 * 1024;
    const STORAGE_THRESHOLD_TEXT = 5 * 1024 * 1024;

    const filesArray = Array.from(filteredFiles);
    const uploadBatchId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const replaceKeyByFile = new Map<File, string>();
    const replaceCandidates: { file: File; existingNode: Node; key: string }[] = [];
    for (const file of filesArray) {
      const existingNode = findExistingNode(file.name, parentId);
      if (existingNode) {
        const key = `${file.name}:${existingNode.id}:${replaceCandidates.length}`;
        replaceKeyByFile.set(file, key);
        replaceCandidates.push({ file, existingNode, key });
      }
    }
    const replaceItems = replaceCandidates.map(({ file, existingNode, key }) => ({
      key,
      label: file.name,
      isFolder: existingNode.type === "folder",
      existingNodeId: existingNode.id,
    }));
    const replaceDecisions = await promptReplaceConfirmations(replaceItems);
    const firstFile = filesArray[0];
    const lastFile = filesArray[filesArray.length - 1];
    let lastTempId: string | null = null;
    let lastFinalId: string | null = null;
    let lastSuccessId: string | null = null;
    const uploadSelection = new Set<string>();

    const syncSelection = () => {
      setSelectedNodeIds(new Set(uploadSelection));
    };

    const uploadOne = async (file: File) => {
      const fileName = file.name;
      const isBinary = isBinaryFile(fileName);
      const useStorage = isBinary || file.size > (isBinary ? STORAGE_THRESHOLD_BINARY : STORAGE_THRESHOLD_TEXT);
      const shouldFocus = file === lastFile;
      const shouldRevealImmediately = file === firstFile; // 最初のファイルで即座に中央表示
      const fullPath = parentPath ? `${parentPath}/${fileName}` : fileName;

      // Create the file node optimistically FIRST (before any dialog)
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      if (file === lastFile) {
        lastTempId = tempId;
      }
      const tempNode: Node = {
        id: tempId,
        project_id: projectId,
        parent_id: parentId,
        type: "file",
        name: fileName,
        is_public: false,
        created_at: new Date().toISOString(),
      };

      // Check for existing file with same name
      const existingNode = findExistingNode(fileName, parentId);
      if (existingNode) {
        const decisionKey = replaceKeyByFile.get(file) ?? "";
        const shouldReplace = replaceDecisions.get(decisionKey) ?? false;
        if (!shouldReplace) {
          return;
        }
        // Immediately update UI: remove existing, add temp (instant feedback)
        setNodes(prev => [...prev.filter(n => n.id !== existingNode.id), tempNode]);
        uploadSelection.add(tempId);
        syncSelection();
        // Replace existing tab with temp tab
        setOpenTabs(prev => {
          const filtered = prev.filter(id => id !== existingNode.id);
          return filtered.includes(tempId) ? filtered : [...filtered, tempId];
        });
        if (shouldFocus) {
          setActiveNodeId(tempId);
        }
        if (shouldRevealImmediately || shouldFocus) {
          setRevealNodeId(tempId);
          if (activeActivity !== "explorer") {
            setActiveActivity("explorer");
          }
        }

        // Continue with upload (temp node already in place)
      } else {
        // No existing node, just add temp
        setNodes(prev => [...prev, tempNode]);
        uploadSelection.add(tempId);
        syncSelection();
        // Open temp tab to show upload progress
        setOpenTabs(prev => (prev.includes(tempId) ? prev : [...prev, tempId]));
        if (shouldFocus) {
          setActiveNodeId(tempId);
        }
        if (shouldRevealImmediately || shouldFocus) {
          setRevealNodeId(tempId);
          if (activeActivity !== "explorer") {
            setActiveActivity("explorer");
          }
        }
      }

      tempIdPathMapRef.current.set(tempId, fullPath);
      pushUndoAction({ type: "create", nodeId: tempId, source: "upload", node: tempNode, batchId: uploadBatchId });

      let uploadToStorage = useStorage;
      let textContent: string | null = null;
      if (!uploadToStorage) {
        try {
          const contentCandidate = await readFileContent(file);
          if (hasUnsupportedJsonUnicode(contentCandidate)) {
            uploadToStorage = true;
          } else {
            textContent = contentCandidate;
          }
        } catch {
          uploadToStorage = true;
        }
      }

      let createdNodeId: string | null = null;

      try {
        let newId: string;

        if (uploadToStorage) {
          // Use signed URL approach for large/binary files
          // Step 1: Get signed upload URL
          const createUrlRes = await fetch("/api/storage/create-upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              parentId: parentId || null,
              fileName,
              contentType: file.type || "application/octet-stream",
            }),
          });

          const createUrlResult = await createUrlRes.json();
          if (!createUrlRes.ok) {
            throw new Error(createUrlResult.error || "Failed to create upload URL");
          }

          createdNodeId = createUrlResult.nodeId;
          if (!createUrlResult.uploadUrl || !createUrlResult.storagePath) {
            throw new Error("Invalid upload URL response");
          }
          const expectedVersion = typeof createUrlResult.currentVersion === "number"
            ? createUrlResult.currentVersion
            : 0;

          setUploadProgress(prev => ({ ...prev, [tempId]: 0 }));

          // Step 2: Upload directly to Supabase Storage using signed URL (XHR for progress)
          await uploadFileToSignedUrl(createUrlResult.uploadUrl, file, (percent) => {
            if (percent === null) return;
            setUploadProgress(prev => ({ ...prev, [tempId]: percent }));
          });

          // Step 3: Confirm the upload
          const confirmPayload = {
            nodeId: createUrlResult.nodeId,
            storagePath: createUrlResult.storagePath,
            expectedVersion,
          };
          const confirmRes = await fetch("/api/storage/confirm-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(confirmPayload),
          });

          let confirmResult = await confirmRes.json();
          if (confirmRes.status === 409) {
            const refreshRes = await fetch("/api/storage/create-upload-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId,
                parentId: parentId || null,
                fileName,
                contentType: file.type || "application/octet-stream",
              }),
            });
            const refreshResult = await refreshRes.json();
            if (!refreshRes.ok) {
              throw new Error(refreshResult.error || "Upload conflict. Please retry.");
            }
            const refreshedVersion = typeof refreshResult.currentVersion === "number"
              ? refreshResult.currentVersion
              : 0;

            const retryRes = await fetch("/api/storage/confirm-upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nodeId: createUrlResult.nodeId,
                storagePath: createUrlResult.storagePath,
                expectedVersion: refreshedVersion,
              }),
            });
            confirmResult = await retryRes.json();
            if (!retryRes.ok) {
              throw new Error(confirmResult.error || "Upload conflict. Please retry.");
            }
          } else if (!confirmRes.ok) {
            throw new Error(confirmResult.error || "Failed to confirm upload");
          }

          newId = createUrlResult.nodeId;
        } else {
          // Use regular JSON API for small text files
          const content = textContent ?? "";

          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_file",
              path: fullPath,
              content: content,
              projectId: projectId,
            }),
          });

          let result;
          try {
            const text = await res.text();
            if (text && text.trim().startsWith("<")) {
              throw new Error(`Server returned HTML (status ${res.status}). Please re-login or refresh.`);
            }
            result = text ? JSON.parse(text) : {};
          } catch (err: any) {
            throw new Error(err?.message || "Failed to parse server response.");
          }

          if (!res.ok) {
            throw new Error(result.error || "Failed to create file");
          }

          newId = result.nodeId;
        }

        if (isMediaFile(fileName)) {
          prefetchMediaUrl(newId);
        }

        // Update the node with the real ID
        registerTempIdMapping(tempId, newId);
        setNodes(prev => prev.map(n => n.id === tempId ? { ...n, id: newId } : n));
        if (uploadSelection.delete(tempId)) {
          uploadSelection.add(newId);
          syncSelection();
        }

        // Open the file in tabs (MediaPreview will handle media files)
        setOpenTabs(prev => {
          const replaced = prev.map(id => id === tempId ? newId : id);
          return replaced.includes(newId) ? replaced : [...replaced, newId];
        });
        if (shouldFocus) {
          setActiveNodeId(newId);
          setRevealNodeId(newId);
        }
        setUploadProgress(prev => {
          const next = { ...prev };
          delete next[tempId];
          return next;
        });
        updateUndoCreateNodeId(tempId, newId);
        tempIdPathMapRef.current.delete(tempId);
        lastSuccessId = newId;
        if (tempId === lastTempId) {
          lastFinalId = newId;
        }
      } catch (error: any) {
        setNodes(prev => prev.filter(n => n.id !== tempId));
        if (uploadSelection.delete(tempId)) {
          syncSelection();
        }
        setOpenTabs(prev => prev.filter(id => id !== tempId));
        setActiveNodeId(prev => (prev === tempId ? null : prev));
        setUploadProgress(prev => {
          const next = { ...prev };
          delete next[tempId];
          return next;
        });
        removeUndoCreateAction(tempId);
        tempIdPathMapRef.current.delete(tempId);
        if (createdNodeId) {
          try {
            await supabase.from("file_contents").delete().eq("node_id", createdNodeId);
            await supabase.from("nodes").delete().eq("id", createdNodeId);
          } catch (cleanupError) {
            console.error("Failed to cleanup failed upload:", cleanupError);
          }
        }
        alert(`Upload error: ${error.message}`);
      }
    };

    await runWithConcurrency(filesArray, filesArray.length, uploadOne);

    if (lastFinalId || lastSuccessId) {
      const finalId = lastFinalId || lastSuccessId;
      if (finalId) {
        setActiveNodeId(finalId);
        if (!uploadSelection.has(finalId)) {
          uploadSelection.add(finalId);
          syncSelection();
        }
        setRevealNodeId(finalId);
      }
    }
  }, [activeActivity, projectId, supabase, pathByNodeId, registerTempIdMapping, uploadFileToSignedUrl, runWithConcurrency, findExistingNode, promptReplaceConfirmations, pushUndoAction, updateUndoCreateNodeId, removeUndoCreateAction]);

  const uploadFolderItems = useCallback(async (items: UploadItem[], parentId: string | null) => {
    console.log("[FolderUpload] START - items:", items.length, "parentId:", parentId);
    if (items.length === 0) return;
    const uploadBatchId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const initialActiveNodeId = activeNodeIdRef.current;
    const shouldAutoFocus = !initialActiveNodeId;

    const baseParentPath = parentId ? pathByNodeId.get(parentId) || "" : "";
    const rootNames: string[] = [];
    const rootSet = new Set<string>();

    for (const item of items) {
      const normalized = item.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
      const root = normalized.split("/")[0];
      if (root && !rootSet.has(root)) {
        rootSet.add(root);
        rootNames.push(root);
      }
    }

    const rootFolderName = rootNames.length ? rootNames[rootNames.length - 1] : null;
    console.log("[FolderUpload] rootFolderName:", rootFolderName, "rootNames:", rootNames);
    let lastCreatedNodeId: string | null = null;

    // Track the last file in original order (for focusing after upload)
    const lastOriginalItem = items[items.length - 1];
    const lastOriginalItemIsFile = lastOriginalItem && !lastOriginalItem.isDirectory;
    const lastOriginalFilePath = lastOriginalItemIsFile
      ? lastOriginalItem.relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
      : null;
    const createdNodeIdByPath = new Map<string, string>();

    const folderIdByPath = new Map<string, string>();
    for (const node of nodes) {
      if (node.type !== "folder") continue;
      const path = pathByNodeId.get(node.id);
      if (path) {
        folderIdByPath.set(path, node.id);
      }
    }

    const folderInflight = new Map<string, Promise<string>>();
    const ensureFolderId = async (fullPath: string): Promise<string> => {
      const cached = folderIdByPath.get(fullPath);
      if (cached) return cached;
      const inflight = folderInflight.get(fullPath);
      if (inflight) return inflight;

      const promise = (async () => {
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_folder",
            path: fullPath,
            projectId,
            // Don't pass parentId - let API use ensureParentFolders to resolve from path
          }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(result.error || "Failed to create folder");
        }
        const folderId = result.nodeId as string | undefined;
        if (!folderId) {
          throw new Error("Missing folder id");
        }
        folderIdByPath.set(fullPath, folderId);
        return folderId;
      })().finally(() => {
        folderInflight.delete(fullPath);
      });

      folderInflight.set(fullPath, promise);
      return promise;
    };

    const STORAGE_THRESHOLD_BINARY = 2 * 1024 * 1024;
    const STORAGE_THRESHOLD_TEXT = 5 * 1024 * 1024;
    const sortedItems = items.slice().sort((a, b) => {
      const aDepth = a.relativePath.replace(/\\/g, "/").replace(/^\/+/, "").split("/").length;
      const bDepth = b.relativePath.replace(/\\/g, "/").replace(/^\/+/, "").split("/").length;
      return aDepth - bDepth;
    });

    // Lazy read per file to avoid blocking mixed uploads
    const preReadCache = new Map<string, Promise<{ content: string; blob: Blob | null; useStorage: boolean; contentType: string } | null>>();
    const getPreReadContent = (item: UploadItem, normalized: string, fileName: string) => {
      if (preReadCache.has(normalized)) return preReadCache.get(normalized)!;
      const task = (async () => {
        if (!item.file) return null;
      const isBinary = isBinaryFile(fileName);
      const useStorage = isBinary || item.file.size > (isBinary ? STORAGE_THRESHOLD_BINARY : STORAGE_THRESHOLD_TEXT);
      const contentType = item.file.type || "application/octet-stream";
      try {
        if (useStorage) {
          const arrayBuffer = await item.file.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: contentType });
            return { content: "", blob, useStorage: true, contentType };
          }
          try {
            const content = await readFileContent(item.file);
            if (hasUnsupportedJsonUnicode(content)) {
              throw new Error("Unsupported Unicode in text content");
            }
            return { content, blob: null, useStorage: false, contentType };
          } catch {
            const arrayBuffer = await item.file.arrayBuffer();
            const blob = new Blob([arrayBuffer], { type: contentType });
            return { content: "", blob, useStorage: true, contentType };
        }
      } catch (error) {
          console.error(`Failed to read file ${normalized}:`, error);
          return null;
      }
      })();
      preReadCache.set(normalized, task);
      return task;
    };

    // Create temp nodes immediately for instant UI feedback (BEFORE replace dialog)
    const tempIdByPath = new Map<string, string>();
    const tempNodes: Node[] = [];
    const replaceTempNodeId = (tempId: string, realId: string) => {
      if (!tempId || !realId || tempId === realId) return;
      registerTempIdMapping(tempId, realId);
      setNodes(prev => prev.map((n) => {
        if (n.id === tempId) return { ...n, id: realId };
        if (n.parent_id === tempId) return { ...n, parent_id: realId };
        return n;
      }));
      setOpenTabs(prev => prev.map(id => id === tempId ? realId : id));
      setSelectedNodeIds(prev => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        if (next.has(tempId)) {
          next.delete(tempId);
          next.add(realId);
        }
        return next;
      });
      // Use ref to get current activeNodeId (closure value may be stale)
      if (activeNodeIdRef.current === tempId) {
        setActiveNodeId(realId);
      }
      tempIdPathMapRef.current.delete(tempId);
    };

    for (const item of sortedItems) {
      const normalized = item.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
      const tempId = `temp-folder-${Date.now()}-${Math.random()}`;
      tempIdByPath.set(normalized, tempId);
      const fullPath = baseParentPath ? `${baseParentPath}/${normalized}` : normalized;
      tempIdPathMapRef.current.set(tempId, fullPath);

      // Determine parent temp ID
      const parts = normalized.split("/");
      const name = parts.pop() || "";
      const parentPath = parts.join("/");
      const tempParentId = parentPath ? tempIdByPath.get(parentPath) || parentId : parentId;

      tempNodes.push({
        id: tempId,
        project_id: projectId,
        parent_id: tempParentId,
        type: item.isDirectory ? "folder" : "file",
        name,
        created_at: new Date().toISOString(),
      });
    }

    const rootTempId = rootFolderName ? (tempIdByPath.get(rootFolderName) ?? null) : null;

    // ルートフォルダーをタブとして開く
    if (rootTempId) {
      setOpenTabs(prev => prev.includes(rootTempId) ? prev : [...prev, rootTempId]);
      setActiveNodeId(rootTempId);
      setSelectedNodeIds(new Set([rootTempId]));
    }

    // Find existing nodes that will be replaced
    const existingNodesToReplace: Node[] = [];
    for (const rootName of rootNames) {
      const existingNode = findExistingNode(rootName, parentId);
      if (existingNode) {
        existingNodesToReplace.push(existingNode);
      }
    }

    // Helper to get all descendant IDs recursively
    const getDescendantIds = (parentId: string, allNodes: Node[]): string[] => {
      const result: string[] = [];
      const children = allNodes.filter(n => n.parent_id === parentId);
      for (const child of children) {
        result.push(child.id);
        result.push(...getDescendantIds(child.id, allNodes));
      }
      return result;
    };

    // Remove existing nodes AND all their descendants, then add temp nodes
    const existingRootIds = new Set(existingNodesToReplace.map(n => n.id));
    setNodes(prev => {
      // Calculate all IDs to remove (root nodes + all descendants)
      const idsToRemove = new Set<string>();
      for (const existingNode of existingNodesToReplace) {
        idsToRemove.add(existingNode.id);
        for (const descId of getDescendantIds(existingNode.id, prev)) {
          idsToRemove.add(descId);
        }
      }
      return [...prev.filter(n => !idsToRemove.has(n.id)), ...tempNodes];
    });

    // Also remove any open tabs for replaced items and their descendants
    if (existingNodesToReplace.length > 0) {
      setOpenTabs(prev => {
        const idsToRemove = new Set<string>();
        for (const existingNode of existingNodesToReplace) {
          idsToRemove.add(existingNode.id);
          for (const descId of getDescendantIds(existingNode.id, nodes)) {
            idsToRemove.add(descId);
          }
        }
        return prev.filter(id => !idsToRemove.has(id));
      });
      // Check if active node is being removed
      const allIdsToRemove = new Set<string>();
      for (const existingNode of existingNodesToReplace) {
        allIdsToRemove.add(existingNode.id);
        for (const descId of getDescendantIds(existingNode.id, nodes)) {
          allIdsToRemove.add(descId);
        }
      }
      if (activeNodeId && allIdsToRemove.has(activeNodeId)) {
        setActiveNodeId(null);
      }
    }

    // Check for existing root folders/files with the same names (UI already updated)
    const tempIdsSet = new Set(tempIdByPath.values());
    if (existingNodesToReplace.length > 0) {
      const replaceItems = existingNodesToReplace.map((existingNode, index) => ({
        key: `${existingNode.id}:${index}`,
        label: existingNode.name,
        isFolder: existingNode.type === "folder",
        existingNodeId: existingNode.id,
      }));
      const replaceDecisions = await promptReplaceConfirmations(replaceItems);
      for (let index = 0; index < existingNodesToReplace.length; index += 1) {
        const existingNode = existingNodesToReplace[index];
        const decisionKey = replaceItems[index].key;
        const shouldReplace = replaceDecisions.get(decisionKey) ?? false;
      if (!shouldReplace) {
        // Restore all existing nodes and remove all temp nodes
        setNodes(prev => [...prev.filter(n => !tempIdsSet.has(n.id)), ...existingNodesToReplace]);
          for (const tempId of tempIdsSet) {
            tempIdPathMapRef.current.delete(tempId);
          }
        return; // Cancel entire folder upload
      }
      // Clear deleted folder paths from cache to ensure new folders are created
      const existingPath = pathByNodeId.get(existingNode.id);
      if (existingPath) {
        // Remove the deleted folder and all its child paths from cache
        for (const [path] of folderIdByPath) {
          if (path === existingPath || path.startsWith(existingPath + "/")) {
            folderIdByPath.delete(path);
            }
          }
        }
      }
    }

    console.log("[FolderUpload] rootTempId:", rootTempId);
      if (rootTempId) {
      const rootTempNode = tempNodes.find(node => node.id === rootTempId);
      console.log("[FolderUpload] rootTempNode:", rootTempNode);
      if (rootTempNode) {
        console.log("[FolderUpload] Pushing undo action with nodeId:", rootTempId);
        pushUndoAction({ type: "create", nodeId: rootTempId, source: "upload", node: rootTempNode, batchId: uploadBatchId });
      }
    }

    // Select and reveal: if last original item is a file, always open its tab immediately
    const lastOriginalFileTempId = lastOriginalFilePath ? tempIdByPath.get(lastOriginalFilePath) : null;
    if (lastOriginalFileTempId) {
      // Open tab for the last file immediately (shows uploading state)
      setOpenTabs(prev => prev.includes(lastOriginalFileTempId) ? prev : [...prev, lastOriginalFileTempId]);
      setActiveNodeId(lastOriginalFileTempId);
      // Manually sync ref immediately (state update is async, ref check happens before next render)
      activeNodeIdRef.current = lastOriginalFileTempId;
      setSelectedNodeIds(new Set([lastOriginalFileTempId]));
      setRevealNodeId(lastOriginalFileTempId);
      if (activeActivity !== "explorer") {
        setActiveActivity("explorer");
      }
    } else if (rootTempId && shouldAutoFocus) {
      // Fall back to selecting root folder
      setSelectedNodeIds(new Set([rootTempId]));
      setRevealNodeId(rootTempId);
    }

    const uploadOne = async (item: UploadItem) => {
      const normalized = item.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
      const fullPath = baseParentPath ? `${baseParentPath}/${normalized}` : normalized;

      // Handle directory entries - just ensure the folder exists
      if (item.isDirectory) {
        try {
          const createdFolderId = await ensureFolderId(fullPath);
          const tempId = tempIdByPath.get(normalized);
          if (tempId && createdFolderId) {
            replaceTempNodeId(tempId, createdFolderId);
            tempIdByPath.delete(normalized);
            if (rootTempId && tempId === rootTempId) {
              updateUndoCreateNodeId(tempId, createdFolderId);
              if (shouldAutoFocus) {
                setSelectedNodeIds(new Set([createdFolderId]));
                setRevealNodeId(createdFolderId);
              }
            }
          }
        } catch (error: any) {
          console.error(`Folder creation error: ${error.message}`);
        }
        return;
      }

      const parts = normalized.split("/");
      const fileName = parts.pop() || item.file.name;
      const folderPath = parts.join("/");

      // Get content on demand
      const preRead = await getPreReadContent(item, normalized, fileName);
      if (!preRead) {
        console.error(`No content for ${normalized}`);
        return;
      }

      let createdNodeId: string | null = null;
      const tempId = tempIdByPath.get(normalized);
      if (tempId) {
        setUploadProgress(prev => ({ ...prev, [tempId]: 0 }));
      }

      try {
        if (preRead.useStorage) {
          let targetParentId = parentId;
          if (folderPath) {
            const fullFolderPath = baseParentPath ? `${baseParentPath}/${folderPath}` : folderPath;
            targetParentId = await ensureFolderId(fullFolderPath);
          }

          const createUrlRes = await fetch("/api/storage/create-upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              parentId: targetParentId || null,
              fileName,
              contentType: preRead.contentType,
            }),
          });

          const createUrlResult = await createUrlRes.json();
          if (!createUrlRes.ok) {
            throw new Error(createUrlResult.error || "Failed to create upload URL");
          }
          createdNodeId = createUrlResult.nodeId;
          if (!createUrlResult.uploadUrl || !createUrlResult.storagePath) {
            throw new Error("Invalid upload URL response");
          }
          const expectedVersion = typeof createUrlResult.currentVersion === "number"
            ? createUrlResult.currentVersion
            : 0;

          // Use pre-read blob instead of original file
          if (preRead.blob) {
            await uploadFileToSignedUrl(createUrlResult.uploadUrl, preRead.blob, (percent) => {
              if (!tempId) return;
              if (percent === null) return;
              setUploadProgress(prev => ({ ...prev, [tempId]: percent }));
            });
          }

          const confirmPayload = {
            nodeId: createUrlResult.nodeId,
            storagePath: createUrlResult.storagePath,
            expectedVersion,
          };
          const confirmRes = await fetch("/api/storage/confirm-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(confirmPayload),
          });

          let confirmResult = await confirmRes.json();
          if (confirmRes.status === 409) {
            const refreshRes = await fetch("/api/storage/create-upload-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId,
                parentId: targetParentId || null,
                fileName,
                contentType: preRead.contentType,
              }),
            });
            const refreshResult = await refreshRes.json();
            if (!refreshRes.ok) {
              throw new Error(refreshResult.error || "Upload conflict. Please retry.");
            }
            const refreshedVersion = typeof refreshResult.currentVersion === "number"
              ? refreshResult.currentVersion
              : 0;

            const retryRes = await fetch("/api/storage/confirm-upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nodeId: createUrlResult.nodeId,
                storagePath: createUrlResult.storagePath,
                expectedVersion: refreshedVersion,
              }),
            });
            confirmResult = await retryRes.json();
            if (!retryRes.ok) {
              throw new Error(confirmResult.error || "Upload conflict. Please retry.");
            }
          } else if (!confirmRes.ok) {
            throw new Error(confirmResult.error || "Failed to confirm upload");
          }
          lastCreatedNodeId = createUrlResult.nodeId;
          createdNodeIdByPath.set(normalized, createUrlResult.nodeId);
        } else {
          // Use pre-read text content
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_file",
              path: fullPath,
              content: preRead.content,
              projectId,
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(result.error || "Failed to create file");
          }
          if (result?.nodeId) {
            lastCreatedNodeId = result.nodeId as string;
            createdNodeIdByPath.set(normalized, result.nodeId as string);
          }
        }
        if (tempId) {
          setUploadProgress(prev => {
            const next = { ...prev };
            delete next[tempId];
            return next;
          });
        }
        if (lastCreatedNodeId) {
          if (tempId) {
            replaceTempNodeId(tempId, lastCreatedNodeId);
            tempIdByPath.delete(normalized);
            if (rootTempId && tempId === rootTempId) {
              updateUndoCreateNodeId(tempId, lastCreatedNodeId);
              if (shouldAutoFocus) {
                setSelectedNodeIds(new Set([lastCreatedNodeId]));
                setRevealNodeId(lastCreatedNodeId);
              }
            }
          }
        }
      } catch (error: any) {
        if (tempId) {
          setUploadProgress(prev => {
            const next = { ...prev };
            delete next[tempId];
            return next;
          });
        }
        if (createdNodeId) {
          try {
            await supabase.from("file_contents").delete().eq("node_id", createdNodeId);
            await supabase.from("nodes").delete().eq("id", createdNodeId);
          } catch (cleanupError) {
            console.error("Failed to cleanup failed upload:", cleanupError);
          }
        }
        console.error(`File upload error: ${error.message}`);
      }
    };

    console.log("[FolderUpload] Starting upload of", sortedItems.length, "items...");
    // Upload sequentially to avoid UI jumping and ensure items appear as they complete
    await runWithConcurrency(sortedItems, 1, uploadOne);
    console.log("[FolderUpload] Upload complete.");
    if (!initialActiveNodeId && !rootTempId) {
      // If the last item in original order was a file, open that file
      const lastOriginalFileNodeId = lastOriginalFilePath ? createdNodeIdByPath.get(lastOriginalFilePath) : null;
      if (lastOriginalFileNodeId) {
        handleOpenNode(lastOriginalFileNodeId);
      } else if (lastCreatedNodeId) {
        handleOpenNode(lastCreatedNodeId);
      }
    }

    // Background refresh to reconcile any leftover temp nodes
    if (tempIdByPath.size > 0) {
      const leftoverTempIds = new Set(tempIdByPath.values());
      void fetchNodes(false).then(() => {
        setNodes(prev => prev.filter(n => !leftoverTempIds.has(n.id)));
        const activeId = activeNodeIdRef.current;
        if (activeId && leftoverTempIds.has(activeId)) {
          const mapped = tempIdRealIdMapRef.current.get(activeId);
          if (mapped) {
            setActiveNodeId(mapped);
          } else {
            setActiveNodeId(null);
          }
        }
        for (const tempId of leftoverTempIds) {
          tempIdPathMapRef.current.delete(tempId);
        }
      });
    }
  }, [activeActivity, fetchNodes, handleOpenNode, nodes, nodeIdByPath, pathByNodeId, projectId, runWithConcurrency, supabase, uploadFileToSignedUrl, findExistingNode, promptReplaceConfirmations, pushUndoAction, registerTempIdMapping, updateUndoCreateNodeId]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      fileInputRef.current?.blur();
      return;
    }

    const parentId = uploadTargetParentId;
    fileInputRef.current?.blur();
    await uploadFiles(Array.from(files), parentId);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.blur();
    }
    setUploadTargetParentId(null);
  }, [uploadFiles, uploadTargetParentId]);

  const handleFolderInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      folderInputRef.current?.blur();
      return;
    }

    const parentId = uploadTargetParentId;
    folderInputRef.current?.blur();

    // Collect all unique folder paths from file paths
    const folderPaths = new Set<string>();
    const fileItems: UploadItem[] = [];

    Array.from(files).forEach((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      if (shouldIgnoreUploadPath(relativePath, false)) {
        return;
      }
      fileItems.push({ file, relativePath });

      // Extract folder paths
      const parts = relativePath.replace(/\\/g, "/").split("/");
      parts.pop(); // Remove filename
      let currentPath = "";
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        folderPaths.add(currentPath);
      }
    });

    // Create folder entries (sorted by depth so parents are created first)
    const sortedFolderPaths = Array.from(folderPaths).sort((a, b) =>
      a.split("/").length - b.split("/").length
    );
    const folderItems: UploadItem[] = sortedFolderPaths.map((path) => ({
      file: new File([], path.split("/").pop() || ""),
      relativePath: path,
      isDirectory: true,
    }));

    // Combine folder and file items (folders first, sorted by depth)
    const items = [...folderItems, ...fileItems];
    await uploadFolderItems(items, parentId);

    if (folderInputRef.current) {
      folderInputRef.current.value = "";
      folderInputRef.current.blur();
    }
    setUploadTargetParentId(null);
  }, [uploadFolderItems, uploadTargetParentId]);

  const collectDroppedItems = useCallback(async (dataTransfer: DataTransfer) => {
    const items = Array.from(dataTransfer.items || []).filter((item) => item.kind === "file");
    let hasDirectories = false;

    const traverseEntry = async (entry: WebkitEntry, pathPrefix: string): Promise<UploadItem[]> => {
      const entryPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      if (shouldIgnoreUploadPath(entryPath, entry.isDirectory)) {
        return [];
      }
      if (entry.isFile && entry.file) {
        const file = await new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
        const relativePath = entryPath || file.name;
        return [{ file, relativePath }];
      }
      if (entry.isDirectory && entry.createReader) {
        hasDirectories = true;
        const reader = entry.createReader();
        const entries: WebkitEntry[] = [];
        const readBatch = () =>
          new Promise<WebkitEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

        while (true) {
          const batch = await readBatch();
          if (!batch.length) break;
          entries.push(...batch);
        }

        const nextPrefix = entryPath;
        const nested = await Promise.all(entries.map((child) => traverseEntry(child, nextPrefix)));
        const result = nested.flat();

        // Include directory entry (even if empty) so folder structure is preserved
        const dummyFile = new File([], entry.name);
        result.unshift({ file: dummyFile, relativePath: nextPrefix, isDirectory: true });

        return result;
      }
      return [];
    };

    if (items.length > 0 && (items[0] as any).webkitGetAsEntry) {
      const entries = items
        .map((item) => (item as any).webkitGetAsEntry?.() as WebkitEntry | null)
        .filter((entry): entry is WebkitEntry => Boolean(entry));

      const results = await Promise.all(entries.map((entry) => traverseEntry(entry, "")));
      return { items: results.flat(), hasDirectories };
    }

    const files = Array.from(dataTransfer.files || []);
    const filteredFiles = files.filter((file) => !shouldIgnoreUploadPath(file.name, false));
    return {
      items: filteredFiles.map((file) => ({ file, relativePath: file.name })),
      hasDirectories: false,
    };
  }, []);

  // Handler for dropping files onto specific folders in FileTree
  const handleDropFilesOnFolder = useCallback(async (dataTransfer: DataTransfer, targetFolderId: string | null) => {
    const { items, hasDirectories } = await collectDroppedItems(dataTransfer);
    if (items.length === 0) return;

    const hasNestedPaths = items.some((item) => item.relativePath.includes("/"));
    if (hasDirectories || hasNestedPaths) {
      await uploadFolderItems(items, targetFolderId);
    } else {
      await uploadFiles(items.map((item) => item.file), targetFolderId);
    }
  }, [collectDroppedItems, uploadFolderItems, uploadFiles]);

  // Download handler
  const handleDownload = useCallback(async (nodeIds: string[]) => {
    // Collect all nodes (files and folders) to download
    const collectNodes = (ids: string[]): { files: Node[], folders: Node[] } => {
      const files: Node[] = [];
      const folders: Node[] = [];

      const collectRecursive = (id: string) => {
        const node = nodeById.get(id);
        if (!node) return;

        if (node.type === "file") {
          files.push(node);
        } else {
          // Folder - add it and collect children
          folders.push(node);
          const children = nodes.filter(n => n.parent_id === id);
          children.forEach(child => collectRecursive(child.id));
        }
      };

      if (ids.length === 0) {
        // Download all root-level items
        nodes.filter(n => n.parent_id === null).forEach(n => collectRecursive(n.id));
      } else {
        ids.forEach(collectRecursive);
      }
      return { files, folders };
    };

    // Helper to get file content as Blob
    const getFileBlob = async (node: Node): Promise<Blob> => {
      const { data } = await supabase
        .from("file_contents")
        .select("text")
        .eq("node_id", node.id)
        .maybeSingle();

      const content = data?.text || "";

      // Check if it's a storage file
      if (content.startsWith("storage:")) {
        const response = await fetch(`/api/storage/download?nodeId=${node.id}`);
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to download");
        }
        return await response.blob();
      }

      // Check if it's a data URL (legacy binary file)
      if (content.startsWith("data:")) {
        const response = await fetch(content);
        return await response.blob();
      }

      // Text file
      return new Blob([content], { type: "text/plain" });
    };

    // Helper to download a blob directly
    const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    };

    const { files: fileNodes, folders: folderNodes } = collectNodes(nodeIds);

    if (fileNodes.length === 0 && folderNodes.length === 0) {
      alert("ダウンロードするファイルがありません");
      return;
    }

    // Single file download (no ZIP needed)
    if (fileNodes.length === 1 && folderNodes.length === 0) {
      try {
        const blob = await getFileBlob(fileNodes[0]);
        downloadBlob(blob, fileNodes[0].name);
      } catch (error: any) {
        alert(`ダウンロードエラー: ${error.message}`);
      }
      return;
    }

    // Multiple files or folders - create ZIP with directory structure
    const zip = new JSZip();

    // Determine the base path for relative paths in ZIP
    // If downloading specific nodes, find their common ancestor
    let basePath = "";
    if (nodeIds.length > 0) {
      // Get paths of selected nodes (not their contents)
      const selectedPaths = nodeIds.map(id => {
        const node = nodeById.get(id);
        if (!node) return "";
        // Get path up to but not including this node
        const fullPath = pathByNodeId.get(id) || node.name;
        return fullPath;
      }).filter(Boolean);

      // Find common prefix directory
      if (selectedPaths.length === 1) {
        // Single folder selected - use its path as the root
        const selectedNode = nodeById.get(nodeIds[0]);
        if (selectedNode?.type === "folder") {
          basePath = selectedPaths[0] + "/";
        }
      }
    }

    // Sort folders and files alphabetically (folders first, then files - like FileTree)
    const rootFolderIds = new Set(nodeIds.filter(id => nodeById.get(id)?.type === "folder"));

    // Filter and sort folders (excluding root selected folders)
    const sortedFolders = folderNodes
      .filter(folder => !rootFolderIds.has(folder.id))
      .sort((a, b) => {
        const pathA = pathByNodeId.get(a.id) || a.name;
        const pathB = pathByNodeId.get(b.id) || b.name;
        return pathA.localeCompare(pathB);
      });

    // Sort files alphabetically
    const sortedFiles = [...fileNodes].sort((a, b) => {
      const pathA = pathByNodeId.get(a.id) || a.name;
      const pathB = pathByNodeId.get(b.id) || b.name;
      return pathA.localeCompare(pathB);
    });

    // Add folders to ZIP first (including empty ones)
    for (const folder of sortedFolders) {
      const fullPath = pathByNodeId.get(folder.id) || folder.name;
      let zipPath = fullPath;
      if (basePath && fullPath.startsWith(basePath)) {
        zipPath = fullPath.slice(basePath.length);
      }
      // Add folder entry (trailing slash indicates directory)
      if (zipPath) {
        zip.folder(zipPath);
      }
    }

    // Add files to ZIP
    let successCount = 0;
    let errorCount = 0;

    for (const node of sortedFiles) {
      try {
        const fullPath = pathByNodeId.get(node.id) || node.name;
        // Calculate relative path within ZIP
        let zipPath = fullPath;
        if (basePath && fullPath.startsWith(basePath)) {
          zipPath = fullPath.slice(basePath.length);
        }

        const blob = await getFileBlob(node);
        zip.file(zipPath, blob);
        successCount++;
      } catch (error: any) {
        console.error(`Failed to add ${node.name} to ZIP: ${error.message}`);
        errorCount++;
      }
    }

    // Even if no files, we might have empty folders
    if (successCount === 0 && folderNodes.length === 0) {
      alert("ダウンロードできるファイルがありませんでした");
      return;
    }

    // Generate and download ZIP
    try {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipName = nodeIds.length === 1 && nodeById.get(nodeIds[0])?.type === "folder"
        ? `${nodeById.get(nodeIds[0])?.name}.zip`
        : `${activeWorkspace.name}.zip`;
      downloadBlob(zipBlob, zipName);

      if (errorCount > 0) {
        console.warn(`${errorCount}個のファイルをZIPに追加できませんでした`);
      }
    } catch (error: any) {
      alert(`ZIPファイルの作成に失敗しました: ${error.message}`);
    }
  }, [nodes, nodeById, supabase, pathByNodeId, activeWorkspace.name]);

  const handleCloseTab = (id: string) => {
    setOpenTabs((prev) => prev.filter((x) => x !== id));
    if (id.startsWith("virtual-plan:")) {
      setVirtualDocs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    // Clean up shared file data when closing shared file tab
    if (id.startsWith("shared:")) {
      setSharedFileData(null);
      setSharedFileContent("");
      // Clear URL parameter
      window.history.replaceState({}, "", "/app");
    }
    setContentCache((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, id)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeNodeId === id) {
      setOpenTabs((prev) => {
        const newTabs = prev.filter((x) => x !== id);
        if (newTabs.length > 0) {
          const idx = prev.indexOf(id);
          const nextId = prev[idx - 1] ?? prev[idx + 1] ?? newTabs[0];
          setActiveNodeId(nextId);
          if (nodes.some((n) => n.id === nextId)) {
            setSelectedNodeIds(new Set([nextId]));
          }
        } else {
          setActiveNodeId(null);
        }
        return newTabs;
      });
    }
    setPreviewTabId((prev) => (prev === id ? null : prev));
  };

  // ファイル内容取得
  useEffect(() => {
    if (!activeNodeId) {
      setFileContent("");
      return;
    }
    // Virtual doc はSupabaseから取得しない
    if (activeNodeId.startsWith("virtual-plan:")) {
      return;
    }
    // Shared file content is managed separately
    if (activeNodeId.startsWith("shared:")) {
      return;
    }
    if (activeNodeId.startsWith("temp-")) {
      setFileContent("");
      return;
    }
    const draft = draftContentsRef.current[activeNodeId];
    if (draft !== undefined) {
      setFileContent(draft);
      return;
    }
    const pendingContent = pendingContentByRealIdRef.current.get(activeNodeId);
    if (pendingContent !== undefined) {
      setFileContent(pendingContent);
      setDraftContents((prev) => {
        if (prev[activeNodeId] === pendingContent) return prev;
        const next = { ...prev, [activeNodeId]: pendingContent };
        draftContentsRef.current = next;
        return next;
      });
      return;
    }
    const cachedContent = contentCacheRef.current[activeNodeId];
    if (cachedContent !== undefined) {
      setFileContent(cachedContent);
    } else {
      setFileContent("");
    }
    const activeNode = nodeById.get(activeNodeId);
    if (activeNode && isMediaFile(activeNode.name)) {
      setFileContent("");
      return;
    }
    const currentId = activeNodeId;
    let cancelled = false;
    const fetchContent = async () => {
      const { data, error } = await supabase
        .from("file_contents")
        .select("text")
        .eq("node_id", activeNodeId)
        .maybeSingle();
      if (cancelled || activeNodeIdRef.current !== currentId) return;
      if (draftContentsRef.current[currentId] !== undefined) return;
      if (error) {
        console.error("Error fetching file content:", error?.message ?? error);
        setFileContent("");
      } else {
        const nextContent = data?.text || "";
        const lastLocalEditAt = lastLocalEditAtRef.current.get(currentId) ?? 0;
        if (Date.now() - lastLocalEditAt < LOCAL_EDIT_GRACE_MS) {
          pendingRemoteContentRef.current.set(currentId, nextContent);
          schedulePendingRemoteApply(currentId);
          setContentCache((prev) => {
            if (prev[currentId] === nextContent) return prev;
            return { ...prev, [currentId]: nextContent };
          });
          return;
        }
        setFileContent(nextContent);
        setContentCache((prev) => {
          if (prev[currentId] === nextContent) return prev;
          return { ...prev, [currentId]: nextContent };
        });
      }
    };
    fetchContent();
    return () => {
      cancelled = true;
    };
  }, [activeNodeId, nodeById, schedulePendingRemoteApply, supabase]);

  // 保存
  const saveContent = useCallback(async () => {
    if (!activeNodeId) return;
    // Virtual doc は通常保存しない（Save to workspace を使う）
    if (activeNodeId.startsWith("virtual-plan:")) return;
    const resolvedId = activeNodeId.startsWith("temp-")
      ? tempIdRealIdMapRef.current.get(activeNodeId)
      : activeNodeId;
    if (!resolvedId) return;
    const prevDraftActive = draftContentsRef.current[activeNodeId];
    const prevDraftResolved = draftContentsRef.current[resolvedId];
    if (prevDraftActive !== undefined || prevDraftResolved !== undefined) {
      setDraftContents((prev) => {
        const next = { ...prev };
        delete next[activeNodeId];
        delete next[resolvedId];
        draftContentsRef.current = next;
        return next;
      });
    }
    setIsSaving(true);
    const { error } = await supabase
      .from("file_contents")
      .upsert({ node_id: resolvedId, text: fileContent }, { onConflict: "node_id" });
    if (error) {
      console.error("Error saving content:", error?.message ?? error);
      if (prevDraftActive !== undefined || prevDraftResolved !== undefined) {
        setDraftContents((prev) => {
          const next = {
            ...prev,
            ...(prevDraftActive !== undefined ? { [activeNodeId]: prevDraftActive } : {}),
            ...(prevDraftResolved !== undefined ? { [resolvedId]: prevDraftResolved } : {}),
          };
          draftContentsRef.current = next;
          return next;
        });
      }
    } else {
      pendingContentByRealIdRef.current.delete(resolvedId);
      setDraftContents((prev) => {
        const hasResolved = Object.prototype.hasOwnProperty.call(prev, resolvedId);
        const hasTemp = activeNodeId.startsWith("temp-") &&
          Object.prototype.hasOwnProperty.call(prev, activeNodeId);
        if (!hasResolved && !hasTemp) return prev;
        const next = { ...prev };
        delete next[resolvedId];
        if (hasTemp) delete next[activeNodeId];
        draftContentsRef.current = next;
        return next;
      });
      setContentCache((prev) => {
        if (prev[resolvedId] === fileContent) return prev;
        return { ...prev, [resolvedId]: fileContent };
      });
      void broadcastFileContentUpdate(resolvedId, fileContent);
    }
    setIsSaving(false);
    if (activeActivity === "git") {
      void refreshSourceControl();
    }
  }, [activeActivity, activeNodeId, broadcastFileContentUpdate, fileContent, refreshSourceControl, supabase]);

  // Save shared file content
  const saveSharedFileContent = useCallback(async () => {
    if (!sharedFileData || !sharedNodeId) return;
    if (sharedFileData.node.publicAccessRole !== "editor") return;

    // Use refs to get the latest values (avoid stale closure issues)
    const currentContent = sharedFileContentRef.current;
    const originalContent = sharedFileOriginalContentRef.current;

    if (currentContent === originalContent) return;

    // Optimistic update - immediately mark as saved
    const previousOriginal = originalContent;
    setSharedFileOriginalContent(currentContent);
    sharedFileOriginalContentRef.current = currentContent;

    try {
      const res = await fetch("/api/public/node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: sharedNodeId,
          content: currentContent,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "保存に失敗しました");
      }

      void broadcastFileContentUpdate(sharedNodeId, currentContent);
    } catch (error: any) {
      // Revert on error
      setSharedFileOriginalContent(previousOriginal);
      sharedFileOriginalContentRef.current = previousOriginal;
      console.error("Error saving shared file:", error);
      alert(`保存エラー: ${error.message}`);
    }
  }, [broadcastFileContentUpdate, sharedFileData, sharedNodeId]);

  useEffect(() => {
    const handleGlobalSave = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "s") return;

      const activeElement = document.activeElement as HTMLElement | null;
      const isTextInput =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.isContentEditable;
      if (isTextInput) return;

      // Skip if active node is a folder (FolderPageView handles its own save)
      const node = activeNodeId ? nodeById.get(activeNodeId) : null;
      if (node?.type === "folder") return;

      e.preventDefault();
      // Check if active tab is a shared file
      if (activeNodeId?.startsWith("shared:")) {
        saveSharedFileContent();
      } else {
        saveContent();
      }
    };

    document.addEventListener("keydown", handleGlobalSave);
    return () => document.removeEventListener("keydown", handleGlobalSave);
  }, [saveContent, saveSharedFileContent, activeNodeId, nodeById]);

  // AIアクション
  const handleAiAction = (action: string) => {
    if (action === "save") {
      saveContent();
      return;
    }
    if (aiPanelRef.current) {
      aiPanelRef.current.triggerAction(action as any);
    }
  };

  const getActiveVirtualDoc = useCallback((): VirtualDoc | null => {
    if (!activeNodeId) return null;
    return virtualDocs[activeNodeId] ?? null;
  }, [activeNodeId, virtualDocs]);

  const setActiveEditorContent = useCallback((next: string) => {
    if (!activeNodeId) return;
    if (previewTabIdRef.current === activeNodeId) {
      setPreviewTabId(null);
    }
    if (activeNodeId.startsWith("virtual-plan:")) {
      setVirtualDocs((prev) => {
        const doc = prev[activeNodeId];
        if (!doc) return prev;
        return { ...prev, [activeNodeId]: { ...doc, content: next } };
      });
      return;
    }
    if (activeNodeId.startsWith("temp-")) {
      const mappedId = tempIdRealIdMapRef.current.get(activeNodeId);
      if (mappedId) {
        pendingContentByRealIdRef.current.set(mappedId, next);
        noteLocalEdit(mappedId);
        setFileContent(next);
        return;
      }
      if (!editableTempNodeIdsRef.current.has(activeNodeId)) return;
      setTempFileContents((prev) => {
        if (prev[activeNodeId] === next) return prev;
        const updated = { ...prev, [activeNodeId]: next };
        tempFileContentsRef.current = updated;
        return updated;
      });
      return;
    }
    noteLocalEdit(activeNodeId);
    setFileContent(next);
    setDraftContents((prev) => {
      if (prev[activeNodeId] === next) return prev;
      const updated = { ...prev, [activeNodeId]: next };
      draftContentsRef.current = updated;
      return updated;
    });
    setContentCache((prev) => {
      if (prev[activeNodeId] === next) return prev;
      return { ...prev, [activeNodeId]: next };
    });
  }, [activeNodeId, noteLocalEdit]);

  const handleAppend = (text: string) => {
    const virtual = getActiveVirtualDoc();
    if (virtual) {
      setActiveEditorContent(virtual.content + "\n\n" + text);
      return;
    }
    setFileContent((prev) => prev + "\n\n" + text);
  };

  // Plan: 仮想ファイルを開く
  const handleOpenPlan = useCallback((planMarkdown: string, titleHint?: string) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const fileName = `plan-${stamp}.md`;
    const id = `virtual-plan:${Date.now()}`;
    const title = fileName;
    const pathHint = `.cursor/plans/${fileName}`;

    const doc: VirtualDoc = {
      id,
      kind: "plan",
      title,
      fileName,
      pathHint,
      content: planMarkdown,
      created_at: new Date().toISOString(),
    };

    setVirtualDocs((prev) => ({ ...prev, [id]: doc }));
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveNodeId(id);
    // Editor側にフォーカスが欲しい場合はここで何かする（現状はタブを開くだけ）
  }, []);

  // Plan: Save to workspace（.cursor/plans/）
  const handleSavePlanToWorkspace = useCallback(async (virtualId: string) => {
    const doc = virtualDocs[virtualId];
    if (!doc) return;

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_file",
          path: doc.pathHint,
          content: doc.content,
          projectId,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save plan");

      await fetchNodes();
      if (json?.nodeId) {
        handleOpenNode(json.nodeId);
      }

      // 仮想タブを閉じる
      setVirtualDocs((prev) => {
        const next = { ...prev };
        delete next[virtualId];
        return next;
      });
      setOpenTabs((prev) => prev.filter((x) => x !== virtualId));
    } catch (e: any) {
      alert(`Error: ${e.message || e}`);
    }
  }, [fetchNodes, handleOpenNode, projectId, virtualDocs]);

  // Review handlers
  const handleRequestReview = useCallback((changes: PendingChange[], origin?: { sessionId: string; userMessageId: string; assistantMessageId: string }) => {
    setPendingChanges(changes);
    setReviewOrigin(origin ?? null);
    setReviewIssues(null);
    setReviewSelectedChangeId(changes.find(c => c.status === "pending")?.id ?? changes[0]?.id ?? null);
    setReviewFocusIssue(null);
    setReviewOverlayOpen(true);
  }, []);

  const handleReviewSelectFile = useCallback((changeId: string) => {
    setReviewSelectedChangeId(changeId);
    setReviewFocusIssue(null);
    setReviewOverlayOpen(true);
  }, []);

  const handleReviewSelectIssue = useCallback((issueId: string) => {
    const issue = reviewIssues?.find((i) => i.id === issueId);
    if (!issue) return;
    const change = pendingChanges.find((c) => c.filePath === issue.filePath);
    if (change) {
      setReviewSelectedChangeId(change.id);
      setReviewOverlayOpen(true);
    }
    setReviewFocusIssue({ id: issueId, nonce: Date.now() });
  }, [pendingChanges, reviewIssues]);

  const handleReviewClose = useCallback(() => {
    setReviewOverlayOpen(false);
    setReviewFocusIssue(null);
  }, []);

  // Auto-close review when everything is resolved
  useEffect(() => {
    if (pendingChanges.length === 0) return;
    const hasPending = pendingChanges.some((c) => c.status === "pending");
    if (hasPending) return;

    setPendingChanges([]);
    setReviewOrigin(null);
    setReviewOverlayOpen(false);
    setReviewSelectedChangeId(null);
    setReviewIssues(null);
    setReviewFocusIssue(null);
  }, [pendingChanges]);

  const handleReviewDismissIssue = useCallback((issueId: string) => {
    setReviewIssues((prev) =>
      prev ? prev.map((i) => (i.id === issueId ? { ...i, status: "dismissed" as const } : i)) : prev
    );
  }, []);

  const handleReviewFixIssueInChat = useCallback(
    (issueId: string) => {
      const issue = reviewIssues?.find((i) => i.id === issueId);
      if (!issue || issue.status !== "open") return;

      const prompt = issue.fixPrompt
        ? `Fix the following issue in the workspace.\n\nTarget file: ${issue.filePath}\nIssue: ${issue.title}\nDetails: ${issue.description}\n\nInstruction:\n${issue.fixPrompt}\n\nMake minimal changes.`
        : `Fix the following issue in the workspace.\n\nTarget file: ${issue.filePath}\nIssue: ${issue.title}\nDetails: ${issue.description}\n\nMake minimal changes.`;

      aiPanelRef.current?.sendPrompt(prompt, { mode: "agent" });
      setReviewIssues((prev) =>
        prev ? prev.map((i) => (i.id === issueId ? { ...i, status: "fixed" as const } : i)) : prev
      );
    },
    [reviewIssues]
  );

  const handleReviewFixAllIssuesInChat = useCallback(() => {
    const open = (reviewIssues || []).filter((i) => i.status === "open");
    if (open.length === 0) return;

    const prompt = `Fix the following issues in the workspace. Make minimal changes.\n\n${open
      .map((i, idx) => {
        const header = `Issue ${idx + 1} (${i.severity.toUpperCase()}): ${i.title}`;
        const lines = [
          header,
          `File: ${i.filePath}${i.startLine ? `:${i.startLine}` : ""}`,
          `Details: ${i.description}`,
        ];
        if (i.fixPrompt) lines.push(`Instruction: ${i.fixPrompt}`);
        return lines.join("\n");
      })
      .join("\n\n---\n\n")}`;

    aiPanelRef.current?.sendPrompt(prompt, { mode: "agent" });
    setReviewIssues((prev) => (prev ? prev.map((i) => (i.status === "open" ? { ...i, status: "fixed" as const } : i)) : prev));
  }, [reviewIssues]);

  // --- Source Control handlers ---
  const handleScCommit = useCallback(async () => {
    try {
      let autoRunOnCommit = false;
      try {
        const raw = localStorage.getItem("cursor_agent_review_settings");
        const parsed = raw ? JSON.parse(raw) : null;
        autoRunOnCommit = Boolean(parsed?.autoRunOnCommit);
      } catch {
        autoRunOnCommit = false;
      }

      const entriesForReview = Object.values(scChangeDetails);
      const diffsForReview =
        autoRunOnCommit && entriesForReview.length > 0
          ? entriesForReview
              .map((d) => {
                const parts = diffLines(d.oldContent, d.newContent);
                const lines: string[] = [];
                for (const part of parts) {
                  const prefix = part.added ? "+" : part.removed ? "-" : " ";
                  const split = part.value
                    .split("\n")
                    .filter((line, i, arr) => !(i === arr.length - 1 && line === ""));
                  for (const line of split) lines.push(prefix + line);
                }
                return `File: ${d.filePath}\n${lines.join("\n")}`;
              })
              .join("\n\n---\n\n")
          : null;

      const current = await buildCurrentSnapshot();
      setScBaseline(current);
      saveScBaseline(current);
      setScChanges([]);
      setScChangeDetails({});
      setScIssues(null);
      setScCommitMessage("");

      if (autoRunOnCommit && diffsForReview) {
        setIsFindingScIssues(true);
        try {
          const prompt = `You are running Agent Review (Auto-run on commit, Cursor-like).
Analyze these committed diffs and find potential issues (bugs, type errors, missing imports, edge cases, risky edits).

Return JSON only in this shape:
{
  "issues": [
    {
      "filePath": "path/to/file",
      "title": "Short title",
      "description": "What is wrong and why it matters",
      "severity": "high|medium|low",
      "startLine": 1,
      "endLine": 1,
      "fixPrompt": "A short instruction for the agent to fix this"
    }
  ]
}

Rules:
- Only include actionable issues (not style nitpicks).
- Use 1-based line numbers for the current version when possible.
- If line numbers are unknown, omit startLine/endLine.
- Do not include markdown or code fences.

Diffs:
${diffsForReview}`;

          const apiKeys = JSON.parse(localStorage.getItem("cursor_api_keys") || "{}");
          const res = await fetch("/api/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              prompt,
              fileText: "",
              model: "gemini-3-pro-preview",
              mode: "ask",
              apiKeys,
              autoMode: true,
              maxMode: false,
              useMultipleModels: false,
              images: [],
              reviewMode: false,
            }),
          });

          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || "Failed to run review");

          const content = String(data.content || "");
          const parsed = parseAgentReviewIssues(content);
          setScIssues(parsed && parsed.length > 0 ? parsed : null);
        } catch (e: any) {
          alert(`Auto-run review failed: ${e.message || e}`);
        } finally {
          setIsFindingScIssues(false);
        }
      }
    } catch (e: any) {
      alert(`Error: ${e.message || e}`);
    }
  }, [buildCurrentSnapshot, projectId, saveScBaseline, scChangeDetails]);

  const handleScSelectChange = useCallback(
    (changeId: string) => {
      const detail = scChangeDetails[changeId];
      if (!detail?.nodeId) return;

      setOpenTabs((prev) => (prev.includes(detail.nodeId!) ? prev : [...prev, detail.nodeId!]));
      setActiveNodeId(detail.nodeId!);
      setSelectedNodeIds(new Set([detail.nodeId!]));
    },
    [scChangeDetails]
  );

  const handleScRunReview = useCallback(async () => {
    try {
      setIsFindingScIssues(true);
      setScIssues(null);

      const entries = Object.values(scChangeDetails);
      if (entries.length === 0) return;

      const diffs = entries
        .map((d) => {
          const parts = diffLines(d.oldContent, d.newContent);
          const lines: string[] = [];
          for (const part of parts) {
            const prefix = part.added ? "+" : part.removed ? "-" : " ";
            const split = part.value.split("\n").filter((line, i, arr) => !(i === arr.length - 1 && line === ""));
            for (const line of split) lines.push(prefix + line);
          }
          return `File: ${d.filePath}\n${lines.join("\n")}`;
        })
        .join("\n\n---\n\n");

      const prompt = `You are running Agent Review (Source Control, Cursor-like).
Analyze these diffs against the main branch and find potential issues (bugs, type errors, missing imports, edge cases, risky edits).

Return JSON only in this shape:
{
  "issues": [
    {
      "filePath": "path/to/file",
      "title": "Short title",
      "description": "What is wrong and why it matters",
      "severity": "high|medium|low",
      "startLine": 1,
      "endLine": 1,
      "fixPrompt": "A short instruction for the agent to fix this"
    }
  ]
}

Rules:
- Only include actionable issues (not style nitpicks).
- Use 1-based line numbers for the current version when possible.
- If line numbers are unknown, omit startLine/endLine.
- Do not include markdown or code fences.

Diffs:
${diffs}`;

      const apiKeys = JSON.parse(localStorage.getItem("cursor_api_keys") || "{}");
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt,
          fileText: "",
          model: "gemini-3-pro-preview",
          mode: "ask",
          apiKeys,
          autoMode: true,
          maxMode: false,
          useMultipleModels: false,
          images: [],
          reviewMode: false,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to run review");

      const content = String(data.content || "");
      const parsed = parseAgentReviewIssues(content);
      if (parsed && parsed.length > 0) {
        setScIssues(parsed);
      } else {
        setScIssues([
          {
            id: `${Date.now()}`,
            filePath: entries[0]?.filePath || "(unknown)",
            title: "Agent Review (unparsed)",
            description: content || "No output",
            severity: "low",
            status: "open",
          },
        ]);
      }
    } catch (e: any) {
      alert(`Error: ${e.message || e}`);
    } finally {
      setIsFindingScIssues(false);
    }
  }, [projectId, scChangeDetails]);

  const handleScDismissIssue = useCallback((issueId: string) => {
    setScIssues((prev) => (prev ? prev.map((i) => (i.id === issueId ? { ...i, status: "dismissed" as const } : i)) : prev));
  }, []);

  const handleScFixIssueInChat = useCallback(
    (issueId: string) => {
      const issue = scIssues?.find((i) => i.id === issueId);
      if (!issue || issue.status !== "open") return;

      const prompt = issue.fixPrompt
        ? `Fix the following issue (Source Control review).\n\nTarget file: ${issue.filePath}\nIssue: ${issue.title}\nDetails: ${issue.description}\n\nInstruction:\n${issue.fixPrompt}\n\nMake minimal changes.`
        : `Fix the following issue (Source Control review).\n\nTarget file: ${issue.filePath}\nIssue: ${issue.title}\nDetails: ${issue.description}\n\nMake minimal changes.`;

      aiPanelRef.current?.sendPrompt(prompt, { mode: "agent" });
      setScIssues((prev) => (prev ? prev.map((i) => (i.id === issueId ? { ...i, status: "fixed" as const } : i)) : prev));
    },
    [scIssues]
  );

  const handleScFixAllIssuesInChat = useCallback(() => {
    const open = (scIssues || []).filter((i) => i.status === "open");
    if (open.length === 0) return;

    const prompt = `Fix the following issues (Source Control review). Make minimal changes.\n\n${open
      .map((i, idx) => {
        const header = `Issue ${idx + 1} (${i.severity.toUpperCase()}): ${i.title}`;
        const lines = [
          header,
          `File: ${i.filePath}${i.startLine ? `:${i.startLine}` : ""}`,
          `Details: ${i.description}`,
        ];
        if (i.fixPrompt) lines.push(`Instruction: ${i.fixPrompt}`);
        return lines.join("\n");
      })
      .join("\n\n---\n\n")}`;

    aiPanelRef.current?.sendPrompt(prompt, { mode: "agent" });
    setScIssues((prev) => (prev ? prev.map((i) => (i.status === "open" ? { ...i, status: "fixed" as const } : i)) : prev));
  }, [scIssues]);

  const buildAppliedContentFromLineSelections = useCallback(
    (change: PendingChange, mode: "accept" | "reject" = "accept"): string => {
      const hasLineDecisions = change.lineStatuses && Object.keys(change.lineStatuses).length > 0;
      if (!hasLineDecisions) {
        return mode === "accept" ? change.newContent : change.oldContent;
      }

      const parts = diffLines(change.oldContent, change.newContent);
      let lineIndex = 0;
      const out: string[] = [];

      for (const part of parts) {
        const type = part.added ? "added" : part.removed ? "removed" : "context";
        const lines = part.value
          .split("\n")
          .filter((line, i, arr) => !(i === arr.length - 1 && line === ""));

        for (const line of lines) {
          const status = change.lineStatuses?.[lineIndex] || "pending";
          if (type === "context") {
            out.push(line);
          } else if (type === "added") {
            // accept: keep unless rejected
            // reject: keep only accepted
            if (mode === "accept") {
              if (status !== "rejected") out.push(line);
            } else {
              if (status === "accepted") out.push(line);
            }
          } else {
            // removed lines are from the old content
            // accept: remove unless rejected (i.e. keep only rejected)
            // reject: keep unless accepted (i.e. remove only accepted)
            if (mode === "accept") {
              if (status === "rejected") out.push(line);
            } else {
              if (status !== "accepted") out.push(line);
            }
          }
          lineIndex++;
        }
      }

      return out.join("\n");
    },
    []
  );

  const applyOneChange = useCallback(async (change: PendingChange, mode: "accept" | "reject" = "accept"): Promise<AgentCheckpointChange | null> => {
    if (change.status === "rejected") return null;

    // Reject-all selective apply: only apply explicitly accepted lines.
    if (mode === "reject") {
      const hasAnyAcceptedLine = Object.values(change.lineStatuses ?? {}).some((s) => s === "accepted");
      if (!hasAnyAcceptedLine) return null;
      // File-level deletes are treated as all-or-nothing (accept file).
      if (change.action === "delete") return null;
    }

    if (change.action === "create") {
      const contentToWrite = buildAppliedContentFromLineSelections(change, mode);
      const applied: AgentCheckpointChange = {
        path: change.filePath,
        kind: "create",
        beforeText: "",
        afterText: contentToWrite,
      };
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_file", path: change.filePath, content: contentToWrite, projectId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create file");
      await fetchNodes();
      if (json?.nodeId) {
        handleOpenNode(json.nodeId);
      }
      return applied;
    }

    if (change.action === "update") {
      const nodeId = change.id;
      if (!nodeId || nodeId.startsWith("create:")) {
        throw new Error("Missing nodeId for update");
      }
      const contentToWrite = buildAppliedContentFromLineSelections(change, mode);
      const { data: beforeRow, error: beforeError } = await supabase
        .from("file_contents")
        .select("text")
        .eq("node_id", nodeId)
        .single();
      if (beforeError) throw new Error(beforeError.message);
      const beforeText = String(beforeRow?.text || "");
      if (beforeText === contentToWrite) return null;
      const { error } = await supabase
        .from("file_contents")
        .upsert({ node_id: nodeId, text: contentToWrite });
      if (error) throw new Error(error.message);
      if (activeNodeId === nodeId) {
        setFileContent(contentToWrite);
      }
      return {
        path: change.filePath,
        kind: "update",
        beforeText,
        afterText: contentToWrite,
      };
    }

    if (change.action === "delete") {
      const nodeId = change.id;
      if (!nodeId || nodeId.startsWith("create:")) {
        // まだ作っていないファイルのdelete（差分なし）扱い
        return null;
      }
      const { data: beforeRow, error: beforeError } = await supabase
        .from("file_contents")
        .select("text")
        .eq("node_id", nodeId)
        .single();
      if (beforeError) throw new Error(beforeError.message);
      const beforeText = String(beforeRow?.text || "");
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_node", id: nodeId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to delete");
      handleCloseTab(nodeId);
      await fetchNodes();
      return {
        path: change.filePath,
        kind: "delete",
        beforeText,
        afterText: "",
      };
    }
    return null;
  }, [activeNodeId, buildAppliedContentFromLineSelections, fetchNodes, handleCloseTab, handleOpenNode, projectId, supabase]);

  const handleAcceptAll = useCallback(async () => {
    try {
      const applied: AgentCheckpointChange[] = [];
      for (const change of pendingChanges) {
        if (change.status === "rejected" || change.status === "accepted") continue;
        const r = await applyOneChange(change);
        if (r) applied.push(r);
      }
      if (applied.length > 0 && reviewOrigin?.userMessageId) {
        const payload: AgentCheckpointRecordInput = {
          anchorMessageId: reviewOrigin.userMessageId,
          changes: applied,
          description: `Edited ${applied.length} file(s)`,
        };
        aiPanelRef.current?.recordAgentCheckpoint?.(payload);
      }
      setPendingChanges([]);
      setReviewOrigin(null);
      setReviewOverlayOpen(false);
      setReviewSelectedChangeId(null);
      setReviewFocusIssue(null);
    } catch (e: any) {
      alert(`Error: ${e.message || e}`);
    }
  }, [applyOneChange, pendingChanges, reviewOrigin]);

  const handleRejectAll = useCallback(() => {
    (async () => {
      try {
        const applied: AgentCheckpointChange[] = [];
        for (const change of pendingChanges) {
          if (change.status === "rejected" || change.status === "accepted") continue;
          const r = await applyOneChange(change, "reject");
          if (r) applied.push(r);
        }
        if (applied.length > 0 && reviewOrigin?.userMessageId) {
          const payload: AgentCheckpointRecordInput = {
            anchorMessageId: reviewOrigin.userMessageId,
            changes: applied,
            description: `Edited ${applied.length} file(s)`,
          };
          aiPanelRef.current?.recordAgentCheckpoint?.(payload);
        }
      } catch (e: any) {
        alert(`Error: ${e.message || e}`);
      } finally {
        setPendingChanges([]);
        setReviewOrigin(null);
        setReviewIssues(null);
        setReviewOverlayOpen(false);
        setReviewSelectedChangeId(null);
        setReviewFocusIssue(null);
      }
    })();
  }, [applyOneChange, pendingChanges, reviewOrigin]);

  const handleAcceptFile = useCallback(async (changeId: string) => {
    const change = pendingChanges.find(c => c.id === changeId);
    if (!change) return;
    try {
      const r = await applyOneChange(change);
      if (r && reviewOrigin?.userMessageId) {
        const payload: AgentCheckpointRecordInput = {
          anchorMessageId: reviewOrigin.userMessageId,
          changes: [r],
          description: `Edited 1 file`,
        };
        aiPanelRef.current?.recordAgentCheckpoint?.(payload);
      }
      setPendingChanges(prev => 
        prev.map(c => c.id === changeId ? { ...c, status: "accepted" as const } : c)
      );
    } catch (e: any) {
      alert(`Error: ${e.message || e}`);
    }
  }, [applyOneChange, pendingChanges, reviewOrigin]);

  const handleRejectFile = useCallback((changeId: string) => {
    setPendingChanges(prev => 
      prev.map(c => c.id === changeId ? { ...c, status: "rejected" as const } : c)
    );
  }, []);

  const handleAcceptLine = useCallback((changeId: string, lineIndex: number) => {
    setPendingChanges(prev => 
      prev.map(c => {
        if (c.id !== changeId) return c;
        const lineStatuses = { ...c.lineStatuses, [lineIndex]: "accepted" as const };
        return { ...c, lineStatuses };
      })
    );
  }, []);

  const handleRejectLine = useCallback((changeId: string, lineIndex: number) => {
    setPendingChanges(prev => 
      prev.map(c => {
        if (c.id !== changeId) return c;
        const lineStatuses = { ...c.lineStatuses, [lineIndex]: "rejected" as const };
        return { ...c, lineStatuses };
      })
    );
  }, []);

  const handleFindIssues = useCallback(async () => {
    try {
      setIsFindingReviewIssues(true);
      setReviewIssues(null);

      const diffs = pendingChanges
        .filter(c => c.status !== "rejected")
        .map((c) => {
          const parts = diffLines(c.oldContent, c.newContent);
          const lines: string[] = [];
          for (const part of parts) {
            const prefix = part.added ? "+" : part.removed ? "-" : " ";
            const split = part.value.split("\n").filter((line, i, arr) => !(i === arr.length - 1 && line === ""));
            for (const line of split) lines.push(prefix + line);
          }
          return `File: ${c.filePath}\nAction: ${c.action}\n${lines.join("\n")}`;
        })
        .join("\n\n---\n\n");

      const reviewPrompt = `You are running Agent Review (Cursor-like).
Analyze the proposed changes below and find potential issues (bugs, type errors, missing imports, edge cases, risky edits).

Return JSON only in this shape:
{
  "issues": [
    {
      "filePath": "path/to/file",
      "title": "Short title",
      "description": "What is wrong and why it matters",
      "severity": "high|medium|low",
      "startLine": 1,
      "endLine": 1,
      "fixPrompt": "A short instruction for the agent to fix this"
    }
  ]
}

Rules:
- Only include actionable issues (not style nitpicks).
- Use 1-based line numbers for the newContent when possible.
- If line numbers are unknown, omit startLine/endLine.
- Do not include markdown or code fences.

Diffs:
${diffs}`;

      const apiKeys = JSON.parse(localStorage.getItem("cursor_api_keys") || "{}");
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt: reviewPrompt,
          fileText: "",
          model: "gemini-3-pro-preview",
          mode: "ask",
          apiKeys,
          autoMode: true,
          maxMode: false,
          useMultipleModels: false,
          images: [],
          reviewMode: false,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to run review");
      const content = String(data.content || "");
      const parsed = parseAgentReviewIssues(content);
      if (parsed && parsed.length > 0) {
        setReviewIssues(parsed);
      } else {
        setReviewIssues([
          {
            id: `${Date.now()}`,
            filePath: pendingChanges[0]?.filePath || "(unknown)",
            title: "Agent Review (unparsed)",
            description: content || "No output",
            severity: "low",
            status: "open",
          },
        ]);
      }
    } catch (e: any) {
      alert(`Error: ${e.message || e}`);
    } finally {
      setIsFindingReviewIssues(false);
    }
  }, [pendingChanges, projectId]);
  const handleReplace = (text: string) => {
    setActiveEditorContent(text);
    setDiffState({ show: false, newCode: "" });
  };
  const handleRequestDiff = (newCode: string) => setDiffState({ show: true, newCode });
  const handleFileCreated = useCallback(() => {
    void fetchNodes();
    if (activeActivity === "git") {
      void refreshSourceControl();
    }
  }, [activeActivity, fetchNodes, refreshSourceControl]);

  // Get file content by node ID for @Files feature
  const handleGetFileContent = useCallback(async (nodeId: string): Promise<string> => {
    if (nodeId.startsWith("temp-")) return "";
    const { data, error } = await supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", nodeId)
      .maybeSingle();
    
    if (error) {
      console.error("Error fetching file content:", error?.message ?? error);
      return "";
    }
    return data?.text || "";
  }, [supabase]);

  // Panel resize handlers
  const leftPanelWidthRef = useRef(leftPanelWidth);
  const rightPanelWidthRef = useRef(rightPanelWidth);

  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth;
  }, [leftPanelWidth]);

  useEffect(() => {
    rightPanelWidthRef.current = rightPanelWidth;
  }, [rightPanelWidth]);

  const updateLeftResizeHover = useCallback((next: boolean) => {
    if (leftResizeHoverRef.current === next) return;
    leftResizeHoverRef.current = next;
    setIsHoveringLeftResize(next);
  }, []);

  const isLayoutInteractionBlocked = showCreateWorkspace || isWorkspacePopoverOpen;

  const handleLayoutMouseMove = useCallback((event: React.MouseEvent) => {
    if (isLayoutInteractionBlocked) return;
    const container = layoutRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const boundaryX = rect.left + leftPanelWidth;
    const isNearX = Math.abs(event.clientX - boundaryX) <= 4;
    const isWithinY = event.clientY >= rect.top + 48 && event.clientY <= rect.bottom;
    updateLeftResizeHover(isNearX && isWithinY);
  }, [isLayoutInteractionBlocked, leftPanelWidth, updateLeftResizeHover]);

  const handleLayoutMouseLeave = useCallback(() => {
    if (isLayoutInteractionBlocked) return;
    updateLeftResizeHover(false);
  }, [isLayoutInteractionBlocked, updateLeftResizeHover]);

  useEffect(() => {
    if (isLayoutInteractionBlocked) {
      updateLeftResizeHover(false);
    }
  }, [isLayoutInteractionBlocked, updateLeftResizeHover]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = e.clientX;
        setLeftPanelWidth(Math.max(180, Math.min(500, newWidth)));
      }
      if (isResizingRight) {
        const newWidth = window.innerWidth - e.clientX;
        setRightPanelWidth(Math.max(250, Math.min(600, newWidth)));
      }
    };

    const handleMouseUp = () => {
      // Save to localStorage when resizing ends
      if (isResizingLeft) {
        localStorage.setItem("leftPanelWidth", String(leftPanelWidthRef.current));
      }
      if (isResizingRight) {
        localStorage.setItem("rightPanelWidth", String(rightPanelWidthRef.current));
      }
      setIsResizingLeft(false);
      setIsResizingRight(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    if (isResizingLeft || isResizingRight) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingLeft, isResizingRight]);

  const workspaceTabId = `workspace:${activeWorkspace.id}`;

  const tabs = openTabs
    .map((id) => {
      const node = nodes.find((n) => n.id === id);
      if (node) return { id, title: node.name, type: node.type };
      const v = virtualDocs[id];
      if (v) return { id, title: v.title, type: "file" as const };
      // Handle shared file tabs
      if (id.startsWith("shared:") && sharedFileData) {
        return { id, title: sharedFileData.node.name, type: sharedFileData.node.type };
      }
      return null;
    })
    .filter((t): t is { id: string; title: string; type: "file" | "folder" } => t !== null);

  // Check if active tab is a shared file
  const isActiveSharedFile = activeNodeId?.startsWith("shared:") ?? false;

  const activeVirtual = activeNodeId ? virtualDocs[activeNodeId] ?? null : null;
  const activeNode = activeNodeId && !activeNodeId.startsWith("virtual-plan:") && !activeNodeId.startsWith("shared:")
    ? (nodes.find((n) => n.id === activeNodeId) ?? null)
    : null;
  // Detect if workspace page is showing (no active file/folder/virtual/shared)
  const isShowingWorkspace = !activeNodeId || (!activeVirtual && !activeNode && !isActiveSharedFile);

  // Add workspace tab when workspace page is showing
  const tabsWithWorkspace = isShowingWorkspace
    ? [{ id: workspaceTabId, title: activeWorkspace.name, type: "workspace" as const }, ...tabs]
    : tabs;

  // Active tab ID for TabBar
  const activeTabId = isShowingWorkspace ? workspaceTabId : activeNodeId;

  // shareTargetNodeIdが指定されている場合はそのノードを、そうでなければactiveNodeを使用
  const shareTargetNode = shareTargetNodeId
    ? nodes.find((n) => n.id === shareTargetNodeId) ?? null
    : activeNode;
  const shareTarget = shareTargetNode && !shareTargetNode.id.startsWith("temp-") ? shareTargetNode : null;
  // ワークスペース共有用のターゲット
  const shareWorkspace = shareWorkspaceId
    ? currentWorkspaces.find((w) => w.id === shareWorkspaceId) ?? null
    : null;
  const shareSettingsForTarget = shareTargetId
    ? (shareSettings?.nodeId === shareTargetId
        ? shareSettings
        : shareSettingsCacheRef.current.get(shareTargetId) ?? null)
    : null;
  const isPublicForTarget = shareTargetId
    ? (shareSettingsForTarget?.isPublic ?? Boolean(nodeById.get(shareTargetId)?.is_public))
    : isSharePublic;
  const handleShareSettingsChange = useCallback((changes: {
    sharedUsers?: ShareSettingsUser[];
    publicAccessRole?: "viewer" | "editor";
  }) => {
    if (!shareTargetId) return;
    applyShareSettings(shareTargetId, changes, true);
  }, [shareTargetId, applyShareSettings]);
  const handleShareSettingsRefresh = useCallback(() => {
    if (!shareTargetId) return;
    refreshShareSettings(shareTargetId);
  }, [shareTargetId, refreshShareSettings]);
  const activeTempMappedId = activeNodeId && activeNodeId.startsWith("temp-")
    ? tempIdRealIdMapRef.current.get(activeNodeId) ?? null
    : null;
  const activeEditorContent = activeVirtual
    ? activeVirtual.content
    : activeNodeId && activeNodeId.startsWith("temp-")
      ? (activeTempMappedId ? fileContent : (tempFileContents[activeNodeId] ?? ""))
      : fileContent;
  const activeUploadProgress = activeNode &&
    activeNode.id.startsWith("temp-") &&
    uploadProgress[activeNode.id] !== undefined
    ? uploadProgress[activeNode.id]
    : null;
  const activeTempIsEditable = activeNode
    ? activeNode.id.startsWith("temp-") &&
      (editableTempNodeIdsRef.current.has(activeNode.id) ||
        (activeTempMappedId ? pendingContentByRealIdRef.current.has(activeTempMappedId) : false))
    : false;

  // Handle adding code selection to chat
  const handleAddToChat = useCallback((selectedText: string, lineStart: number, lineEnd: number) => {
    const fileName = activeNode?.name || activeVirtual?.fileName || "untitled";
    aiPanelRef.current?.addCodeContext(fileName, lineStart, lineEnd, selectedText);
  }, [activeNode?.name, activeVirtual?.fileName]);

  const handleToggleSharePublic = useCallback(async (newIsPublic: boolean) => {
    const previousValue = isSharePublicRef.current;
    setIsSharePublic(newIsPublic);
    isSharePublicRef.current = newIsPublic;
    if (!shareTargetId) return;
    const previousSettings = shareSettingsCacheRef.current.get(shareTargetId) ?? null;
    const previousRole = previousSettings?.publicAccessRole;
    applyShareSettings(shareTargetId, { isPublic: newIsPublic, publicAccessRole: previousRole }, true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_public", nodeId: shareTargetId, isPublic: newIsPublic }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.error || "Failed to update sharing settings");
      }
      refreshShareSettings(shareTargetId);
    } catch (error) {
      console.error("Failed to toggle public access:", error);
      setIsSharePublic(previousValue);
      isSharePublicRef.current = previousValue;
      if (previousSettings) {
        applyShareSettings(shareTargetId, previousSettings, true, previousSettings.fetchedAt);
      } else {
        shareSettingsCacheRef.current.delete(shareTargetId);
        setShareSettings((prev) => (prev?.nodeId === shareTargetId ? null : prev));
      }
      throw error;
    }
  }, [shareTargetId, applyShareSettings, refreshShareSettings]);

  // Handle duplicating a shared file to user's workspace
  const handleDuplicateSharedFile = useCallback(async () => {
    if (!sharedFileData) return;

    // Generate copy name similar to copy_node action
    const generateCopyName = (originalName: string) => {
      const lastDotIndex = originalName.lastIndexOf(".");
      let baseName: string;
      let extension: string;

      if (lastDotIndex > 0) {
        baseName = originalName.substring(0, lastDotIndex);
        extension = originalName.substring(lastDotIndex);
      } else {
        baseName = originalName;
        extension = "";
      }

      // Remove existing " copy" or " copy N" suffix
      const copyPattern = / copy( \d+)?$/;
      const baseWithoutCopy = baseName.replace(copyPattern, "");

      // Get existing names at root level
      const existingNames = nodes
        .filter(n => n.parent_id === null)
        .map(n => n.name);

      // Find the next copy number
      const escapedBase = baseWithoutCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedExt = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const copyNames = existingNames.filter((name: string) => {
        if (extension) {
          return name === `${baseWithoutCopy}${extension}` ||
            name === `${baseWithoutCopy} copy${extension}` ||
            name.match(new RegExp(`^${escapedBase} copy \\d+${escapedExt}$`));
        }
        return name === baseWithoutCopy ||
          name === `${baseWithoutCopy} copy` ||
          name.match(new RegExp(`^${escapedBase} copy \\d+$`));
      });

      if (copyNames.length === 0) {
        return originalName; // No conflict, use original name
      }

      const numbers = copyNames.map((name: string) => {
        const nameWithoutExt = extension ? name.replace(new RegExp(escapedExt + "$"), "") : name;
        if (nameWithoutExt === baseWithoutCopy) {
          return 0;
        }
        const match = nameWithoutExt.match(/ copy( (\d+))?$/);
        if (match) {
          return match[2] ? parseInt(match[2], 10) : 1;
        }
        return 0;
      });

      const nextCounter = Math.max(...numbers) + 1;
      if (nextCounter === 1) {
        return `${baseWithoutCopy} copy${extension}`;
      }
      return `${baseWithoutCopy} copy ${nextCounter}${extension}`;
    };

    const copyName = generateCopyName(sharedFileData.node.name);
    const content = sharedFileContent || sharedFileData.content || "";

    // Create temporary node and open tab immediately (optimistic update)
    const tempId = `temp-dup-${Date.now()}`;
    const tempNode: Node = {
      id: tempId,
      project_id: projectId,
      parent_id: null,
      type: "file",
      name: copyName,
      is_public: false,
      created_at: new Date().toISOString(),
    };

    // Add temp node to list and open tab immediately
    setNodes((prev) => [...prev, tempNode]);
    setOpenTabs((prev) => [...prev, tempId]);
    setActiveNodeId(tempId);
    setSelectedNodeIds(new Set([tempId]));

    // Store content in cache (not tempFileContents to avoid dirty indicator)
    tempIdPathMapRef.current.set(tempId, copyName);
    setContentCache((prev) => {
      const next = { ...prev, [tempId]: content };
      contentCacheRef.current = next;
      return next;
    });
    // Map temp ID to itself initially so activeEditorContent uses fileContent path
    tempIdRealIdMapRef.current.set(tempId, tempId);
    setFileContent(content);

    // Create file in background
    fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_file",
        path: copyName,
        content,
        projectId,
        parentId: null,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "複製に失敗しました");
        }
        return res.json();
      })
      .then(async ({ nodeId: newNodeId }) => {
        // Replace temp node with real node
        await fetchNodes();

        // Update tabs: replace temp ID with real ID
        setOpenTabs((prev) => prev.map((id) => (id === tempId ? newNodeId : id)));
        setActiveNodeId((prev) => (prev === tempId ? newNodeId : prev));
        setSelectedNodeIds((prev) => {
          const newSet = new Set(prev);
          if (newSet.has(tempId)) {
            newSet.delete(tempId);
            newSet.add(newNodeId);
          }
          return newSet;
        });
        setRevealNodeId(newNodeId);

        // Transfer content cache from temp ID to real ID and clean up
        tempIdPathMapRef.current.delete(tempId);
        tempIdRealIdMapRef.current.set(tempId, newNodeId);
        setContentCache((prev) => {
          const tempContent = prev[tempId];
          if (tempContent === undefined) return prev;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [tempId]: _removed, ...rest } = prev;
          const next: Record<string, string> = { ...rest, [newNodeId]: tempContent };
          contentCacheRef.current = next;
          return next;
        });
      })
      .catch((error: any) => {
        // Remove temp node on error
        setNodes((prev) => prev.filter((n) => n.id !== tempId));
        setOpenTabs((prev) => prev.filter((id) => id !== tempId));
        setActiveNodeId((prev) => (prev === tempId ? null : prev));
        tempIdPathMapRef.current.delete(tempId);
        tempIdRealIdMapRef.current.delete(tempId);
        setContentCache((prev) => {
          if (!Object.prototype.hasOwnProperty.call(prev, tempId)) return prev;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [tempId]: _removed, ...rest } = prev;
          contentCacheRef.current = rest;
          return rest;
        });
        alert(`複製エラー: ${error.message}`);
      });
  }, [sharedFileData, sharedFileContent, projectId, fetchNodes, nodes]);

  // ワークスペース切り替え
  const handleSwitchWorkspace = async (workspaceId: string) => {
    if (workspaceId === activeWorkspace.id) return;
    
    // ページをリロードして新しいワークスペースに切り替え
    // 実際のプロダクトではクエリパラメータやcookieで管理
    window.location.href = `/app?workspace=${workspaceId}`;
  };

  // 新規ワークスペース作成
  const handleCreateWorkspace = async (name: string, type: "personal" | "team") => {
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      const { workspace } = await res.json();

      // ワークスペース一覧を更新
      setCurrentWorkspaces(prev => [...prev, { ...workspace, role: "owner" }]);

      // 新しいワークスペースに切り替え
      window.location.href = `/app?workspace=${workspace.id}`;
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  // ポップオーバーからワークスペース作成ダイアログを開く
  const handleOpenCreateWorkspace = () => {
    setShowCreateWorkspace(true);
  };

  // ワークスペース名変更を実行（optimistic update）
  const handleRenameWorkspace = async (newName: string) => {
    if (!newName.trim()) return;

    const oldName = activeWorkspace.name;

    // Optimistic update - 即座にUI更新
    setCurrentWorkspaces(prev => prev.map(w => w.id === activeWorkspace.id ? { ...w, name: newName } : w));
    setActiveWorkspace(prev => ({ ...prev, name: newName }));

    try {
      const res = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: activeWorkspace.id, name: newName }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
    } catch (error: any) {
      // Revert on error - エラー時に元に戻す
      setCurrentWorkspaces(prev => prev.map(w => w.id === activeWorkspace.id ? { ...w, name: oldName } : w));
      setActiveWorkspace(prev => ({ ...prev, name: oldName }));
      alert(`Error: ${error.message}`);
    }
  };

  // ワークスペース削除を実行
  const handleDeleteWorkspace = async () => {
    try {
      const res = await fetch(`/api/workspaces?workspaceId=${activeWorkspace.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      setShowDeleteWorkspaceConfirm(false);

      // 別のワークスペースに切り替え（または作成画面に）
      const remainingWorkspaces = currentWorkspaces.filter(w => w.id !== activeWorkspace.id);
      if (remainingWorkspaces.length > 0) {
        window.location.href = `/app?workspace=${remainingWorkspaces[0].id}`;
      } else {
        window.location.href = "/app";
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  // ワークスペースをIDで名前変更（インライン編集から）
  const handleRenameWorkspaceById = (workspaceId: string, newName: string) => {
    if (!newName.trim()) return;

    // 現在のワークスペースかどうか確認
    if (workspaceId === activeWorkspace.id) {
      handleRenameWorkspace(newName);
    } else {
      // 別のワークスペースの名前を変更
      (async () => {
        try {
          const res = await fetch("/api/workspaces", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, name: newName }),
          });
          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error);
          }
          setCurrentWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, name: newName } : w));
        } catch (error: any) {
          alert(`Error: ${error.message}`);
        }
      })();
    }
  };

  // ワークスペースをIDで削除（コンテキストメニューから）- ダイアログを表示
  const handleDeleteWorkspaceById = (workspaceId: string, workspaceName: string) => {
    setDeletingWorkspace({ id: workspaceId, name: workspaceName });
  };

  // ワークスペース削除の実行（オプティミスティックアップデート）
  const executeDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;

    const workspaceToDelete = deletingWorkspace;
    const previousWorkspaces = currentWorkspaces;

    // 即座にUIを更新
    setDeletingWorkspace(null);

    // 削除したワークスペースが現在のワークスペースだった場合
    if (workspaceToDelete.id === activeWorkspace.id) {
      const remainingWorkspaces = currentWorkspaces.filter(w => w.id !== workspaceToDelete.id);
      if (remainingWorkspaces.length > 0) {
        // 即座に別のワークスペースに切り替え
        setActiveWorkspace(remainingWorkspaces[0]);
        setCurrentWorkspaces(remainingWorkspaces);
        window.history.replaceState(null, "", `/app?workspace=${remainingWorkspaces[0].id}`);
      } else {
        window.location.href = "/app";
        return;
      }
    } else {
      // 別のワークスペースを削除した場合はリストを即座に更新
      setCurrentWorkspaces(prev => prev.filter(w => w.id !== workspaceToDelete.id));
    }

    // バックグラウンドでAPIを呼び出し
    try {
      const res = await fetch(`/api/workspaces?workspaceId=${workspaceToDelete.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
    } catch (error: any) {
      // エラーの場合は元に戻す
      setCurrentWorkspaces(previousWorkspaces);
      alert(`Error: ${error.message}`);
    }
  };

  // ワークスペースを共有
  const handleShareWorkspace = useCallback((workspaceId: string) => {
    setShareWorkspaceId(workspaceId);
    setShareTargetNodeId(null);
    shareTargetIdRef.current = null;
    setShareSettings(null);
    setIsSharePublic(false);
    isSharePublicRef.current = false;
    setIsSharePublicLoaded(true);
    setIsShareViewReady(true);
    setIsShareOpen(true);
  }, []);

  // 特定のノード（ファイル/フォルダ）を共有
  const handleShareNode = useCallback((nodeId: string) => {
    const localNode = nodeById.get(nodeId);
    const localIsPublic = typeof localNode?.is_public === "boolean" ? localNode.is_public : false;
    const cached = shareSettingsCacheRef.current.get(nodeId) ?? null;
    const baselineRole = localNode?.public_access_role === "editor" ? "editor" : "viewer";
    const baseline: ShareSettings = cached ?? {
      nodeId,
      isPublic: localIsPublic,
      publicAccessRole: baselineRole,
      sharedUsers: [],
      fetchedAt: 0,
    };

    // Switch the target immediately so stale users from the previous node do not linger.
    setIsShareViewReady(true);
    setShareTargetNodeId(nodeId);
    setShareWorkspaceId(null);
    shareTargetIdRef.current = nodeId;
    setShareSettings(baseline);
    shareSettingsCacheRef.current.set(nodeId, baseline);
    const initialIsPublic = baseline.isPublic;
    setIsSharePublic(initialIsPublic);
    isSharePublicRef.current = initialIsPublic;
    setIsSharePublicLoaded(true);
    setIsShareOpen(true);

    void fetchShareSettings(nodeId, true).finally(() => {
      if (shareTargetIdRef.current === nodeId) {
        setIsShareViewReady(true);
      }
    });
  }, [nodeById, fetchShareSettings]);

  const renderSidebarContent = () => {
    switch (activeActivity) {
      case "explorer":
        return (
            <FileTree
              nodes={nodes}
              selectedNodeIds={selectedNodeIds}
              onSelectNode={handleOpenNode}
              onToggleSelectNode={handleToggleSelectNode}
              onClearSelection={handleClearSelection}
              onHoverNode={handleHoverNode}
              revealNodeId={revealNodeId}
              onSelectFolder={handleSelectFolder}
              onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRenameNode={handleRenameNode}
            onDeleteNodes={handleDeleteNodes}
            onUploadFiles={handleUploadFiles}
            onUploadFolder={handleUploadFolder}
            onDownload={handleDownload}
            onShareNode={handleShareNode}
            onDropFiles={handleDropFilesOnFolder}
            onMoveNodes={handleMoveNodes}
            onCopyNodes={handleCopyNodes}
            onUndo={handleUndo}
            onRedo={handleRedo}
            activeNodeId={activeNodeId}
            projectName={activeWorkspace.name}
            userEmail={userEmail}
            onOpenSettings={() => setActiveActivity("settings")}
            onRenameWorkspace={handleRenameWorkspace}
            onDeleteWorkspace={() => setShowDeleteWorkspaceConfirm(true)}
            isLoading={isLoading}
            workspaces={currentWorkspaces.map(w => ({ id: w.id, name: w.name }))}
            activeWorkspaceId={activeWorkspace.id}
            onSelectWorkspace={handleSwitchWorkspace}
            onCreateWorkspace={handleOpenCreateWorkspace}
            onRenameWorkspaceById={handleRenameWorkspaceById}
            onDeleteWorkspaceById={handleDeleteWorkspaceById}
            onShareWorkspace={handleShareWorkspace}
            onWorkspacePopoverOpenChange={setIsWorkspacePopoverOpen}
          />
        );
      case "git":
        return (
          <SourceControlPanel
            commitMessage={scCommitMessage}
            onCommitMessageChange={setScCommitMessage}
            onCommit={handleScCommit}
            changes={scChanges}
            onSelectChange={handleScSelectChange}
            issues={scIssues}
            isReviewing={isFindingScIssues}
            onRunReview={handleScRunReview}
            onFixIssue={handleScFixIssueInChat}
            onDismissIssue={handleScDismissIssue}
            onFixAllIssues={handleScFixAllIssuesInChat}
          />
        );
      default:
        return null;
    }
  };

  // Settingsモードの場合は全面表示
  if (activeActivity === "settings") {
    return (
      <div className="h-screen bg-white text-zinc-700 flex">
        <div className="flex-1 min-w-0">
          <SettingsView />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white text-zinc-700 flex">
      <CommandPalette
        nodes={nodes}
        onSelectNode={handleOpenNode}
        onHoverNode={handleHoverNode}
        onAction={handleAiAction}
      />

      {/* Hidden file input for file uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Hidden folder input for folder uploads */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFolderInputChange}
        // @ts-ignore webkitdirectory is not in React types but needed for folder upload
        webkitdirectory=""
      />

      {diffState.show && (
        <DiffView
          oldCode={activeEditorContent}
          newCode={diffState.newCode}
          onApply={() => handleReplace(diffState.newCode)}
          onCancel={() => setDiffState({ show: false, newCode: "" })}
        />
      )}

      <div
        ref={layoutRef}
        className="flex flex-1 min-w-0"
        onMouseMove={handleLayoutMouseMove}
        onMouseLeave={handleLayoutMouseLeave}
      >
        <aside
          className={`bg-zinc-50 flex flex-col flex-shrink-0 transition-opacity duration-100 ${panelWidthsLoaded ? "opacity-100" : "opacity-0"}`}
          style={{ width: leftPanelWidth }}
        >
          {renderSidebarContent()}
        </aside>

        {/* Left resize handle */}
        <div className="relative w-0 flex-shrink-0 group">
          <div
            className={`pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-blue-500 transition-opacity z-30 ${
              isResizingLeft || isHoveringLeftResize ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            className={`absolute bottom-0 top-12 -left-2 -right-2 z-20 ${
              isLayoutInteractionBlocked ? "pointer-events-none cursor-default" : "cursor-col-resize"
            }`}
            onMouseDown={() => {
              if (isLayoutInteractionBlocked) return;
              setIsResizingLeft(true);
            }}
          >
          </div>
        </div>

        {/* 新規ワークスペース作成ダイアログ */}
        {showCreateWorkspace && (
          <CreateWorkspaceDialog
            onClose={() => setShowCreateWorkspace(false)}
            onCreate={handleCreateWorkspace}
          />
        )}

        {/* ワークスペース削除確認ダイアログ（ヘッダーから） */}
        <DeleteConfirmDialog
          isOpen={showDeleteWorkspaceConfirm}
          names={[activeWorkspace.name]}
          itemType="folder"
          onConfirm={() => {
            setShowDeleteWorkspaceConfirm(false);
            handleDeleteWorkspace();
          }}
          onCancel={() => setShowDeleteWorkspaceConfirm(false)}
        />

        {/* ワークスペース削除確認ダイアログ（コンテキストメニューから） */}
        <DeleteConfirmDialog
          isOpen={!!deletingWorkspace}
          names={deletingWorkspace ? [deletingWorkspace.name] : []}
          itemType="folder"
          onConfirm={executeDeleteWorkspace}
          onCancel={() => setDeletingWorkspace(null)}
        />

        {/* ファイル/フォルダ置換確認ダイアログ */}
        <ReplaceConfirmDialog
          isOpen={replaceDialog.isOpen}
          fileName={replaceDialog.fileName}
          isFolder={replaceDialog.isFolder}
          onReplace={() => handleReplaceDialogResponse(true)}
          onCancel={() => handleReplaceDialogResponse(false)}
        />

        {/* ファイル/フォルダ削除確認ダイアログ */}
        <DeleteConfirmDialog
          isOpen={deleteDialog.isOpen}
          names={deleteDialog.names}
          itemType={deleteDialog.itemType}
          onConfirm={() => handleDeleteDialogResponse(true)}
          onCancel={() => handleDeleteDialogResponse(false)}
        />

        {/* Undo確認ダイアログ */}
        <UndoConfirmDialog
          isOpen={undoDialog.isOpen}
          actionName={undoDialog.actionName}
          actionType={undoDialog.actionType}
          onConfirm={() => handleUndoDialogResponse(true)}
          onCancel={() => handleUndoDialogResponse(false)}
        />

        <main className="flex-1 flex flex-col min-w-0 bg-white">
          <TabBar
            tabs={tabsWithWorkspace}
            activeId={activeTabId}
            onSelect={(id) => {
              // Workspace tab selected - clear active node to show workspace page
              if (id === workspaceTabId) {
                setActiveNodeId(null);
                setSelectedNodeIds(new Set());
                return;
              }
              const node = nodeById.get(id);
              const hasNode = !!node;
              if (node && !id.startsWith("temp-") && isMediaFile(node.name)) {
                prefetchMediaUrl(id);
              }
              setActiveNodeId(id);
              if (hasNode) {
                setSelectedNodeIds(new Set([id]));
                setRevealNodeId(id);
                if (activeActivity !== "explorer") {
                  setActiveActivity("explorer");
                }
              }
            }}
            onClose={(id) => {
              // Workspace tab close - just clear active node
              if (id === workspaceTabId) {
                setActiveNodeId(null);
                return;
              }
              handleCloseTab(id);
            }}
            dirtyIds={dirtyTabIds}
            onShare={() => {
              if (!shareTarget) return;
              handleShareNode(shareTarget.id);
            }}
            onDownload={() => {
              if (!activeNodeId) return;

              if (activeVirtual) {
                const blob = new Blob([activeVirtual.content], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = activeVirtual.fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return;
              }

              // Handle shared file download
              if (isActiveSharedFile && sharedFileData) {
                const content = sharedFileContent || sharedFileData.content || "";
                const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = sharedFileData.node.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return;
              }

              void handleDownload([activeNodeId]);
            }}
            onDuplicate={handleDuplicateSharedFile}
            isSharedFile={isActiveSharedFile}
          />
          {(shareTarget || shareWorkspace) ? (
            isShareOpen ? (
              <SharePopover
                key={shareWorkspace ? shareWorkspace.id : shareTarget!.id}
                isOpen={isShareOpen}
                onClose={() => {
                  setIsShareOpen(false);
                  setShareTargetNodeId(null);
                  setShareWorkspaceId(null);
                }}
                nodeName={shareWorkspace ? shareWorkspace.name : shareTarget!.name}
                nodeId={shareWorkspace ? shareWorkspace.id : shareTarget!.id}
                isPublic={isPublicForTarget}
                isPublicLoaded={isSharePublicLoaded}
                initialSharedUsers={shareSettingsForTarget?.sharedUsers}
                initialPublicAccessRole={shareSettingsForTarget?.publicAccessRole}
                onShareSettingsChange={handleShareSettingsChange}
                onShareSettingsRefresh={handleShareSettingsRefresh}
                onTogglePublic={handleToggleSharePublic}
                ownerEmail={userEmail}
                isWorkspace={!!shareWorkspace}
              />
            ) : null
          ) : null}
          {/* パンくずリスト */}
          {activeNodeId && activeNode && !activeVirtual && (() => {
            const path = pathByNodeId.get(activeNodeId) || tempIdPathMapRef.current.get(activeNodeId);
            if (!path) return null;
            const segments = path.split("/");
            return (
              <div className="flex items-center gap-1 px-3 py-1.5 bg-white text-xs text-zinc-600 overflow-x-auto no-scrollbar">
                {segments.map((segment, index) => {
                  const isLast = index === segments.length - 1;
                  // 最後のセグメントはactiveNodeのタイプに応じてアイコンを決定
                  const Icon = isLast
                    ? (activeNode.type === "folder" ? FileIcons.Folder : getFileIcon(segment))
                    : FileIcons.Folder;
                  return (
                    <span key={index} className="flex items-center gap-1 whitespace-nowrap">
                      {index > 0 && <span className="text-zinc-400 mx-0.5">{">"}</span>}
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className={isLast ? "text-zinc-900" : ""}>{segment}</span>
                    </span>
                  );
                })}
              </div>
            );
          })()}
          {/* 共有ファイルのパンくずリスト */}
          {isActiveSharedFile && sharedFileData && (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-white text-xs text-zinc-600 overflow-x-auto no-scrollbar">
              <span className="inline-flex items-center gap-1 text-zinc-500">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                共有ファイル
              </span>
              <span className="text-zinc-400 mx-0.5">{">"}</span>
              {(() => {
                const Icon = getFileIcon(sharedFileData.node.name);
                return (
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-zinc-900">{sharedFileData.node.name}</span>
                  </span>
                );
              })()}
            </div>
          )}
          {/* ワークスペースのパンくずリスト */}
          {isShowingWorkspace && (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-white text-xs text-zinc-600 overflow-x-auto no-scrollbar">
              <span className="flex items-center gap-1 whitespace-nowrap">
                <FileIcons.Folder className="w-4 h-4 flex-shrink-0" />
                <span className="text-zinc-900">{activeWorkspace.name}</span>
              </span>
            </div>
          )}
          {activeVirtual ? (
            <div className="px-6 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
              <div>
                <div className="text-xs text-zinc-500 mb-0.5">Plan</div>
                <div className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
                  {activeVirtual.fileName}
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                    Unsaved
                  </span>
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Save to: <span className="font-mono">{activeVirtual.pathHint}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSavePlanToWorkspace(activeVirtual.id)}
                  className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                >
                  Save to workspace
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex-1 p-0 relative overflow-hidden">
            {activeNodeId ? (
              activeVirtual ? (
                <MainEditor
                  value={activeVirtual.content}
                  onChange={(v) => {
                    setVirtualDocs((prev) => {
                      const doc = prev[activeVirtual.id];
                      if (!doc) return prev;
                      return { ...prev, [activeVirtual.id]: { ...doc, content: v } };
                    });
                  }}
                  fileName={activeVirtual.fileName}
                  path={activeVirtual.id}
                  onSave={() => handleSavePlanToWorkspace(activeVirtual.id)}
                  onAddToChat={handleAddToChat}
                />
              ) : isActiveSharedFile && sharedFileData ? (
                // Render shared file content
                <MainEditor
                  value={sharedFileContent}
                  onChange={(v) => setSharedFileContent(v)}
                  fileName={sharedFileData.node.name}
                  path={`shared:${sharedFileData.node.id}`}
                  onSave={saveSharedFileContent}
                  onAddToChat={handleAddToChat}
                  readOnly={sharedFileData.node.publicAccessRole === "viewer"}
                />
              ) : activeNode ? (
                activeNode.type === "folder" ? (
                  <FolderPageView
                    folderId={activeNode.id}
                    folderName={activeNode.name}
                    onRename={async (newName) => {
                      await handleRenameNode(activeNode.id, newName);
                    }}
                    onDirtyChange={(isDirty) => {
                      setFolderDirtyIds((prev) => {
                        const next = new Set(prev);
                        if (isDirty) {
                          next.add(activeNode.id);
                        } else {
                          next.delete(activeNode.id);
                        }
                        if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
                        return next;
                      });
                    }}
                    childNodes={nodes.filter((n) => n.parent_id === activeNode.id).map((n) => ({ id: n.id, name: n.name, type: n.type }))}
                    onOpenNode={handleOpenNode}
                    onCreateFile={handleCreateFileInFolder}
                    onCreateFolder={handleCreateFolderInFolder}
                    onUploadFiles={handleUploadFiles}
                    onUploadMedia={handleUploadMedia}
                    onGetMediaUrl={handleGetMediaUrl}
                    parentId={activeNode.id}
                    initialBlocks={folderBlocks[activeNode.id] as any}
                    onSaveBlocks={(blocks) => handleSaveFolderBlocks(activeNode.id, blocks)}
                  />
                ) : activeNode.id.startsWith("temp-") && activeUploadProgress !== null ? (
                  <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex items-center gap-3">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        <span>Uploading...</span>
                      </div>
                      <div className="w-64">
                        <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
                          <div
                            className="h-1.5 bg-blue-500"
                            style={{ width: `${activeUploadProgress ?? 0}%` }}
                          />
                        </div>
                        <div className="mt-2 text-xs text-zinc-500 text-center">
                          {activeUploadProgress ?? 0}%
                        </div>
                      </div>
                    </div>
                  </div>
                ) : activeNode.id.startsWith("temp-") && !activeTempIsEditable ? (
                  <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
                    <div className="flex items-center gap-3">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span>Creating...</span>
                    </div>
                  </div>
                ) : isMediaFile(activeNode.name) ? (
                  <MediaPreview
                    fileName={activeNode.name}
                    nodeId={activeNode.id}
                  />
                ) : (
                  <MainEditor
                    value={activeEditorContent}
                    onChange={setActiveEditorContent}
                    fileName={activeNode.name}
                    path={activeNode.id}
                    onSave={saveContent}
                    onAddToChat={handleAddToChat}
                  />
                )
              ) : (
                <FolderPageView
                  folderId={activeWorkspace.id}
                  folderName={activeWorkspace.name}
                  onRename={async (newName) => {
                    await handleRenameWorkspace(newName);
                  }}
                  onDirtyChange={(isDirty) => {
                    setFolderDirtyIds((prev) => {
                      const next = new Set(prev);
                      if (isDirty) {
                        next.add(`workspace:${activeWorkspace.id}`);
                      } else {
                        next.delete(`workspace:${activeWorkspace.id}`);
                      }
                      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
                      return next;
                    });
                  }}
                  childNodes={nodes.filter((n) => n.parent_id === null).map((n) => ({ id: n.id, name: n.name, type: n.type }))}
                  onOpenNode={handleOpenNode}
                  onCreateFile={handleCreateFileInFolder}
                  onCreateFolder={handleCreateFolderInFolder}
                  onUploadFiles={handleUploadFiles}
                  onUploadMedia={handleUploadMedia}
                  onGetMediaUrl={handleGetMediaUrl}
                  parentId={null}
                  initialBlocks={folderBlocks[`workspace:${activeWorkspace.id}`] as any}
                  onSaveBlocks={(blocks) => handleSaveFolderBlocks(activeWorkspace.id, blocks)}
                />
              )
            ) : sharedNodeId && !sharedFileData ? (
              // Loading state for shared file
              <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
                <div className="flex items-center gap-3">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>読み込み中...</span>
                </div>
              </div>
            ) : (
              <FolderPageView
                folderId={activeWorkspace.id}
                folderName={activeWorkspace.name}
                onRename={async (newName) => {
                  await handleRenameWorkspace(newName);
                }}
                onDirtyChange={(isDirty) => {
                  setFolderDirtyIds((prev) => {
                    const next = new Set(prev);
                    if (isDirty) {
                      next.add(`workspace:${activeWorkspace.id}`);
                    } else {
                      next.delete(`workspace:${activeWorkspace.id}`);
                    }
                    if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
                    return next;
                  });
                }}
                childNodes={nodes.filter((n) => n.parent_id === null).map((n) => ({ id: n.id, name: n.name, type: n.type }))}
                onOpenNode={handleOpenNode}
                onCreateFile={handleCreateFileInFolder}
                onCreateFolder={handleCreateFolderInFolder}
                onUploadFiles={handleUploadFiles}
                onUploadMedia={handleUploadMedia}
                onGetMediaUrl={handleGetMediaUrl}
                parentId={null}
                initialBlocks={folderBlocks[`workspace:${activeWorkspace.id}`] as any}
                onSaveBlocks={(blocks) => handleSaveFolderBlocks(activeWorkspace.id, blocks)}
              />
            )}

            {reviewOverlayOpen && pendingChanges.length > 0 && (
              <ReviewPanel
                changes={pendingChanges}
                selectedChangeId={reviewSelectedChangeId}
                onSelectChange={handleReviewSelectFile}
                onAcceptFile={handleAcceptFile}
                onRejectFile={handleRejectFile}
                onAcceptLine={handleAcceptLine}
                onRejectLine={handleRejectLine}
                focusIssue={reviewFocusIssue}
                issues={reviewIssues}
                isFindingIssues={isFindingReviewIssues}
                onFindIssues={handleFindIssues}
                onDismissIssue={handleReviewDismissIssue}
                onFixIssueInChat={handleReviewFixIssueInChat}
                onFixAllIssuesInChat={handleReviewFixAllIssuesInChat}
                onClose={() => {
                  handleReviewClose();
                  setReviewIssues(null);
                }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Right resize handle */}
      <div className="relative w-0 flex-shrink-0">
        <div
          className={`absolute inset-y-0 -left-2 -right-2 group z-20 ${
            isLayoutInteractionBlocked ? "pointer-events-none cursor-default" : "cursor-col-resize"
          }`}
          onMouseDown={() => {
            if (isLayoutInteractionBlocked) return;
            setIsResizingRight(true);
          }}
        >
          <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>

      <aside
        className={`flex-shrink-0 bg-zinc-50 transition-opacity duration-100 ${panelWidthsLoaded ? "opacity-100" : "opacity-0"}`}
        style={{ width: rightPanelWidth }}
      >
          <AiPanel
            ref={aiPanelRef}
            projectId={projectId}
            currentFileText={activeEditorContent}
            onAppend={handleAppend}
            onRequestDiff={handleRequestDiff}
            onRequestReview={handleRequestReview}
            onOpenPlan={handleOpenPlan}
            onFileCreated={handleFileCreated}
            nodes={nodes}
            onGetFileContent={handleGetFileContent}
            onHoverNode={handleHoverNode}
            reviewChanges={pendingChanges}
            reviewIssues={reviewIssues}
            isFindingReviewIssues={isFindingReviewIssues}
            onReviewSelectFile={handleReviewSelectFile}
            onReviewSelectIssue={handleReviewSelectIssue}
            onReviewAcceptAll={handleAcceptAll}
            onReviewRejectAll={handleRejectAll}
            onReviewFindIssues={handleFindIssues}
            onReviewDismissIssue={handleReviewDismissIssue}
            onReviewFixIssueInChat={handleReviewFixIssueInChat}
            onReviewFixAllIssuesInChat={handleReviewFixAllIssuesInChat}
          />
        </aside>
      </div>
  );
}

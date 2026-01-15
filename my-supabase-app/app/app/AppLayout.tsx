"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { diffLines } from "diff";
import JSZip from "jszip";
import { AiPanel, AiPanelHandle } from "@/components/AiPanel";
import { TabBar } from "@/components/TabBar";
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
import type { PendingChange, ReviewIssue } from "@/lib/review/types";
import type { AgentCheckpointChange, AgentCheckpointRecordInput } from "@/lib/checkpoints/types";

type Node = {
  id: string;
  project_id: string;
  parent_id: string | null;
  type: "file" | "folder";
  name: string;
  created_at: string;
};

type UploadItem = {
  file: File;
  relativePath: string;
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

function getCachedNodes(projectId: string): Node[] | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(`${NODES_CACHE_KEY}:${projectId}`);
    if (!cached) return null;
    const { nodes } = JSON.parse(cached);
    return nodes;
  } catch {
    return null;
  }
}

function setCachedNodes(projectId: string, nodes: Node[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${NODES_CACHE_KEY}:${projectId}`,
      JSON.stringify({ nodes })
    );
  } catch {
    // Ignore storage errors
  }
}

export default function AppLayout({ projectId, workspaces, currentWorkspace, userEmail, initialNodes = [] }: Props) {
  const router = useRouter();
  // Use initialNodes from server, or cached nodes, for instant display
  const [nodes, setNodes] = useState<Node[]>(() => {
    if (initialNodes.length > 0) return initialNodes;
    const cached = getCachedNodes(projectId);
    return cached || [];
  });
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [activeActivity, setActiveActivity] = useState<Activity>("explorer");
  const [fileContent, setFileContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
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
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [currentWorkspaces, setCurrentWorkspaces] = useState(workspaces);
  const [activeWorkspace, setActiveWorkspace] = useState(currentWorkspace);
  const [showDeleteWorkspaceConfirm, setShowDeleteWorkspaceConfirm] = useState(false);

  // Resizable panel widths (persisted to localStorage)
  const [leftPanelWidth, setLeftPanelWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [panelWidthsLoaded, setPanelWidthsLoaded] = useState(false);

  // Load panel widths from localStorage after hydration
  useEffect(() => {
    const savedLeft = localStorage.getItem("leftPanelWidth");
    const savedRight = localStorage.getItem("rightPanelWidth");
    if (savedLeft) setLeftPanelWidth(parseInt(savedLeft, 10));
    if (savedRight) setRightPanelWidth(parseInt(savedRight, 10));
    setPanelWidthsLoaded(true);
  }, []);

  const aiPanelRef = useRef<AiPanelHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetParentId, setUploadTargetParentId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [revealNodeId, setRevealNodeId] = useState<string | null>(null);
  const prefetchedMediaIdsRef = useRef<Set<string>>(new Set());
  const pendingNodeIdsRef = useRef<Set<string>>(new Set());
  const supabase = createClient();

  const getNodeKey = (node: Node) => `${node.type}:${node.parent_id ?? "root"}:${node.name}`;

  // Undo/Redo stack for file operations
  type UndoAction =
    | { type: "delete"; nodeId: string; node: Node; content?: string; children?: { node: Node; content?: string }[] }
    | { type: "create"; nodeId: string; node?: Node; content?: string }
    | { type: "rename"; nodeId: string; oldName: string; newName: string }
    | { type: "move"; nodeIds: string[]; oldParentIds: (string | null)[]; newParentId: string | null }
    | { type: "copy"; nodeIds: string[] };
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const MAX_UNDO_STACK = 50;

  const pushUndoAction = useCallback((action: UndoAction) => {
    setUndoStack(prev => {
      const newStack = [...prev, action];
      if (newStack.length > MAX_UNDO_STACK) {
        return newStack.slice(-MAX_UNDO_STACK);
      }
      return newStack;
    });
    // Clear redo stack when a new action is performed
    setRedoStack([]);
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
        .order("type", { ascending: false })
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      if (error) {
        console.error("Error fetching nodes:", error);
        setIsLoading(false);
        return [];
      }

      const pageData = data || [];
      allNodes.push(...pageData);
      if (pageData.length < pageSize) break;
      page += 1;
    }

    setNodes((prev) => {
      const serverNodes = allNodes;
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
      const newNodes = [...serverNodes, ...pendingNodes];
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

  // Undo/Redo handlers (must be after fetchNodes)
  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;

    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));

    try {
      switch (action.type) {
        case "delete": {
          // Restore deleted node and its children
          const { node, content, children } = action;

          // First restore the parent node
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
          if (!res.ok) throw new Error(json?.error || "Failed to restore");

          // Restore children if any
          if (children && children.length > 0) {
            const newParentId = json.nodeId;
            for (const child of children) {
              await fetch("/api/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: child.node.type === "file" ? "create_file" : "create_folder",
                  path: child.node.name,
                  content: child.content || "",
                  projectId: child.node.project_id,
                  parentId: child.node.parent_id === node.id ? newParentId : child.node.parent_id,
                }),
              });
            }
          }

          // Push to redo stack (create action to redo = delete again)
          setRedoStack(prev => [...prev, { type: "create", nodeId: json.nodeId, node, content }]);
          fetchNodes();
          break;
        }
        case "create": {
          // Get node info before deleting (for redo)
          const nodeToDelete = nodes.find(n => n.id === action.nodeId);
          let contentToSave: string | undefined;
          if (nodeToDelete?.type === "file") {
            try {
              const { data } = await supabase
                .from("file_contents")
                .select("text")
                .eq("node_id", action.nodeId)
                .single();
              contentToSave = data?.text;
            } catch {
              // ignore
            }
          }

          // Delete the created node
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete_node", id: action.nodeId }),
          });
          if (!res.ok) throw new Error("Failed to undo create");

          // Push to redo stack (delete action to redo = create again)
          if (nodeToDelete) {
            setRedoStack(prev => [...prev, { type: "delete", nodeId: action.nodeId, node: nodeToDelete, content: contentToSave }]);
          }

          setNodes(prev => prev.filter(n => n.id !== action.nodeId));
          setOpenTabs(prev => prev.filter(id => id !== action.nodeId));
          if (activeNodeId === action.nodeId) {
            setActiveNodeId(null);
          }
          break;
        }
        case "rename": {
          // Rename back to old name
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "rename_node", id: action.nodeId, newName: action.oldName }),
          });
          if (!res.ok) throw new Error("Failed to undo rename");

          // Push to redo stack (swap old and new names)
          setRedoStack(prev => [...prev, { type: "rename", nodeId: action.nodeId, oldName: action.newName, newName: action.oldName }]);

          setNodes(prev => prev.map(n => n.id === action.nodeId ? { ...n, name: action.oldName } : n));
          break;
        }
        case "move": {
          // Move back to original parent
          await Promise.all(action.nodeIds.map(async (nodeId, index) => {
            const res = await fetch("/api/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "move_node", id: nodeId, newParentId: action.oldParentIds[index] }),
            });
            if (!res.ok) throw new Error(`Failed to undo move for ${nodeId}`);
          }));

          // Push to redo stack (swap old and new parent IDs)
          const currentParentIds = action.nodeIds.map(() => action.newParentId);
          setRedoStack(prev => [...prev, { type: "move", nodeIds: action.nodeIds, oldParentIds: currentParentIds, newParentId: action.oldParentIds[0] }]);

          setNodes(prev => prev.map(n => {
            const index = action.nodeIds.indexOf(n.id);
            if (index >= 0) {
              return { ...n, parent_id: action.oldParentIds[index] };
            }
            return n;
          }));
          break;
        }
        case "copy": {
          // Delete the copied nodes
          for (const nodeId of action.nodeIds) {
            await fetch("/api/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete_node", id: nodeId }),
            });
          }
          // Push to redo stack (copy action - but we can't easily redo copy, so skip)
          fetchNodes();
          break;
        }
      }
    } catch (error: any) {
      alert(`元に戻せませんでした: ${error.message}`);
      // Put the action back on the stack if it failed
      setUndoStack(prev => [...prev, action]);
    }
  }, [undoStack, nodes, activeNodeId, fetchNodes, supabase]);

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
          let contentToSave: string | undefined;
          if (action.node?.type === "file" || nodeToDelete?.type === "file") {
            try {
              const { data } = await supabase
                .from("file_contents")
                .select("text")
                .eq("node_id", action.nodeId)
                .single();
              contentToSave = data?.text;
            } catch {
              contentToSave = action.content;
            }
          }

          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete_node", id: action.nodeId }),
          });
          if (!res.ok) throw new Error("Failed to redo delete");

          // Push back to undo stack
          const nodeInfo = nodeToDelete || action.node;
          if (nodeInfo) {
            setUndoStack(prev => [...prev, { type: "delete", nodeId: action.nodeId, node: nodeInfo, content: contentToSave }]);
          }

          setNodes(prev => prev.filter(n => n.id !== action.nodeId));
          setOpenTabs(prev => prev.filter(id => id !== action.nodeId));
          if (activeNodeId === action.nodeId) {
            setActiveNodeId(null);
          }
          break;
        }
        case "rename": {
          // Redo rename = rename back to the "new" name (which is now oldName in redo action)
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "rename_node", id: action.nodeId, newName: action.oldName }),
          });
          if (!res.ok) throw new Error("Failed to redo rename");

          // Push back to undo stack (swap names again)
          setUndoStack(prev => [...prev, { type: "rename", nodeId: action.nodeId, oldName: action.newName, newName: action.oldName }]);

          setNodes(prev => prev.map(n => n.id === action.nodeId ? { ...n, name: action.oldName } : n));
          break;
        }
        case "move": {
          // Redo move = move to the "new" parent (which is now in oldParentIds)
          await Promise.all(action.nodeIds.map(async (nodeId, index) => {
            const res = await fetch("/api/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "move_node", id: nodeId, newParentId: action.oldParentIds[index] }),
            });
            if (!res.ok) throw new Error(`Failed to redo move for ${nodeId}`);
          }));

          // Push back to undo stack
          const currentParentIds = action.nodeIds.map(() => action.newParentId);
          setUndoStack(prev => [...prev, { type: "move", nodeIds: action.nodeIds, oldParentIds: currentParentIds, newParentId: action.oldParentIds[0] }]);

          setNodes(prev => prev.map(n => {
            const index = action.nodeIds.indexOf(n.id);
            if (index >= 0) {
              return { ...n, parent_id: action.oldParentIds[index] };
            }
            return n;
          }));
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
      created_at: new Date().toISOString(),
    };
    setNodes(prev => [...prev, tempNode]);
    setSelectedNodeIds(new Set([tempId]));
    setOpenTabs((prev) => (prev.includes(tempId) ? prev : [...prev, tempId]));
    setActiveNodeId(tempId);
    if (activeActivity !== "explorer") {
      setActiveActivity("explorer");
    }

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_file", path, projectId, parentId }),
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
        // Push undo action for create
        pushUndoAction({ type: "create", nodeId: json.nodeId });
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
          setOpenTabs(prev => prev.map(id => id === tempId ? recoveredNode.id : id));
          if (activeNodeId === tempId) {
            setActiveNodeId(recoveredNode.id);
          }
          setSelectedNodeIds(new Set([recoveredNode.id]));
        }
      } catch (refreshError) {
        console.error("Failed to refresh nodes after create error:", refreshError);
      }
      if (!recovered) {
        // 失敗したらロールバック
        setNodes(prev => prev.filter(n => n.id !== tempId));
        setOpenTabs(prev => prev.filter(id => id !== tempId));
        setActiveNodeId(prevActiveId ?? null);
        setSelectedNodeIds(new Set(prevSelectedIds));
        alert(`Error: ${error.message}`);
      }
    }
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
      created_at: new Date().toISOString(),
    };
    setNodes(prev => [...prev, tempNode]);
    setSelectedNodeIds(new Set([tempId]));

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_folder", path, projectId, parentId }),
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
        pendingNodeIdsRef.current.add(json.nodeId);
        setNodes(prev => {
          const hasReal = prev.some(n => n.id === json.nodeId);
          if (hasReal) {
            return prev.filter(n => n.id !== tempId);
          }
          return prev.map(n => n.id === tempId ? { ...n, id: json.nodeId } : n);
        });
        setSelectedNodeIds(new Set([json.nodeId]));
        // Push undo action for create
        pushUndoAction({ type: "create", nodeId: json.nodeId });
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
          setSelectedNodeIds(new Set([recoveredNode.id]));
        }
      } catch (refreshError) {
        console.error("Failed to refresh nodes after create error:", refreshError);
      }
      if (!recovered) {
        setNodes(prev => prev.filter(n => n.id !== tempId));
        setSelectedNodeIds(new Set(prevSelectedIds));
        alert(`Error: ${error.message}`);
      }
    }
  };

  const handleRenameNode = async (id: string, newName: string) => {
    // Optimistic: 即座にUIを更新
    const oldNode = nodes.find(n => n.id === id);
    if (!oldNode) return;

    const oldName = oldNode.name;
    setNodes(prev => prev.map(n => n.id === id ? { ...n, name: newName } : n));

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename_node", id, newName }),
      });
      if (!res.ok) throw new Error("Failed to rename");
      // Push undo action for rename
      pushUndoAction({ type: "rename", nodeId: id, oldName, newName });
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

  const handleCopyNodes = async (nodeIds: string[], newParentId: string | null) => {
    try {
      // Copy each node using the API
      const newNodeIds: string[] = [];
      for (const nodeId of nodeIds) {
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "copy_node", id: nodeId, newParentId }),
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || `Failed to copy node`);
        }
        const json = await res.json();
        if (json.nodeId) {
          newNodeIds.push(json.nodeId);
        }
      }
      // Push undo action for copy
      if (newNodeIds.length > 0) {
        pushUndoAction({ type: "copy", nodeIds: newNodeIds });
      }
      // Refresh the node list
      fetchNodes();
    } catch (error: any) {
      alert(`コピーエラー: ${error.message}`);
    }
  };

  const handleDeleteNode = async (id: string) => {
    // Optimistic: 即座にUIから削除
    const oldNodes = [...nodes];

    // 削除するノード情報を保存（undo用）
    const nodeToDelete = nodes.find(n => n.id === id);
    if (!nodeToDelete) return;

    // 子ノードも含めて削除
    const idsToDelete = new Set<string>();
    const collectChildren = (parentId: string) => {
      idsToDelete.add(parentId);
      nodes.filter(n => n.parent_id === parentId).forEach(child => collectChildren(child.id));
    };
    collectChildren(id);

    // ファイルのコンテンツを取得（undo用）
    let content: string | undefined;
    const children: { node: Node; content?: string }[] = [];

    if (nodeToDelete.type === "file") {
      try {
        const { data } = await supabase
          .from("file_contents")
          .select("text")
          .eq("node_id", id)
          .single();
        content = data?.text;
      } catch {
        // コンテンツ取得に失敗しても削除は続行
      }
    }

    // 子ノードのコンテンツも取得
    for (const nodeId of idsToDelete) {
      if (nodeId === id) continue;
      const childNode = nodes.find(n => n.id === nodeId);
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
        children.push({ node: childNode, content: childContent });
      }
    }

    setNodes(prev => prev.filter(n => !idsToDelete.has(n.id)));

    // タブからも削除
    setOpenTabs(prev => prev.filter(tabId => !idsToDelete.has(tabId)));
    if (activeNodeId && idsToDelete.has(activeNodeId)) {
      setActiveNodeId(null);
    }
    setSelectedNodeIds(prev => {
      const next = new Set(prev);
      idsToDelete.forEach((nodeId) => next.delete(nodeId));
      return next;
    });

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_node", id }),
      });
      if (!res.ok) throw new Error("Failed to delete");
      // Push undo action for delete
      pushUndoAction({
        type: "delete",
        nodeId: id,
        node: nodeToDelete,
        content,
        children: children.length > 0 ? children : undefined,
      });
    } catch (error: any) {
      // 失敗したらロールバック
      setNodes(oldNodes);
      alert(`Error: ${error.message}`);
    }
  };

  const handleOpenNode = (nodeId: string) => {
    // フォルダかどうかはFileTree側で判断して展開/ファイルオープンを呼び分けてもらう形にするが、
    // ここではファイルを開く処理のみ
    const isTempNode = nodeId.startsWith("temp-");
    const node = nodeById.get(nodeId);
    if (!isTempNode && node && isMediaFile(node.name)) {
      prefetchMediaUrl(nodeId);
    }
    setOpenTabs((prev) =>
      prev.includes(nodeId) ? prev : [...prev, nodeId]
    );
    setActiveNodeId(nodeId);
    setSelectedNodeIds(new Set([nodeId]));
    if (activeActivity !== "explorer") {
      setActiveActivity("explorer");
    }
  };

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
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedNodeIds(new Set());
  }, []);

  // Upload files handler
  const handleUploadFiles = useCallback((parentId: string | null) => {
    setUploadTargetParentId(parentId);
    fileInputRef.current?.click();
  }, []);

  // Upload folder handler
  const handleUploadFolder = useCallback((parentId: string | null) => {
    setUploadTargetParentId(parentId);
    folderInputRef.current?.click();
  }, []);

  // Check if file is binary (image, video, audio, etc.)
  const isBinaryFile = (fileName: string): boolean => {
    const binaryExtensions = [
      "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
      "mp4", "webm", "mov", "avi", "mkv", "m4v",
      "mp3", "wav", "ogg", "m4a", "flac", "aac",
      "pdf", "zip", "rar", "7z", "tar", "gz",
      "ttf", "otf", "woff", "woff2", "eot"
    ];
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return binaryExtensions.includes(ext);
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

  const uploadFileToSignedUrl = useCallback((uploadUrl: string, file: File, onProgress: (percent: number | null) => void) => {
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

  const uploadFiles = useCallback(async (files: File[], parentId: string | null) => {
    if (!files.length) return;
    const parentPath = parentId ? pathByNodeId.get(parentId) || "" : "";

    // Threshold for using Storage (2MB for binary, 5MB for text)
    const STORAGE_THRESHOLD_BINARY = 2 * 1024 * 1024;
    const STORAGE_THRESHOLD_TEXT = 5 * 1024 * 1024;

    const filesArray = Array.from(files);
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

      // Create the file node optimistically
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
        created_at: new Date().toISOString(),
      };

      setNodes(prev => [...prev, tempNode]);
      uploadSelection.add(tempId);
      syncSelection();
      setOpenTabs(prev => (prev.includes(tempId) ? prev : [...prev, tempId]));
      if (shouldFocus) {
        setActiveNodeId(tempId);
        setRevealNodeId(tempId);
      }

      let createdNodeId: string | null = null;

      try {
        let newId: string;

        if (useStorage) {
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

          setUploadProgress(prev => ({ ...prev, [tempId]: 0 }));

          // Step 2: Upload directly to Supabase Storage using signed URL (XHR for progress)
          await uploadFileToSignedUrl(createUrlResult.uploadUrl, file, (percent) => {
            if (percent === null) return;
            setUploadProgress(prev => ({ ...prev, [tempId]: percent }));
          });

          // Step 3: Confirm the upload
          const confirmRes = await fetch("/api/storage/confirm-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeId: createUrlResult.nodeId,
              storagePath: createUrlResult.storagePath,
            }),
          });

          const confirmResult = await confirmRes.json();
          if (!confirmRes.ok) {
            throw new Error(confirmResult.error || "Failed to confirm upload");
          }

          newId = createUrlResult.nodeId;
        } else {
          // Use regular JSON API for small text files
          const content = await readFileContent(file);
          const fullPath = parentPath ? `${parentPath}/${fileName}` : fileName;

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
            result = text ? JSON.parse(text) : {};
          } catch {
            throw new Error("Failed to parse server response.");
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
  }, [projectId, supabase, pathByNodeId, uploadFileToSignedUrl, runWithConcurrency]);

  const uploadFolderItems = useCallback(async (items: UploadItem[], parentId: string | null) => {
    if (items.length === 0) return;

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
    let lastCreatedNodeId: string | null = null;

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
            parentId,
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

    const uploadOne = async (item: UploadItem) => {
      const normalized = item.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
      const parts = normalized.split("/");
      const fileName = parts.pop() || item.file.name;
      const folderPath = parts.join("/");
      const fullPath = baseParentPath ? `${baseParentPath}/${normalized}` : normalized;
      const isBinary = isBinaryFile(fileName);
      const useStorage = isBinary || item.file.size > (isBinary ? STORAGE_THRESHOLD_BINARY : STORAGE_THRESHOLD_TEXT);
      let createdNodeId: string | null = null;

      try {
        if (useStorage) {
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
              contentType: item.file.type || "application/octet-stream",
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

          await uploadFileToSignedUrl(createUrlResult.uploadUrl, item.file, () => {});

          const confirmRes = await fetch("/api/storage/confirm-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeId: createUrlResult.nodeId,
              storagePath: createUrlResult.storagePath,
            }),
          });

          const confirmResult = await confirmRes.json();
          if (!confirmRes.ok) {
            throw new Error(confirmResult.error || "Failed to confirm upload");
          }
          lastCreatedNodeId = createUrlResult.nodeId;
        } else {
          const content = await readFileContent(item.file);
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_file",
              path: fullPath,
              content,
              projectId,
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(result.error || "Failed to create file");
          }
          if (result?.nodeId) {
            lastCreatedNodeId = result.nodeId as string;
          }
        }
      } catch (error: any) {
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

    await runWithConcurrency(sortedItems, sortedItems.length, uploadOne);

    const refreshedNodes = await fetchNodes();
    if (rootFolderName) {
      const folderNode = refreshedNodes.find((node: Node) =>
        node.type === "folder" &&
        node.name === rootFolderName &&
        node.parent_id === parentId
      );
      if (folderNode) {
        setSelectedNodeIds(new Set([folderNode.id]));
        setRevealNodeId(folderNode.id);
        if (activeActivity !== "explorer") {
          setActiveActivity("explorer");
        }
        return;
      }
    }
    if (lastCreatedNodeId) {
      handleOpenNode(lastCreatedNodeId);
    }
  }, [activeActivity, fetchNodes, handleOpenNode, nodes, pathByNodeId, projectId, runWithConcurrency, supabase, uploadFileToSignedUrl]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const parentId = uploadTargetParentId;
    await uploadFiles(Array.from(files), parentId);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploadTargetParentId(null);
  }, [uploadFiles, uploadTargetParentId]);

  const handleFolderInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const parentId = uploadTargetParentId;
    const items: UploadItem[] = Array.from(files).map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));
    await uploadFolderItems(items, parentId);

    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
    setUploadTargetParentId(null);
  }, [uploadFolderItems, uploadTargetParentId]);

  const collectDroppedItems = useCallback(async (dataTransfer: DataTransfer) => {
    const items = Array.from(dataTransfer.items || []).filter((item) => item.kind === "file");
    let hasDirectories = false;

    const traverseEntry = async (entry: WebkitEntry, pathPrefix: string): Promise<UploadItem[]> => {
      if (entry.isFile && entry.file) {
        const file = await new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
        const relativePath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
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

        const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
        const nested = await Promise.all(entries.map((child) => traverseEntry(child, nextPrefix)));
        return nested.flat();
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
    return {
      items: files.map((file) => ({ file, relativePath: file.name })),
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
    if (activeNodeId.startsWith("temp-")) {
      setFileContent("");
      return;
    }
    const activeNode = nodeById.get(activeNodeId);
    if (activeNode && isMediaFile(activeNode.name)) {
      setFileContent("");
      return;
    }
    const fetchContent = async () => {
      const { data, error } = await supabase
        .from("file_contents")
        .select("text")
        .eq("node_id", activeNodeId)
        .maybeSingle();
      if (error) {
        console.error("Error fetching file content:", error?.message ?? error);
        setFileContent("");
      } else {
        setFileContent(data?.text || "");
      }
    };
    fetchContent();
  }, [activeNodeId, nodeById, supabase]);

  // 保存
  const saveContent = useCallback(async () => {
    if (!activeNodeId) return;
    // Virtual doc は通常保存しない（Save to workspace を使う）
    if (activeNodeId.startsWith("virtual-plan:") || activeNodeId.startsWith("temp-")) return;
    setIsSaving(true);
    const { error } = await supabase
      .from("file_contents")
      .upsert({ node_id: activeNodeId, text: fileContent }, { onConflict: "node_id" });
    if (error) console.error("Error saving content:", error?.message ?? error);
    setIsSaving(false);
    if (activeActivity === "git") {
      void refreshSourceControl();
    }
  }, [activeActivity, activeNodeId, fileContent, refreshSourceControl, supabase]);

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
    if (activeNodeId.startsWith("virtual-plan:")) {
      setVirtualDocs((prev) => {
        const doc = prev[activeNodeId];
        if (!doc) return prev;
        return { ...prev, [activeNodeId]: { ...doc, content: next } };
      });
      return;
    }
    setFileContent(next);
  }, [activeNodeId]);

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

  const tabs = openTabs
    .map((id) => {
      const node = nodes.find((n) => n.id === id);
      if (node) return { id, title: node.name };
      const v = virtualDocs[id];
      if (v) return { id, title: v.title };
      return null;
    })
    .filter((t): t is { id: string; title: string } => t !== null);

  const activeVirtual = activeNodeId ? virtualDocs[activeNodeId] ?? null : null;
  const activeNode = activeNodeId && !activeNodeId.startsWith("virtual-plan:")
    ? (nodes.find((n) => n.id === activeNodeId) ?? null)
    : null;
  const activeEditorContent = activeVirtual ? activeVirtual.content : fileContent;
  const activeUploadProgress = activeNode && activeNode.id.startsWith("temp-")
    ? uploadProgress[activeNode.id]
    : null;

  // ワークスペース切り替え
  const handleSwitchWorkspace = async (workspaceId: string) => {
    if (workspaceId === activeWorkspace.id) return;
    
    // ページをリロードして新しいワークスペースに切り替え
    // 実際のプロダクトではクエリパラメータやcookieで管理
    window.location.href = `/app?workspace=${workspaceId}`;
  };

  // 新規ワークスペース作成
  const handleCreateWorkspace = async (name: string) => {
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
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
            onDeleteNode={handleDeleteNode}
            onUploadFiles={handleUploadFiles}
            onUploadFolder={handleUploadFolder}
            onDownload={handleDownload}
            onDropFiles={handleDropFilesOnFolder}
            onMoveNodes={handleMoveNodes}
            onCopyNodes={handleCopyNodes}
            onUndo={handleUndo}
            onRedo={handleRedo}
            projectName={activeWorkspace.name}
            userEmail={userEmail}
            onOpenSettings={() => setActiveActivity("settings")}
            onRenameWorkspace={handleRenameWorkspace}
            onDeleteWorkspace={() => setShowDeleteWorkspaceConfirm(true)}
            isLoading={isLoading}
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

      <div className="flex flex-1 min-w-0">
        <aside
          className={`bg-zinc-50 border-r border-zinc-200 flex flex-col flex-shrink-0 transition-opacity duration-100 ${panelWidthsLoaded ? "opacity-100" : "opacity-0"}`}
          style={{ width: leftPanelWidth }}
        >
          {renderSidebarContent()}
        </aside>

        {/* Left resize handle */}
        <div
          className="w-1 bg-transparent hover:bg-blue-500 cursor-col-resize transition-colors flex-shrink-0 group"
          onMouseDown={() => setIsResizingLeft(true)}
        >
          <div className="w-full h-full group-hover:bg-blue-500" />
        </div>

        {/* 新規ワークスペース作成ダイアログ */}
        {showCreateWorkspace && (
          <CreateWorkspaceDialog
            onClose={() => setShowCreateWorkspace(false)}
            onCreate={handleCreateWorkspace}
          />
        )}

        {/* ワークスペース削除確認ダイアログ */}
        {showDeleteWorkspaceConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-96 p-6">
              <h2 className="text-lg font-semibold mb-2">ワークスペースを削除</h2>
              <p className="text-zinc-600 mb-4">
                「{activeWorkspace.name}」を削除しますか？この操作は取り消せません。すべてのファイルとフォルダも削除されます。
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteWorkspaceConfirm(false)}
                  className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-md"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleDeleteWorkspace}
                  className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                >
                  削除
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 flex flex-col min-w-0 bg-white">
          <TabBar
            tabs={tabs}
            activeId={activeNodeId}
            onSelect={(id) => {
              const node = nodeById.get(id);
              if (node && !id.startsWith("temp-") && isMediaFile(node.name)) {
                prefetchMediaUrl(id);
              }
              setActiveNodeId(id);
              if (nodes.some((n) => n.id === id)) {
                setSelectedNodeIds(new Set([id]));
              }
            }}
            onClose={handleCloseTab}
          />
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
                  onSave={() => handleSavePlanToWorkspace(activeVirtual.id)}
                />
              ) : activeNode ? (
                activeNode.id.startsWith("temp-") && typeof activeUploadProgress === "number" ? (
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
                            style={{ width: `${activeUploadProgress}%` }}
                          />
                        </div>
                        <div className="mt-2 text-xs text-zinc-500 text-center">
                          {activeUploadProgress}%
                        </div>
                      </div>
                    </div>
                  </div>
                ) : isMediaFile(activeNode.name) ? (
                  <MediaPreview
                    fileName={activeNode.name}
                    nodeId={activeNode.id}
                  />
                ) : (
                  <MainEditor
                    value={fileContent}
                    onChange={setFileContent}
                    fileName={activeNode.name}
                    onSave={saveContent}
                  />
                )
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
                  <div className="text-center">
                    <p className="mb-2">Select a file to edit</p>
                    <p className="text-xs opacity-60">Cmd+S to save</p>
                  </div>
                </div>
              )
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
                <div className="text-center">
                  <p className="mb-2">Select a file to edit</p>
                  <p className="text-xs opacity-60">Cmd+S to save</p>
                </div>
              </div>
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
      <div
        className="w-1 bg-transparent hover:bg-blue-500 cursor-col-resize transition-colors flex-shrink-0 group"
        onMouseDown={() => setIsResizingRight(true)}
      >
        <div className="w-full h-full group-hover:bg-blue-500" />
      </div>

      <aside
        className={`border-l border-zinc-200 flex-shrink-0 bg-zinc-50 transition-opacity duration-100 ${panelWidthsLoaded ? "opacity-100" : "opacity-0"}`}
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

"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { diffLines } from "diff";
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

export default function AppLayout({ projectId, workspaces, currentWorkspace, userEmail }: Props) {
  const router = useRouter();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [activeActivity, setActiveActivity] = useState<Activity>("explorer");
  const [fileContent, setFileContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
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

  // Resizable panel widths
  const [leftPanelWidth, setLeftPanelWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const aiPanelRef = useRef<AiPanelHandle>(null);
  const supabase = createClient();

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
  const fetchNodes = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("nodes")
      .select("*")
      .eq("project_id", projectId)
      .order("type", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching nodes:", error);
    } else {
      setNodes(data || []);
    }
    setIsLoading(false);
  }, [projectId, supabase]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

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
  const handleCreateFile = async (path: string) => {
    // パスから名前とparent_idを計算
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const tempId = `temp-${Date.now()}`;
    const prevActiveId = activeNodeId;
    const prevSelectedIds = new Set(selectedNodeIds);
    
    // 親フォルダを探す（簡易実装：ルート直下のみ即座に反映）
    let parentId: string | null = null;
    if (parts.length > 1) {
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
        body: JSON.stringify({ action: "create_file", path, projectId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create file");
      if (json?.nodeId) {
        setNodes(prev => prev.map(n => n.id === tempId ? { ...n, id: json.nodeId } : n));
        setOpenTabs(prev => prev.map(id => id === tempId ? json.nodeId : id));
        setActiveNodeId(json.nodeId);
        setSelectedNodeIds(new Set([json.nodeId]));
      }
      // 成功したら正式なデータで更新
      fetchNodes();
    } catch (error: any) {
      // 失敗したらロールバック
      setNodes(prev => prev.filter(n => n.id !== tempId));
      setOpenTabs(prev => prev.filter(id => id !== tempId));
      setActiveNodeId(prevActiveId ?? null);
      setSelectedNodeIds(new Set(prevSelectedIds));
      alert(`Error: ${error.message}`);
    }
  };

  const handleCreateFolder = async (path: string) => {
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const tempId = `temp-${Date.now()}`;
    const prevSelectedIds = new Set(selectedNodeIds);
    
    let parentId: string | null = null;
    if (parts.length > 1) {
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
        body: JSON.stringify({ action: "create_folder", path, projectId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create folder");
      if (json?.nodeId) {
        setNodes(prev => prev.map(n => n.id === tempId ? { ...n, id: json.nodeId } : n));
        setSelectedNodeIds(new Set([json.nodeId]));
      }
      fetchNodes();
    } catch (error: any) {
      setNodes(prev => prev.filter(n => n.id !== tempId));
      setSelectedNodeIds(new Set(prevSelectedIds));
      alert(`Error: ${error.message}`);
    }
  };

  const handleRenameNode = async (id: string, newName: string) => {
    // Optimistic: 即座にUIを更新
    const oldNode = nodes.find(n => n.id === id);
    if (!oldNode) return;

    setNodes(prev => prev.map(n => n.id === id ? { ...n, name: newName } : n));

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename_node", id, newName }),
      });
      if (!res.ok) throw new Error("Failed to rename");
      // 成功 - 再取得は不要（既にローカル更新済み）
    } catch (error: any) {
      // 失敗したらロールバック
      setNodes(prev => prev.map(n => n.id === id ? oldNode : n));
      alert(`Error: ${error.message}`);
    }
  };

  const handleDeleteNode = async (id: string) => {
    // Optimistic: 即座にUIから削除
    const oldNodes = [...nodes];
    
    // 子ノードも含めて削除
    const idsToDelete = new Set<string>();
    const collectChildren = (parentId: string) => {
      idsToDelete.add(parentId);
      nodes.filter(n => n.parent_id === parentId).forEach(child => collectChildren(child.id));
    };
    collectChildren(id);
    
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
    } catch (error: any) {
      // 失敗したらロールバック
      setNodes(oldNodes);
      alert(`Error: ${error.message}`);
    }
  };

  const handleOpenNode = (nodeId: string) => {
    // フォルダかどうかはFileTree側で判断して展開/ファイルオープンを呼び分けてもらう形にするが、
    // ここではファイルを開く処理のみ
    setOpenTabs((prev) =>
      prev.includes(nodeId) ? prev : [...prev, nodeId]
    );
    setActiveNodeId(nodeId);
    setSelectedNodeIds(new Set([nodeId]));
    if (activeActivity !== "explorer") {
      setActiveActivity("explorer");
    }
  };

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
  }, [activeNodeId, supabase]);

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
            onSelectFolder={handleSelectFolder}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRenameNode={handleRenameNode}
            onDeleteNode={handleDeleteNode}
            projectName={activeWorkspace.name}
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
      <CommandPalette nodes={nodes} onSelectNode={handleOpenNode} onAction={handleAiAction} />
      
      {diffState.show && (
        <DiffView
          oldCode={activeEditorContent}
          newCode={diffState.newCode}
          onApply={() => handleReplace(diffState.newCode)}
          onCancel={() => setDiffState({ show: false, newCode: "" })}
        />
      )}

      <aside
        className="bg-zinc-50 border-r border-zinc-200 flex flex-col flex-shrink-0"
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

      <main className="flex-1 flex flex-col min-w-0 bg-white">
        <TabBar
          tabs={tabs}
          activeId={activeNodeId}
          onSelect={(id) => {
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
              <MainEditor
                value={fileContent}
                onChange={setFileContent}
                fileName={activeNode.name}
                onSave={saveContent}
              />
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

      {/* Right resize handle */}
      <div
        className="w-1 bg-transparent hover:bg-blue-500 cursor-col-resize transition-colors flex-shrink-0 group"
        onMouseDown={() => setIsResizingRight(true)}
      >
        <div className="w-full h-full group-hover:bg-blue-500" />
      </div>

      <aside 
        className="border-l border-zinc-200 flex-shrink-0 bg-zinc-50"
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

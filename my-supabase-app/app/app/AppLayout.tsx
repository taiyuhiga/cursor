"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { diffLines } from "diff";
import { AiPanel, AiPanelHandle } from "@/components/AiPanel";
import { TabBar } from "@/components/TabBar";
import { PageHeader } from "@/components/PageHeader";
import { ActivityBar } from "@/components/ActivityBar";
import { MainEditor } from "@/components/MainEditor";
import { DiffView } from "@/components/DiffView";
import { CommandPalette } from "@/components/CommandPalette";
import { FileTree } from "@/components/FileTree";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { SettingsView } from "@/components/SettingsView";
import { ReviewPanel, PendingChange } from "@/components/ReviewPanel";

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
  const [activeActivity, setActiveActivity] = useState<Activity>("explorer");
  const [fileContent, setFileContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [diffState, setDiffState] = useState<{
    show: boolean;
    newCode: string;
  }>({ show: false, newCode: "" });
  const [virtualDocs, setVirtualDocs] = useState<Record<string, VirtualDoc>>({});
  const [showReview, setShowReview] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [reviewIssues, setReviewIssues] = useState<string | null>(null);
  const [isFindingIssues, setIsFindingIssues] = useState(false);
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

  // ファイル操作アクション（Optimistic UI）
  const handleCreateFile = async (path: string) => {
    // パスから名前とparent_idを計算
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const tempId = `temp-${Date.now()}`;
    
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

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_file", path, projectId }),
      });
      if (!res.ok) throw new Error("Failed to create file");
      // 成功したら正式なデータで更新
      fetchNodes();
    } catch (error: any) {
      // 失敗したらロールバック
      setNodes(prev => prev.filter(n => n.id !== tempId));
      alert(`Error: ${error.message}`);
    }
  };

  const handleCreateFolder = async (path: string) => {
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const tempId = `temp-${Date.now()}`;
    
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

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_folder", path, projectId }),
      });
      if (!res.ok) throw new Error("Failed to create folder");
      fetchNodes();
    } catch (error: any) {
      setNodes(prev => prev.filter(n => n.id !== tempId));
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
    if (activeActivity !== "explorer") {
      setActiveActivity("explorer");
    }
  };

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
    const fetchContent = async () => {
      const { data, error } = await supabase
        .from("file_contents")
        .select("*")
        .eq("node_id", activeNodeId)
        .single();
      if (error) {
        console.error("Error fetching file content:", error);
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
    if (activeNodeId.startsWith("virtual-plan:")) return;
    setIsSaving(true);
    const { error } = await supabase
      .from("file_contents")
      .update({ text: fileContent })
      .eq("node_id", activeNodeId);
    if (error) console.error("Error saving content:", error);
    setIsSaving(false);
  }, [activeNodeId, fileContent, supabase]);

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
  const handleRequestReview = useCallback((changes: PendingChange[]) => {
    setPendingChanges(changes);
    setShowReview(true);
  }, []);

  const handleAcceptAll = useCallback(async () => {
    for (const change of pendingChanges.filter(c => c.status === "pending")) {
      if (change.action === "create" || change.action === "update") {
        // Apply the change
        const { error } = await supabase
          .from("file_contents")
          .upsert({
            node_id: change.id,
            text: change.newContent,
          });
        if (!error) {
          // Update local state if this is the active file
          if (activeNodeId === change.id) {
            setFileContent(change.newContent);
          }
        }
      }
    }
    setPendingChanges(prev => prev.map(c => ({ ...c, status: "accepted" as const })));
    setShowReview(false);
  }, [pendingChanges, activeNodeId, supabase]);

  const handleRejectAll = useCallback(() => {
    setPendingChanges(prev => prev.map(c => ({ ...c, status: "rejected" as const })));
    setShowReview(false);
  }, []);

  const handleAcceptFile = useCallback(async (changeId: string) => {
    const change = pendingChanges.find(c => c.id === changeId);
    if (!change) return;

    if (change.action === "create" || change.action === "update") {
      const { error } = await supabase
        .from("file_contents")
        .upsert({
          node_id: change.id,
          text: change.newContent,
        });
      if (!error && activeNodeId === change.id) {
        setFileContent(change.newContent);
      }
    }
    
    setPendingChanges(prev => 
      prev.map(c => c.id === changeId ? { ...c, status: "accepted" as const } : c)
    );
  }, [pendingChanges, activeNodeId, supabase]);

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
  const handleReplace = (text: string) => {
    setActiveEditorContent(text);
    setDiffState({ show: false, newCode: "" });
  };
  const handleRequestDiff = (newCode: string) => setDiffState({ show: true, newCode });
  const handleFileCreated = useCallback(() => fetchNodes(), [fetchNodes]);

  // Get file content by node ID for @Files feature
  const handleGetFileContent = useCallback(async (nodeId: string): Promise<string> => {
    const { data, error } = await supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", nodeId)
      .single();
    
    if (error) {
      console.error("Error fetching file content:", error);
      return "";
    }
    return data?.text || "";
  }, [supabase]);

  // Panel resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = e.clientX - 48; // 48px is ActivityBar width
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
            activeNodeId={activeNodeId}
            onSelectNode={handleOpenNode}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRenameNode={handleRenameNode}
            onDeleteNode={handleDeleteNode}
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
        <ActivityBar activeActivity={activeActivity} onSelect={setActiveActivity} />
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

      {showReview && pendingChanges.length > 0 && (
        <ReviewPanel
          changes={pendingChanges}
          onAcceptAll={handleAcceptAll}
          onRejectAll={handleRejectAll}
          onAcceptFile={handleAcceptFile}
          onRejectFile={handleRejectFile}
          onAcceptLine={handleAcceptLine}
          onRejectLine={handleRejectLine}
          onClose={() => setShowReview(false)}
        />
      )}

      <ActivityBar activeActivity={activeActivity} onSelect={setActiveActivity} />

      <aside 
        className="bg-zinc-50 border-r border-zinc-200 flex flex-col flex-shrink-0"
        style={{ width: leftPanelWidth }}
      >
        {/* ワークスペース切り替え */}
        <div className="p-2 border-b border-zinc-200">
          <WorkspaceSwitcher
            workspaces={currentWorkspaces}
            currentWorkspace={activeWorkspace}
            userEmail={userEmail}
            onSwitch={handleSwitchWorkspace}
            onCreateNew={() => setShowCreateWorkspace(true)}
          />
        </div>
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
          onSelect={setActiveNodeId}
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
        ) : (
          <PageHeader node={activeNode} isSaving={isSaving} />
        )}
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
        />
      </aside>
    </div>
  );
}

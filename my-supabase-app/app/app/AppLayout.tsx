"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback, useRef } from "react";
import { AiPanel, AiPanelHandle } from "@/components/AiPanel";
import { TabBar } from "@/components/TabBar";
import { PageHeader } from "@/components/PageHeader";
import { ActivityBar } from "@/components/ActivityBar";
import { MainEditor } from "@/components/MainEditor";
import { DiffView } from "@/components/DiffView";
import { CommandPalette } from "@/components/CommandPalette";

type Node = {
  id: string;
  project_id: string;
  parent_id: string | null;
  type: "file" | "folder";
  name: string;
  created_at: string;
};

type Props = {
  projectId: string;
};

type Activity = "explorer" | "search" | "git" | "ai" | "settings";

export default function AppLayout({ projectId }: Props) {
  const [nodes, setNodes] = useState<Node[]>([]);
  // タブ管理
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  
  // アクティビティバー管理
  const [activeActivity, setActiveActivity] = useState<Activity>("explorer");

  const [fileContent, setFileContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // DiffView管理
  const [diffState, setDiffState] = useState<{
    show: boolean;
    newCode: string;
  }>({ show: false, newCode: "" });

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

  // ファイルを開く処理
  const handleOpenNode = (nodeId: string) => {
    setOpenTabs((prev) =>
      prev.includes(nodeId) ? prev : [...prev, nodeId]
    );
    setActiveNodeId(nodeId);
    
    // エクスプローラーがアクティブでない場合はアクティブにする（任意）
    if (activeActivity !== "explorer") {
      setActiveActivity("explorer");
    }
  };

  // タブを閉じる処理
  const handleCloseTab = (id: string) => {
    setOpenTabs((prev) => prev.filter((x) => x !== id));
    
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

  // 選択したファイルの内容を取得
  useEffect(() => {
    if (!activeNodeId) {
      setFileContent("");
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

  // ファイル内容を保存
  const saveContent = useCallback(async () => {
    if (!activeNodeId) return;

    setIsSaving(true);
    const { error } = await supabase
      .from("file_contents")
      .update({ text: fileContent })
      .eq("node_id", activeNodeId);

    if (error) {
      console.error("Error saving content:", error);
    }
    setIsSaving(false);
  }, [activeNodeId, fileContent, supabase]);

  // AIアクションの実行
  const handleAiAction = (action: string) => {
    if (action === "save") {
      saveContent();
      return;
    }
    
    // AIパネルのアクションを呼び出す
    if (aiPanelRef.current) {
      aiPanelRef.current.triggerAction(action as any);
    }
  };

  // ツリー構造に変換
  const buildTree = (nodes: Node[], parentId: string | null = null): Node[] => {
    return nodes
      .filter((n) => n.parent_id === parentId)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  };

  // ツリーアイテムをレンダリング
  const renderTreeItem = (node: Node, depth: number = 0) => {
    const isSelected = node.id === activeNodeId;
    const isFile = node.type === "file";
    const children = buildTree(nodes, node.id);

    return (
      <div key={node.id}>
        <button
          onClick={() => isFile && handleOpenNode(node.id)}
          className={`w-full text-left px-2 py-1.5 text-sm flex items-center gap-2 hover:bg-zinc-800 rounded transition-colors ${
            isSelected ? "bg-zinc-700 text-white" : "text-zinc-300"
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <span className="text-zinc-500">{isFile ? "📄" : "📁"}</span>
          <span className="truncate">{node.name}</span>
        </button>
        {children.map((child) => renderTreeItem(child, depth + 1))}
      </div>
    );
  };

  // AIの結果をエディタに追記
  const handleAppend = (text: string) => {
    setFileContent((prev) => prev + "\n\n" + text);
  };

  // AIの結果でエディタを置き換え（Diff機能のApplyからも呼ばれる）
  const handleReplace = (text: string) => {
    setFileContent(text);
    // DiffViewを閉じる
    setDiffState({ show: false, newCode: "" });
  };

  // DiffViewのリクエスト処理
  const handleRequestDiff = (newCode: string) => {
    setDiffState({ show: true, newCode });
  };

  // ファイル作成完了時の処理
  const handleFileCreated = useCallback(() => {
    fetchNodes();
  }, [fetchNodes]);

  const rootNodes = buildTree(nodes, null);
  const activeNode = nodes.find((n) => n.id === activeNodeId) ?? null;

  const tabs = openTabs
    .map((id) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return null;
      return { id, title: node.name };
    })
    .filter((t): t is { id: string; title: string } => t !== null);

  if (isLoading && nodes.length === 0) {
    return (
      <div className="h-screen bg-zinc-950 text-zinc-300 flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  // サイドバーのコンテンツレンダリング
  const renderSidebarContent = () => {
    switch (activeActivity) {
      case "explorer":
        return (
          <>
            <div className="p-3 border-b border-zinc-800">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Explorer
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {rootNodes.length === 0 ? (
                <div className="text-zinc-500 text-sm p-2">No files yet</div>
              ) : (
                rootNodes.map((node) => renderTreeItem(node))
              )}
            </div>
          </>
        );
      case "search":
        return (
          <div className="p-4 text-zinc-500 text-sm">Search (Not implemented)</div>
        );
      case "git":
        return (
          <div className="p-4 text-zinc-500 text-sm">Git (Not implemented)</div>
        );
      case "ai":
        return (
          <div className="p-4 text-zinc-500 text-sm">AI Settings (Not implemented)</div>
        );
      case "settings":
        return (
          <div className="p-4 text-zinc-500 text-sm">Settings (Not implemented)</div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-screen bg-zinc-950 text-zinc-300 flex">
      {/* Command Palette */}
      <CommandPalette
        nodes={nodes}
        onSelectNode={handleOpenNode}
        onAction={handleAiAction}
      />

      {/* Diff View Modal */}
      {diffState.show && (
        <DiffView
          oldCode={fileContent}
          newCode={diffState.newCode}
          onApply={() => handleReplace(diffState.newCode)}
          onCancel={() => setDiffState({ show: false, newCode: "" })}
        />
      )}

      {/* 最左ツールバー (Activity Bar) */}
      <ActivityBar activeActivity={activeActivity} onSelect={setActiveActivity} />

      {/* 左サイドバー */}
      <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col flex-shrink-0">
        {renderSidebarContent()}
      </aside>

      {/* 中央：メインエリア */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        {/* タブバー */}
        <TabBar
          tabs={tabs}
          activeId={activeNodeId}
          onSelect={setActiveNodeId}
          onClose={handleCloseTab}
        />

        {/* ページヘッダー */}
        <PageHeader node={activeNode} isSaving={isSaving} />

        {/* エディタ本体 (Monaco Editor) */}
        <div className="flex-1 p-0 relative overflow-hidden">
          {activeNodeId && activeNode ? (
            <MainEditor
              value={fileContent}
              onChange={setFileContent}
              fileName={activeNode.name}
              onSave={saveContent}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
              <div className="text-center">
                <p className="mb-2">ファイルを選択して編集を開始</p>
                <p className="text-xs opacity-60">Cmd+S で保存</p>
              </div>
            </div>
          )}
        </div>

        {/* ステータスバー */}
        <div className="h-6 bg-zinc-900 border-t border-zinc-800 flex items-center px-4 text-xs text-zinc-500 justify-between">
          <span>{activeNode ? `${activeNode.name}` : "No file selected"}</span>
          <div className="flex gap-4">
            <span>Ln 1, Col 1</span>
            <span>UTF-8</span>
            <span>TypeScript React</span>
          </div>
        </div>
      </main>

      {/* 右サイドバー：AIパネル */}
      <aside className="w-80 border-l border-zinc-800 flex-shrink-0 bg-zinc-900">
        <AiPanel
          ref={aiPanelRef}
          currentFileText={fileContent}
          onAppend={handleAppend}
          onRequestDiff={handleRequestDiff}
          onFileCreated={handleFileCreated}
        />
      </aside>
    </div>
  );
}

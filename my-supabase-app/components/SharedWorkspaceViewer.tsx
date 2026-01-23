"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFileIcon, FileIcons } from "./fileIcons";

type Props = {
  workspaceId: string;
};

type Node = {
  id: string;
  name: string;
  type: "file" | "folder";
  parent_id: string | null;
  created_at: string;
};

type WorkspaceData = {
  workspace: {
    id: string;
    name: string;
    isPublic: boolean;
    createdAt: string;
  };
  nodes: Node[];
  isAuthenticated?: boolean;
};

export function SharedWorkspaceViewer({ workspaceId }: Props) {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<"not_found" | "access_denied" | "error">("error");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/public/workspace?workspaceId=${workspaceId}`);
        const result = await res.json();

        if (!res.ok) {
          if (res.status === 404) {
            setErrorType("not_found");
            setError(result.error || "ワークスペースが見つかりません");
          } else if (res.status === 403) {
            setErrorType("access_denied");
            setError(result.error || "アクセスが制限されています");
          } else {
            setErrorType("error");
            setError(result.error || "エラーが発生しました");
          }
          return;
        }

        // Check if we should redirect (user has full access)
        if (result.redirectTo) {
          router.push(result.redirectTo);
          return;
        }

        setData(result);
        setIsAuthenticated(result.isAuthenticated || false);

        // Auto-expand root folders
        const rootFolders = result.nodes
          .filter((n: Node) => n.type === "folder" && !n.parent_id)
          .map((n: Node) => n.id);
        setExpandedFolders(new Set(rootFolders));
      } catch (err: any) {
        setErrorType("error");
        setError(err.message || "エラーが発生しました");
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [workspaceId, router]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const renderNodes = (parentId: string | null, depth: number = 0): React.ReactNode[] => {
    if (!data) return [];

    const children = data.nodes.filter((n) => n.parent_id === parentId);

    return children.map((node) => {
      const Icon = node.type === "folder" ? FileIcons.Folder : getFileIcon(node.name);
      const isExpanded = expandedFolders.has(node.id);

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-100 cursor-pointer ${
              node.type === "folder" ? "font-medium" : ""
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => {
              if (node.type === "folder") {
                toggleFolder(node.id);
              } else {
                // Navigate to file share page
                window.location.href = `/share/${node.id}`;
              }
            }}
          >
            {node.type === "folder" && (
              <svg
                className={`w-3 h-3 text-zinc-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5l8 7-8 7V5z" />
              </svg>
            )}
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm text-zinc-700 truncate">{node.name}</span>
          </div>
          {node.type === "folder" && isExpanded && (
            <div>{renderNodes(node.id, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="flex items-center gap-3 text-zinc-500">
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
    );
  }

  if (errorType === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">ワークスペースが見つかりません</h1>
          <p className="text-zinc-500">このリンクは無効か、ワークスペースが削除された可能性があります。</p>
        </div>
      </div>
    );
  }

  if (errorType === "access_denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">アクセスが制限されています</h1>
          <p className="text-zinc-500 mb-4">このワークスペースを表示するにはログインが必要です。</p>
          <a
            href="/auth/login"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            ログイン
          </a>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">エラーが発生しました</h1>
          <p className="text-zinc-500">{error || "ワークスペースを読み込めませんでした。"}</p>
        </div>
      </div>
    );
  }

  const { workspace, nodes } = data;
  const rootNodes = nodes.filter((n) => !n.parent_id);
  const fileCount = nodes.filter((n) => n.type === "file").length;
  const folderCount = nodes.filter((n) => n.type === "folder").length;

  return (
    <div className="min-h-screen flex flex-col bg-zinc-100">
      {/* Sign up banner - only show for non-authenticated users */}
      {!isAuthenticated && (
        <div className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-zinc-600">
            あと少しです。今すぐサインアップして、Lovecatで作成を開始しましょう。
          </p>
          <a
            href="/auth/login"
            className="inline-flex items-center px-4 py-1.5 text-sm font-medium border border-zinc-300 rounded-md hover:bg-zinc-50 transition-colors"
          >
            サインアップまたはログイン
          </a>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-zinc-200">
            <div className="flex items-center gap-3">
              <FileIcons.Folder className="w-8 h-8 text-amber-500" />
              <div>
                <h1 className="text-xl font-semibold text-zinc-900">{workspace.name}</h1>
                <p className="text-sm text-zinc-500">
                  {folderCount} フォルダ, {fileCount} ファイル
                </p>
              </div>
            </div>
          </div>

          {/* File tree */}
          <div className="max-h-[calc(100vh-280px)] min-h-[300px] overflow-y-auto">
            {rootNodes.length === 0 ? (
              <div className="py-12 text-center text-zinc-500">
                <FileIcons.Folder className="w-12 h-12 mx-auto mb-3 text-zinc-300" />
                <p>このワークスペースは空です。</p>
              </div>
            ) : (
              <div className="py-2">{renderNodes(null)}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { SharePopover } from "./SharePopover";

type Node = {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
};

type Props = {
  node: Node | null;
  isSaving?: boolean;
};

export function PageHeader({ node, isSaving = false }: Props) {
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  // 初期設定のロード
  useEffect(() => {
    if (node) {
      fetch(`/api/share?nodeId=${node.id}`)
        .then(res => res.json())
        .then(data => {
          setIsPublic(data.isPublic);
        })
        .catch(console.error);
    }
  }, [node]);

  const handleTogglePublic = async (newIsPublic: boolean) => {
    setIsPublic(newIsPublic);
    // API呼び出し
    if (node) {
      await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_public", nodeId: node.id, isPublic: newIsPublic }),
      });
    }
  };

  if (!node) {
    return (
      <div className="h-[73px] px-6 flex items-center border-b border-zinc-200 bg-zinc-50 text-sm text-zinc-400">
        ファイルを選択するとここに詳細が表示されます
      </div>
    );
  }

  return (
    <div className="px-6 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
      <div>
        <div className="text-xs text-zinc-500 mb-0.5">Page</div>
        <div className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
          {node.name}
          {isSaving && (
            <span className="text-xs font-normal text-zinc-500 animate-pulse">
              Saving...
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <div className="flex flex-col items-end gap-0.5">
          <span>Created: {new Date(node.created_at).toLocaleDateString()}</span>
          <span>Model: Gemini 2.0 Flash</span>
        </div>
        
        <div className="relative">
          <button
            onClick={() => setIsShareOpen(!isShareOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 bg-white border border-zinc-200 rounded hover:bg-zinc-50 transition-colors"
          >
            Share
            {isPublic && <span className="w-2 h-2 rounded-full bg-blue-500" />}
          </button>

          <SharePopover
            isOpen={isShareOpen}
            onClose={() => setIsShareOpen(false)}
            nodeName={node.name}
            nodeId={node.id}
            isPublic={isPublic}
            onTogglePublic={handleTogglePublic}
          />
        </div>
      </div>
    </div>
  );
}

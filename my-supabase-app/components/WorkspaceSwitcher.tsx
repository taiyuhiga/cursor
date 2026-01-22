"use client";

import { useState, useRef, useEffect } from "react";
import { ContextMenu } from "./ContextMenu";

type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  role: string;
};

type ContextMenuState = {
  isOpen: boolean;
  x: number;
  y: number;
  workspaceId: string;
  workspaceName: string;
} | null;

type Props = {
  workspaces: Workspace[];
  currentWorkspace: Workspace;
  userEmail: string;
  onSwitch: (workspaceId: string) => void;
  onCreateNew: () => void;
  onRename?: (workspaceId: string, currentName: string) => void;
  onDelete?: (workspaceId: string, workspaceName: string) => void;
  onShare?: (workspaceId: string) => void;
};

export function WorkspaceSwitcher({
  workspaces,
  currentWorkspace,
  userEmail,
  onSwitch,
  onCreateNew,
  onRename,
  onDelete,
  onShare,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ワークスペースの頭文字を取得
  const getInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  // 右クリックハンドラー
  const handleContextMenu = (e: React.MouseEvent, workspace: Workspace) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    });
  };

  // コンテキストメニューを閉じる
  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // コンテキストメニューのアイテム
  const getContextMenuItems = () => {
    if (!contextMenu) return [];
    return [
      {
        label: "共有",
        action: () => {
          onShare?.(contextMenu.workspaceId);
        },
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        ),
      },
      {
        label: "ワークスペース名を変更",
        action: () => {
          onRename?.(contextMenu.workspaceId, contextMenu.workspaceName);
        },
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "ワークスペースを削除",
        action: () => {
          onDelete?.(contextMenu.workspaceId, contextMenu.workspaceName);
        },
        danger: true,
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        ),
      },
    ];
  };

  // 自分のワークスペースとチームワークスペースを分ける
  const myWorkspaces = workspaces.filter((w) => w.role === "owner");
  const teamWorkspaces = workspaces.filter((w) => w.role !== "owner");

  return (
    <div className="relative" ref={dropdownRef}>
      {/* トリガーボタン */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 rounded-lg transition-colors w-full"
      >
        {/* ワークスペースアイコン */}
        <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
          {getInitial(currentWorkspace.name)}
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-medium text-zinc-800 truncate">
            {currentWorkspace.name}
          </div>
        </div>
        {/* 矢印 */}
        <svg
          className={`w-4 h-4 text-zinc-400 transition-all ${isOpen ? "rotate-180 opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ドロップダウンメニュー */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* ヘッダー */}
          <div className="p-3 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-sm font-bold">
                {getInitial(currentWorkspace.name)}
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-800">
                  {currentWorkspace.name}
                </div>
                <div className="text-xs text-zinc-500">
                  {currentWorkspace.role === "owner" ? "オーナー" : "メンバー"}
                </div>
              </div>
            </div>
          </div>

          {/* タブ */}
          <div className="flex border-b border-zinc-100 px-3 pt-2">
            <button className="px-3 py-1.5 text-xs font-medium text-zinc-900 border-b-2 border-zinc-900">
              設定
            </button>
            <button className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-600">
              ユーザー
            </button>
          </div>

          {/* ユーザー情報 */}
          <div className="p-2 border-b border-zinc-100">
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-600">
              <span className="text-zinc-400">📧</span>
              <span className="truncate">{userEmail}</span>
            </div>
          </div>

          {/* マイワークスペース */}
          {myWorkspaces.length > 0 && (
            <div className="p-2">
              <div className="px-2 py-1 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                プライベート
              </div>
              {myWorkspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    onSwitch(ws.id);
                    setIsOpen(false);
                  }}
                  onContextMenu={(e) => handleContextMenu(e, ws)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${
                    ws.id === currentWorkspace.id
                      ? "bg-blue-50 text-blue-700"
                      : "hover:bg-zinc-100 text-zinc-700"
                  }`}
                >
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-zinc-400 to-zinc-600 flex items-center justify-center text-white text-[10px] font-bold">
                    {getInitial(ws.name)}
                  </div>
                  <span className="text-sm truncate">{ws.name}</span>
                  {ws.id === currentWorkspace.id && (
                    <svg className="w-4 h-4 ml-auto text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* チームワークスペース */}
          {teamWorkspaces.length > 0 && (
            <div className="p-2 border-t border-zinc-100">
              <div className="px-2 py-1 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                チーム
              </div>
              {teamWorkspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    onSwitch(ws.id);
                    setIsOpen(false);
                  }}
                  onContextMenu={(e) => handleContextMenu(e, ws)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${
                    ws.id === currentWorkspace.id
                      ? "bg-blue-50 text-blue-700"
                      : "hover:bg-zinc-100 text-zinc-700"
                  }`}
                >
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white text-[10px] font-bold">
                    {getInitial(ws.name)}
                  </div>
                  <span className="text-sm truncate">{ws.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded ml-1">
                    ゲスト
                  </span>
                  {ws.id === currentWorkspace.id && (
                    <svg className="w-4 h-4 ml-auto text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 新規ワークスペース作成 */}
          <div className="p-2 border-t border-zinc-100">
            <button
              onClick={() => {
                onCreateNew();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <span className="text-lg">+</span>
              <span>新しいワークスペース</span>
            </button>
          </div>

          {/* フッター */}
          <div className="p-2 border-t border-zinc-100 bg-zinc-50">
            <button className="w-full text-left px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors">
              すべてのアカウントからログアウト
            </button>
          </div>
        </div>
      )}

      {/* コンテキストメニュー */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}





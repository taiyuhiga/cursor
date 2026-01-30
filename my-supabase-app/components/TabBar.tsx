import { useEffect, useRef, useState } from "react";

import { getFileIcon, FileIcons } from "./fileIcons";

type Tab = {
  id: string;
  title: string;
  type?: "file" | "folder";
};

type TabBarProps = {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onShare?: () => void;
  onDownload?: () => void;
  onDuplicate?: () => void;
  isSharedFile?: boolean;
  dirtyIds?: Set<string>;
};

export function TabBar({ tabs, activeId, onSelect, onClose, onShare, onDownload, onDuplicate, isSharedFile, dirtyIds }: TabBarProps) {
  const [actionTooltip, setActionTooltip] = useState<"share" | "download" | null>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const handleTabDragStart = (e: React.DragEvent<HTMLDivElement>, tab: Tab) => {
    const dragData = [{ id: tab.id, name: tab.title, type: "file" as const }];
    e.dataTransfer.setData("application/cursor-node-data", JSON.stringify(dragData));
    e.dataTransfer.setData("application/cursor-node", tab.title);
    e.dataTransfer.setData("text/plain", `@${tab.title}`);
    e.dataTransfer.effectAllowed = "copy";
  };

  useEffect(() => {
    if (!activeId) return;
    const container = tabsContainerRef.current;
    if (!container) return;
    const tabEl = container.querySelector(`[data-tab-id="${activeId}"]`) as HTMLElement | null;
    if (!tabEl) return;
    tabEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);
  return (
    <div className="relative z-20 flex h-9 border-b border-zinc-200 bg-zinc-50 text-sm">
      {/* タブ部分 */}
      <div ref={tabsContainerRef} className="flex overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const isDirty = dirtyIds?.has(tab.id);
          const FileIcon = tab.type === "folder" ? FileIcons.Folder : getFileIcon(tab.title);
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              draggable
              onDragStart={(e) => handleTabDragStart(e, tab)}
              className={`
                group flex flex-none items-center gap-2 px-3 border-r border-zinc-200 min-w-[120px] cursor-pointer select-none relative
                ${
                  isActive
                    ? "bg-white text-zinc-900"
                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-100/80"
                }
              `}
              onClick={() => onSelect(tab.id)}
            >
              {/* アクティブ時の上部ボーダー */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" />
              )}

              <FileIcon className="w-4 h-4 flex-shrink-0" />

              <span className="whitespace-nowrap text-xs">{tab.title}</span>

              <span
                className={`text-blue-500 text-[40px] leading-none ml-0.5 ${isDirty ? "opacity-100" : "opacity-0"}`}
                aria-hidden="true"
              >
                •
              </span>

              <span
                className={`
                  rounded p-0.5 hover:bg-zinc-200 transition-all
                  ${isActive ? "opacity-100 text-zinc-500 hover:text-zinc-700" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600"}
                `}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </span>
            </div>
          );
        })}
      </div>

      {/* スペーサー */}
      <div className="flex-1" />

      {/* 右側のアクションボタン */}
      <div className="flex items-center gap-1 px-2 border-l border-zinc-200 flex-shrink-0">
        {/* 複製ボタン - 共有ファイル閲覧時のみ表示 */}
        {isSharedFile && (
          <button
            onClick={() => {
              onDuplicate?.();
            }}
            className="flex items-center justify-center px-2 py-0.5 rounded hover:bg-zinc-200 text-zinc-500 hover:text-zinc-700 transition-colors"
            aria-label="複製"
          >
            <span className="text-[14px] whitespace-nowrap">複製</span>
          </button>
        )}

        {/* 共有ボタン - 共有ファイル閲覧時は非表示 */}
        {!isSharedFile && (
          <button
            onClick={() => {
              onShare?.();
            }}
            className="flex items-center justify-center px-2 py-0.5 rounded hover:bg-zinc-200 text-zinc-500 hover:text-zinc-700 transition-colors"
            aria-label="共有"
          >
            <span className="text-[14px] whitespace-nowrap">共有</span>
          </button>
        )}

        {/* ダウンロードボタン */}
        <button
          onClick={() => {
            setActionTooltip(null);
            onDownload?.();
          }}
          onMouseEnter={() => setActionTooltip("download")}
          onMouseLeave={() => setActionTooltip(null)}
          className="relative p-1.5 rounded hover:bg-zinc-200 text-zinc-500 hover:text-zinc-700 transition-colors"
          aria-label="ダウンロード"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span
            className={`pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 text-white text-[10px] px-2 py-1 transition-opacity z-50 ${
              actionTooltip === "download" ? "opacity-100" : "opacity-0"
            }`}
          >
            ダウンロード
          </span>
        </button>
      </div>
    </div>
  );
}

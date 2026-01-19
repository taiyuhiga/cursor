import { useState } from "react";

import { getFileIcon } from "./fileIcons";

type Tab = {
  id: string;
  title: string;
};

type TabBarProps = {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onShare?: () => void;
  onDownload?: () => void;
};

export function TabBar({ tabs, activeId, onSelect, onClose, onShare, onDownload }: TabBarProps) {
  const [actionTooltip, setActionTooltip] = useState<"share" | "download" | null>(null);
  return (
    <div className="relative z-20 flex h-9 border-b border-zinc-200 bg-zinc-50 text-sm">
      {/* タブ部分 */}
      <div className="flex overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const FileIcon = getFileIcon(tab.title);
          return (
            <div
              key={tab.id}
              className={`
                group flex items-center gap-2 px-3 border-r border-zinc-200 min-w-[120px] max-w-[200px] cursor-pointer select-none relative
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

              <span className="truncate flex-1 text-xs">{tab.title}</span>

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
      <div className="flex items-center gap-1 px-2 border-l border-zinc-200">
        {/* 共有ボタン */}
        <button
          onClick={() => {
            setActionTooltip(null);
            onShare?.();
          }}
          onMouseEnter={() => setActionTooltip("share")}
          onMouseLeave={() => setActionTooltip(null)}
          className="relative p-1.5 rounded hover:bg-zinc-200 text-zinc-500 hover:text-zinc-700 transition-colors"
          aria-label="共有"
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
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span
            className={`pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 text-white text-[10px] px-2 py-1 transition-opacity z-50 ${
              actionTooltip === "share" ? "opacity-100" : "opacity-0"
            }`}
          >
            共有
          </span>
        </button>

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

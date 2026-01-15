"use client";

import { useEffect, useRef } from "react";

type Props = {
  isOpen: boolean;
  fileName: string;
  isFolder?: boolean;
  onReplace: () => void;
  onCancel: () => void;
};

export function ReplaceConfirmDialog({
  isOpen,
  fileName,
  isFolder = false,
  onReplace,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onReplace();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel, onReplace]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        className="bg-white border border-zinc-200 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 text-center">
          {/* Warning icon with folder/file icon */}
          <div className="flex items-center justify-center mb-4">
            <div className="relative">
              {/* Warning triangle */}
              <svg
                className="w-12 h-12 text-amber-400"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2L1 21h22L12 2zm0 3.5L19.5 19h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
              </svg>
              {/* Folder/File icon overlay */}
              <div className="absolute -bottom-1 -right-1 bg-zinc-600 rounded p-1">
                {isFolder ? (
                  <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </div>
          </div>

          {/* Message */}
          <p className="text-sm text-zinc-700 leading-relaxed mb-2">
            <span className="font-medium">'{fileName}'</span> という名前の
            {isFolder ? "フォルダー" : "ファイルまたはフォルダー"}
            は、宛先のフォルダーに既に存在します。置き換えますか?
          </p>
          <p className="text-xs text-zinc-500">
            この操作は元に戻せません。
          </p>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-zinc-100">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={onReplace}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg shadow-sm transition-colors"
          >
            置換
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

type Props = {
  isOpen: boolean;
  names: string[];
  itemType: "file" | "folder" | "mixed";
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteConfirmDialog({
  isOpen,
  names,
  itemType,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen) return null;

  const isSingle = names.length === 1;
  const count = names.length;

  // Build message based on count and type
  const getMessage = () => {
    if (isSingle) {
      if (itemType === "folder") {
        return (
          <p className="text-sm text-zinc-700 leading-relaxed mb-2">
            <span className="font-medium">&apos;{names[0]}&apos;</span> とその内容を削除しますか?
          </p>
        );
      } else {
        return (
          <p className="text-sm text-zinc-700 leading-relaxed mb-2">
            <span className="font-medium">&apos;{names[0]}&apos;</span> を削除しますか?
          </p>
        );
      }
    } else {
      // Multiple items
      let title: string;
      if (itemType === "folder") {
        title = `次の ${count} ディレクトリとその内容を削除しますか?`;
      } else if (itemType === "file") {
        title = `次の ${count} 個のファイルを削除してもよろしいですか?`;
      } else {
        // mixed
        title = `次の ${count} ファイル/ディレクトリとその内容を削除しますか?`;
      }

      return (
        <>
          <p className="text-sm font-medium text-zinc-700 leading-relaxed mb-3">
            {title}
          </p>
          <div className="text-sm text-zinc-500 space-y-0.5 mb-2">
            {names.map((name, index) => (
              <p key={index}>{name}</p>
            ))}
          </div>
        </>
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        className="bg-white border border-zinc-200 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 text-center">
          {/* Trash icon */}
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
              {/* Trash icon overlay */}
              <div className="absolute -bottom-1 -right-1 bg-zinc-600 rounded p-1">
                <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </div>

          {/* Message */}
          {getMessage()}
          <p className="text-xs text-zinc-500">
            この操作は元に戻せません。
          </p>
        </div>

        {/* Buttons - horizontal layout like the reference */}
        <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-zinc-100">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg shadow-sm transition-colors"
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}

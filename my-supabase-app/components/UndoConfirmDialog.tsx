"use client";

import { useEffect, useRef } from "react";

type Props = {
  isOpen: boolean;
  actionName: string;
  actionType: "create" | "copy" | "upload";
  onConfirm: () => void;
  onCancel: () => void;
};

export function UndoConfirmDialog({
  isOpen,
  actionName,
  actionType,
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

  const getActionLabel = () => {
    switch (actionType) {
      case "create":
        return "の作成";
      case "copy":
        return "の貼り付け";
      case "upload":
        return "のインポート";
      default:
        return "";
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        className="bg-white border border-zinc-200 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 text-center">
          {/* Undo icon */}
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-b from-zinc-600 to-zinc-700 rounded-2xl flex items-center justify-center shadow-lg">
              <svg
                className="w-9 h-9 text-white"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
              </svg>
            </div>
          </div>

          {/* Message */}
          <p className="text-sm font-medium text-zinc-700 leading-relaxed">
            &apos;{actionName}{getActionLabel()}&apos;
          </p>
          <p className="text-sm text-zinc-700">
            を元に戻しますか?
          </p>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-zinc-100">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
          >
            いいえ
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg shadow-sm transition-colors"
          >
            はい
          </button>
        </div>
      </div>
    </div>
  );
}

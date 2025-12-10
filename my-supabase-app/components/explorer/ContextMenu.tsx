"use client";

import { useEffect, useRef } from "react";

type Position = { x: number; y: number };

type Props = {
  position: Position;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  targetType: "file" | "folder" | "root";
};

export function ContextMenu({
  position,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  targetType,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 w-48 bg-zinc-800 border border-zinc-700 rounded shadow-xl text-sm text-zinc-200 py-1"
      style={{ top: position.y, left: position.x }}
    >
      {(targetType === "folder" || targetType === "root") && (
        <>
          <button
            className="w-full text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white"
            onClick={() => {
              onNewFile();
              onClose();
            }}
          >
            New File
          </button>
          <button
            className="w-full text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white border-b border-zinc-700 mb-1 pb-2"
            onClick={() => {
              onNewFolder();
              onClose();
            }}
          >
            New Folder
          </button>
        </>
      )}

      {targetType !== "root" && (
        <>
          <button
            className="w-full text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white"
            onClick={() => {
              onRename();
              onClose();
            }}
          >
            Rename...
          </button>
          <button
            className="w-full text-left px-4 py-1.5 hover:bg-red-600 hover:text-white text-red-400"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}


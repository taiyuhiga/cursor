"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

interface FolderPageViewProps {
  folderId: string;
  folderName: string;
  onRename: (newName: string) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function FolderPageView({
  folderId,
  folderName,
  onRename,
  onDirtyChange,
}: FolderPageViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(folderName);
  const inputRef = useRef<HTMLInputElement>(null);
  const editValueRef = useRef(editValue);
  const folderNameRef = useRef(folderName);

  useEffect(() => {
    editValueRef.current = editValue;
  }, [editValue]);

  useEffect(() => {
    folderNameRef.current = folderName;
  }, [folderName]);

  useEffect(() => {
    setEditValue(folderName);
  }, [folderName]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Notify dirty state
  useEffect(() => {
    const isDirty = editValue.trim() !== folderName;
    onDirtyChange?.(isDirty);
  }, [editValue, folderName, onDirtyChange]);

  const handleSave = useCallback(() => {
    const trimmed = editValueRef.current.trim();
    if (trimmed && trimmed !== folderNameRef.current) {
      // Fire and forget - handleRenameNode does optimistic update so UI reflects immediately
      onRename(trimmed).catch((error) => {
        console.error("Failed to rename folder:", error);
      });
    } else {
      setEditValue(folderNameRef.current);
    }
    setIsEditing(false);
  }, [onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        setEditValue(folderNameRef.current);
        setIsEditing(false);
      }
    },
    [handleSave]
  );

  // Global Cmd+S handler
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        const activeElement = document.activeElement;
        if (activeElement === inputRef.current) {
          return;
        }

        const trimmed = editValueRef.current.trim();
        if (trimmed && trimmed !== folderNameRef.current) {
          e.preventDefault();
          handleSave();
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [handleSave]);

  return (
    <div className="h-full w-full flex flex-col items-center pt-24 px-8 overflow-auto bg-white">
      <div className="w-full max-w-3xl">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full text-4xl font-bold text-zinc-900 bg-transparent border-none outline-none placeholder-zinc-300 focus:ring-0"
            placeholder="Untitled"
          />
        ) : (
          <h1
            onClick={() => setIsEditing(true)}
            className="text-4xl font-bold text-zinc-900 cursor-text hover:bg-zinc-50 rounded px-1 -mx-1 transition-colors"
          >
            {folderName || "Untitled"}
          </h1>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { getFileIcon, FileIcons } from "./fileIcons";

// ── Block types ──

type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "numberedList"
  | "todo"
  | "toggleList"
  | "callout"
  | "quote"
  | "code"
  | "divider"
  | "image"
  | "video"
  | "audio"
  | "file";

type Block = {
  id: string;
  type: BlockType;
  content: string;
  checked?: boolean; // for todo
  open?: boolean; // for toggleList
  mediaNodeId?: string; // persistent: uploaded file node ID
  mediaName?: string; // persistent: original filename
  mediaUrl?: string; // transient: signed URL (strip before save)
  mediaStatus?: "uploading" | "ready" | "error"; // transient (strip before save)
};

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function createBlock(type: BlockType, content = ""): Block {
  return {
    id: genId(),
    type,
    content,
    ...(type === "todo" ? { checked: false } : {}),
    ...(type === "toggleList" ? { open: true } : {}),
  };
}

// ── ChildNode type ──

type ChildNode = {
  id: string;
  name: string;
  type: "file" | "folder";
};

// ── Slash menu types ──

type SlashMenuCategory = {
  label: string;
  items: SlashMenuItem[];
};

type SlashMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  blockType?: BlockType;
  action?: () => void; // for non-block actions (new file, new folder, upload)
};

// ── Props ──

export interface FolderPageViewProps {
  folderId: string;
  folderName: string;
  onRename: (newName: string) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
  childNodes?: ChildNode[];
  onOpenNode?: (id: string) => void;
  onCreateFile?: (parentId: string | null) => void;
  onCreateFolder?: (parentId: string | null) => void;
  onUploadFiles?: (parentId: string | null) => void;
  parentId?: string | null;
  initialBlocks?: Block[];
  onSaveBlocks?: (blocks: Block[]) => void;
  onUploadMedia?: (accept: string, parentId: string | null) => Promise<{ nodeId: string; fileName: string } | null>;
  onGetMediaUrl?: (nodeId: string) => Promise<string | null>;
}

// ── Single block editor ──

function BlockItem({
  block,
  onChange,
  onDelete,
  onInsertAfter,
  onFocus,
  focusRef,
  onMergeWithPrevious,
}: {
  block: Block;
  onChange: (b: Block) => void;
  onDelete: () => void;
  onInsertAfter: (type?: BlockType) => void;
  onFocus: () => void;
  focusRef: React.RefObject<HTMLElement | null>;
  onMergeWithPrevious: (trailingContent: string) => void;
}) {
  const elRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef(block.content);

  useEffect(() => {
    contentRef.current = block.content;
  }, [block.content]);

  // Sync focusRef
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      elRef.current = node;
      (focusRef as React.MutableRefObject<HTMLElement | null>).current = node;
    },
    [focusRef]
  );

  // Sync contentEditable text with block.content from outside
  useEffect(() => {
    const el = elRef.current;
    if (el && document.activeElement !== el) {
      if (el.textContent !== block.content) {
        el.textContent = block.content;
      }
    }
  }, [block.content]);

  const handleInput = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const text = el.textContent || "";
    contentRef.current = text;
    onChange({ ...block, content: text });
  }, [block, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        // For code blocks, allow Enter normally
        if (block.type === "code") return;
        e.preventDefault();
        onInsertAfter();
      }
      if (e.key === "Backspace" && contentRef.current === "") {
        e.preventDefault();
        if (block.type !== "paragraph") {
          // Convert to paragraph instead of deleting
          onChange({ ...block, type: "paragraph" });
        } else {
          onMergeWithPrevious("");
        }
      }
      // Detect / at start of empty block
      if (e.key === "/" && contentRef.current === "") {
        // Let it type, we handle in onInput
      }
    },
    [block, onChange, onInsertAfter, onMergeWithPrevious]
  );

  const commonProps = {
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onFocus,
    suppressContentEditableWarning: true,
  };

  // ── Render by type ──

  // Media blocks (not contentEditable)
  if (block.type === "image") {
    return (
      <div className="py-2 group relative">
        {block.mediaStatus === "uploading" ? (
          <div className="h-48 bg-zinc-100 rounded-lg flex items-center justify-center animate-pulse">
            <span className="text-zinc-400 text-sm">アップロード中...</span>
          </div>
        ) : block.mediaUrl ? (
          <img
            src={block.mediaUrl}
            alt={block.mediaName || ""}
            className="max-w-full rounded-lg"
            onError={() => {
              onChange({ ...block, mediaUrl: undefined });
            }}
          />
        ) : block.mediaNodeId ? (
          <div className="h-48 bg-zinc-50 rounded-lg flex items-center justify-center border border-zinc-200 animate-pulse">
            <span className="text-zinc-400 text-sm">画像を読み込み中...</span>
          </div>
        ) : (
          <div className="h-48 bg-zinc-50 rounded-lg flex items-center justify-center border border-zinc-200">
            <span className="text-zinc-400 text-sm">画像が見つかりません</span>
          </div>
        )}
        <button
          onClick={onDelete}
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-opacity"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "video") {
    return (
      <div className="py-2 group relative">
        {block.mediaStatus === "uploading" ? (
          <div className="h-48 bg-zinc-100 rounded-lg flex items-center justify-center animate-pulse">
            <span className="text-zinc-400 text-sm">アップロード中...</span>
          </div>
        ) : block.mediaUrl ? (
          <video
            src={block.mediaUrl}
            controls
            className="max-w-full rounded-lg"
            onError={() => {
              onChange({ ...block, mediaUrl: undefined });
            }}
          />
        ) : block.mediaNodeId ? (
          <div className="h-48 bg-zinc-50 rounded-lg flex items-center justify-center border border-zinc-200 animate-pulse">
            <span className="text-zinc-400 text-sm">動画を読み込み中...</span>
          </div>
        ) : (
          <div className="h-48 bg-zinc-50 rounded-lg flex items-center justify-center border border-zinc-200">
            <span className="text-zinc-400 text-sm">動画が見つかりません</span>
          </div>
        )}
        <button
          onClick={onDelete}
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-opacity"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "audio") {
    return (
      <div className="py-2 group relative">
        {block.mediaStatus === "uploading" ? (
          <div className="h-16 bg-zinc-100 rounded-lg flex items-center justify-center animate-pulse">
            <span className="text-zinc-400 text-sm">アップロード中...</span>
          </div>
        ) : block.mediaUrl ? (
          <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
            <audio
              src={block.mediaUrl}
              controls
              className="flex-1"
              onError={() => {
                onChange({ ...block, mediaUrl: undefined });
              }}
            />
            <span className="text-xs text-zinc-500 truncate max-w-[150px]">{block.mediaName}</span>
          </div>
        ) : block.mediaNodeId ? (
          <div className="h-16 bg-zinc-50 rounded-lg flex items-center justify-center border border-zinc-200 animate-pulse">
            <span className="text-zinc-400 text-sm">オーディオを読み込み中...</span>
          </div>
        ) : (
          <div className="h-16 bg-zinc-50 rounded-lg flex items-center justify-center border border-zinc-200">
            <span className="text-zinc-400 text-sm">オーディオが見つかりません</span>
          </div>
        )}
        <button
          onClick={onDelete}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-opacity"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "file") {
    return (
      <div className="py-1 group relative">
        {block.mediaStatus === "uploading" ? (
          <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200 animate-pulse">
            <span className="text-zinc-400 text-sm">アップロード中...</span>
          </div>
        ) : (
          <a
            href={block.mediaUrl || "#"}
            download={block.mediaName}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200 hover:bg-zinc-100 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-5 h-5 text-zinc-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 7.5l-5.2 5.2a3 3 0 0 1-4.2-4.2l5.2-5.2a2 2 0 0 1 2.8 2.8l-5.2 5.2a1 1 0 0 1-1.4-1.4l4.5-4.5" />
            </svg>
            <span className="text-sm text-zinc-700 truncate">{block.mediaName || "ファイル"}</span>
            {!block.mediaUrl && block.mediaNodeId && (
              <span className="text-xs text-zinc-400 ml-auto">読み込み中...</span>
            )}
          </a>
        )}
        <button
          onClick={(e) => { e.preventDefault(); onDelete(); }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-opacity"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "divider") {
    return (
      <div className="py-3 group relative">
        <hr className="border-zinc-200" />
        <button
          onClick={onDelete}
          className="absolute right-0 top-1 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 text-xs transition-opacity"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "todo") {
    return (
      <div className="flex items-start gap-2 py-0.5 group">
        <input
          type="checkbox"
          checked={block.checked ?? false}
          onChange={(e) => onChange({ ...block, checked: e.target.checked })}
          className="mt-1 rounded border-zinc-300"
        />
        <div
          ref={setRef}
          contentEditable
          data-placeholder="ToDo"
          className={`flex-1 outline-none text-[15px] leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300 ${
            block.checked ? "line-through text-zinc-400" : "text-zinc-900"
          }`}
          {...commonProps}
        />
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 text-xs transition-opacity mt-1"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "bulletList") {
    return (
      <div className="flex items-start gap-2 py-0.5 group pl-1">
        <span className="text-zinc-500 mt-0.5 select-none">&bull;</span>
        <div
          ref={setRef}
          contentEditable
          data-placeholder="リスト"
          className="flex-1 outline-none text-[15px] leading-relaxed text-zinc-900 empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300"
          {...commonProps}
        />
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 text-xs transition-opacity mt-1"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "numberedList") {
    return (
      <div className="flex items-start gap-2 py-0.5 group pl-1">
        <span className="text-zinc-500 mt-0 select-none text-[15px] min-w-[1.2em] text-right">{/* Number set from parent via data attr */}</span>
        <div
          ref={setRef}
          contentEditable
          data-placeholder="リスト"
          className="flex-1 outline-none text-[15px] leading-relaxed text-zinc-900 empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300"
          {...commonProps}
        />
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 text-xs transition-opacity mt-1"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "toggleList") {
    return (
      <div className="py-0.5 group">
        <div className="flex items-start gap-1">
          <button
            onClick={() => onChange({ ...block, open: !block.open })}
            className="mt-0.5 text-zinc-500 hover:text-zinc-700 transition-transform select-none"
            style={{ transform: block.open ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4" /></svg>
          </button>
          <div
            ref={setRef}
            contentEditable
            data-placeholder="トグル"
            className="flex-1 outline-none text-[15px] leading-relaxed text-zinc-900 font-medium empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300"
            {...commonProps}
          />
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 text-xs transition-opacity mt-1"
          >
            &times;
          </button>
        </div>
        {block.open && (
          <div className="ml-6 mt-1 text-sm text-zinc-400 border-l-2 border-zinc-100 pl-3">
            空のトグル
          </div>
        )}
      </div>
    );
  }

  if (block.type === "callout") {
    return (
      <div className="flex items-start gap-3 bg-zinc-50 border border-zinc-200 rounded-lg p-3 my-1 group">
        <span className="text-lg select-none">💡</span>
        <div
          ref={setRef}
          contentEditable
          data-placeholder="コールアウト"
          className="flex-1 outline-none text-[15px] leading-relaxed text-zinc-900 empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300"
          {...commonProps}
        />
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 text-xs transition-opacity"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "quote") {
    return (
      <div className="border-l-[3px] border-zinc-900 pl-4 py-0.5 my-1 group flex items-start">
        <div
          ref={setRef}
          contentEditable
          data-placeholder="引用"
          className="flex-1 outline-none text-[15px] leading-relaxed text-zinc-700 italic empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300 empty:before:not-italic"
          {...commonProps}
        />
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 text-xs transition-opacity"
        >
          &times;
        </button>
      </div>
    );
  }

  if (block.type === "code") {
    return (
      <div className="my-1 group relative">
        <pre className="bg-zinc-900 text-zinc-100 rounded-lg p-4 overflow-x-auto">
          <code
            ref={setRef}
            contentEditable
            data-placeholder="コード"
            className="outline-none text-sm font-mono whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-500"
            {...commonProps}
            onKeyDown={(e) => {
              // Allow Enter in code blocks
              if (e.key === "Backspace" && contentRef.current === "") {
                e.preventDefault();
                onDelete();
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                // Let parent handle
              }
            }}
          />
        </pre>
        <button
          onClick={onDelete}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 text-xs transition-opacity"
        >
          &times;
        </button>
      </div>
    );
  }

  // heading / paragraph
  const headingClass: Record<string, string> = {
    heading1: "text-3xl font-bold text-zinc-900",
    heading2: "text-2xl font-semibold text-zinc-900",
    heading3: "text-xl font-semibold text-zinc-900",
    paragraph: "text-[15px] text-zinc-900 leading-relaxed",
  };

  const placeholder: Record<string, string> = {
    heading1: "見出し 1",
    heading2: "見出し 2",
    heading3: "見出し 3",
    paragraph: "テキストを入力するか、「/」でコマンドを選択...",
  };

  return (
    <div className="py-0.5 group flex items-start">
      <div
        ref={setRef}
        contentEditable
        data-placeholder={placeholder[block.type] ?? ""}
        className={`flex-1 outline-none ${headingClass[block.type] ?? headingClass.paragraph} empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300`}
        {...commonProps}
      />
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 text-xs transition-opacity mt-1 ml-1"
      >
        &times;
      </button>
    </div>
  );
}

// ── Main component ──

export function FolderPageView({
  folderId,
  folderName,
  onRename,
  onDirtyChange,
  childNodes = [],
  onOpenNode,
  onCreateFile,
  onCreateFolder,
  onUploadFiles,
  parentId,
  initialBlocks,
  onSaveBlocks,
  onUploadMedia,
  onGetMediaUrl,
}: FolderPageViewProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Title editing ──
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(folderName);
  const inputRef = useRef<HTMLInputElement>(null);
  const editValueRef = useRef(editValue);
  const folderNameRef = useRef(folderName);

  // ── Block state ──
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks ?? []);
  const blocksRef = useRef(blocks);
  const initialBlocksJson = useRef(JSON.stringify(initialBlocks ?? []));
  const focusBlockId = useRef<string | null>(null);
  const blockRefs = useRef<Map<string, HTMLElement | null>>(new Map());

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  // Sync initialBlocks when folderId changes
  useEffect(() => {
    const newBlocks = initialBlocks ?? [];
    setBlocks(newBlocks);
    initialBlocksJson.current = JSON.stringify(newBlocks);
  }, [folderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus block after state update
  useEffect(() => {
    if (focusBlockId.current) {
      const el = blockRefs.current.get(focusBlockId.current);
      if (el) {
        el.focus();
        // Place cursor at end
        const range = document.createRange();
        const sel = window.getSelection();
        if (el.childNodes.length > 0) {
          range.selectNodeContents(el);
          range.collapse(false);
        } else {
          range.setStart(el, 0);
          range.collapse(true);
        }
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      focusBlockId.current = null;
    }
  }, [blocks]);

  // ── Slash command menu ──
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashTriggerBlockId, setSlashTriggerBlockId] = useState<string | null>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashInputRef = useRef<HTMLInputElement>(null);

  // Track which block is focused for slash menu insertion
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

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

  // ── Dirty tracking ──
  const isDirtyBlocks = useMemo(() => {
    return JSON.stringify(blocks) !== initialBlocksJson.current;
  }, [blocks]);

  useEffect(() => {
    const titleDirty = editValue.trim() !== folderName;
    onDirtyChange?.(titleDirty || isDirtyBlocks);
  }, [editValue, folderName, isDirtyBlocks, onDirtyChange]);

  // ── Save handlers ──
  const handleSaveTitle = useCallback(() => {
    const trimmed = editValueRef.current.trim();
    if (trimmed && trimmed !== folderNameRef.current) {
      onRename(trimmed).catch((error) => {
        console.error("Failed to rename folder:", error);
      });
    } else {
      setEditValue(folderNameRef.current);
    }
    setIsEditing(false);
  }, [onRename]);

  const handleSaveAll = useCallback(() => {
    handleSaveTitle();
    // Strip transient media fields before saving
    const blocksToSave = blocksRef.current.map(({ mediaUrl, mediaStatus, ...rest }) => rest);
    onSaveBlocks?.(blocksToSave as Block[]);
    initialBlocksJson.current = JSON.stringify(blocksRef.current);
  }, [handleSaveTitle, onSaveBlocks]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSaveAll();
        return;
      }
      if (e.key === "Escape") {
        setEditValue(folderNameRef.current);
        setIsEditing(false);
      }
    },
    [handleSaveAll]
  );

  // Global Cmd+S handler
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveAll();
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleSaveAll]);

  // ── Block operations ──
  const createParentId = parentId !== undefined ? parentId : folderId;

  const insertBlockAfter = useCallback(
    (afterBlockId: string | null, type: BlockType = "paragraph") => {
      const newBlock = createBlock(type);
      setBlocks((prev) => {
        if (afterBlockId === null) {
          return [...prev, newBlock];
        }
        const idx = prev.findIndex((b) => b.id === afterBlockId);
        if (idx === -1) return [...prev, newBlock];
        const next = [...prev];
        next.splice(idx + 1, 0, newBlock);
        return next;
      });
      focusBlockId.current = newBlock.id;
    },
    []
  );

  const deleteBlock = useCallback((blockId: string) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx === -1) return prev;
      const next = prev.filter((b) => b.id !== blockId);
      // Focus previous block
      if (idx > 0) {
        focusBlockId.current = prev[idx - 1].id;
      }
      return next;
    });
  }, []);

  const mergeWithPrevious = useCallback((blockId: string, trailingContent: string) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx <= 0) return prev;
      // Remove current block and append content to previous
      const prevBlock = prev[idx - 1];
      const next = [...prev];
      next[idx - 1] = { ...prevBlock, content: prevBlock.content + trailingContent };
      next.splice(idx, 1);
      focusBlockId.current = prevBlock.id;
      return next;
    });
  }, []);

  const updateBlock = useCallback((blockId: string, updated: Block) => {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? updated : b)));
  }, []);

  // ── Media URL resolution ──
  const mediaUrlCache = useRef<Map<string, { url: string; fetchedAt: number }>>(new Map());
  const URL_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

  useEffect(() => {
    if (!onGetMediaUrl) return;

    const mediaBlocks = blocks.filter(
      (b) =>
        (b.type === "image" || b.type === "video" || b.type === "audio" || b.type === "file") &&
        b.mediaNodeId &&
        b.mediaStatus !== "uploading" &&
        !b.mediaUrl
    );

    if (mediaBlocks.length === 0) return;

    let cancelled = false;

    (async () => {
      for (const block of mediaBlocks) {
        if (cancelled) break;
        const nodeId = block.mediaNodeId!;

        // Check cache
        const cached = mediaUrlCache.current.get(nodeId);
        if (cached && Date.now() - cached.fetchedAt < URL_CACHE_TTL) {
          setBlocks((prev) =>
            prev.map((b) => (b.id === block.id ? { ...b, mediaUrl: cached.url, mediaStatus: "ready" as const } : b))
          );
          continue;
        }

        const url = await onGetMediaUrl(nodeId);
        if (cancelled) break;

        if (url) {
          mediaUrlCache.current.set(nodeId, { url, fetchedAt: Date.now() });
          setBlocks((prev) =>
            prev.map((b) => (b.id === block.id ? { ...b, mediaUrl: url, mediaStatus: "ready" as const } : b))
          );
        } else {
          setBlocks((prev) =>
            prev.map((b) => (b.id === block.id ? { ...b, mediaStatus: "error" as const } : b))
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blocks, onGetMediaUrl]);

  // ── Slash menu ──
  const closeMenu = useCallback(() => {
    setShowSlashMenu(false);
    setSlashFilter("");
    setSlashTriggerBlockId(null);
  }, []);

  // ── Media insert from slash menu ──
  const handleMediaInsert = useCallback(
    async (mediaType: "image" | "video" | "audio" | "file", accept: string) => {
      const triggerBlockId = slashTriggerBlockId;
      closeMenu();

      if (!onUploadMedia) return;

      // Insert placeholder block
      const placeholderId = genId();
      const placeholderBlock: Block = {
        id: placeholderId,
        type: mediaType,
        content: "",
        mediaName: "アップロード中...",
        mediaStatus: "uploading",
      };

      setBlocks((prev) => {
        if (triggerBlockId) {
          const idx = prev.findIndex((b) => b.id === triggerBlockId);
          if (idx !== -1 && prev[idx].type === "paragraph" && prev[idx].content === "") {
            const next = [...prev];
            next[idx] = placeholderBlock;
            return next;
          }
          if (idx !== -1) {
            const next = [...prev];
            next.splice(idx + 1, 0, placeholderBlock);
            return next;
          }
        }
        return [...prev, placeholderBlock];
      });

      // Trigger upload via parent
      const result = await onUploadMedia(accept, createParentId);

      if (result) {
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === placeholderId
              ? { ...b, mediaNodeId: result.nodeId, mediaName: result.fileName, mediaStatus: "ready" as const }
              : b
          )
        );
      } else {
        // Upload cancelled or failed - remove placeholder
        setBlocks((prev) => prev.filter((b) => b.id !== placeholderId));
      }
    },
    [slashTriggerBlockId, closeMenu, createParentId, onUploadMedia]
  );

  const handleSlashInsert = useCallback(
    (type: BlockType) => {
      if (slashTriggerBlockId) {
        // Replace the trigger block if it's empty paragraph, or insert after
        setBlocks((prev) => {
          const idx = prev.findIndex((b) => b.id === slashTriggerBlockId);
          if (idx !== -1 && prev[idx].type === "paragraph" && prev[idx].content === "") {
            // Replace with new block type
            const next = [...prev];
            next[idx] = { ...next[idx], type };
            focusBlockId.current = next[idx].id;
            return next;
          }
          // Insert after
          const newBlock = createBlock(type);
          const next = [...prev];
          next.splice(idx + 1, 0, newBlock);
          focusBlockId.current = newBlock.id;
          return next;
        });
      } else {
        // Insert at end
        const newBlock = createBlock(type);
        setBlocks((prev) => [...prev, newBlock]);
        focusBlockId.current = newBlock.id;
      }
      closeMenu();
    },
    [slashTriggerBlockId, closeMenu]
  );

  // Detect / typed in a block
  const handleBlockInput = useCallback(
    (blockId: string, block: Block) => {
      if (block.content === "/") {
        // Clear the / and open menu
        setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, content: "" } : b)));
        setSlashTriggerBlockId(blockId);
        setShowSlashMenu(true);
        setSlashFilter("");
        setSlashSelectedIndex(0);
        setTimeout(() => slashInputRef.current?.focus(), 0);
      } else if (block.content === "\uff1b") {
        // Full-width ;
        setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, content: "" } : b)));
        setSlashTriggerBlockId(blockId);
        setShowSlashMenu(true);
        setSlashFilter("");
        setSlashSelectedIndex(0);
        setTimeout(() => slashInputRef.current?.focus(), 0);
      } else {
        updateBlock(blockId, block);
      }
    },
    [updateBlock]
  );

  // Slash menu categories
  const slashMenuCategories: SlashMenuCategory[] = useMemo(() => {
    return [
      {
        label: "基本",
        items: [
          {
            id: "heading1",
            label: "見出し 1",
            shortcut: "#",
            icon: <span className="w-5 h-5 flex items-center justify-center text-[13px] font-bold text-zinc-700">H<sub className="text-[9px]">1</sub></span>,
            blockType: "heading1" as BlockType,
          },
          {
            id: "heading2",
            label: "見出し 2",
            shortcut: "##",
            icon: <span className="w-5 h-5 flex items-center justify-center text-[13px] font-bold text-zinc-700">H<sub className="text-[9px]">2</sub></span>,
            blockType: "heading2" as BlockType,
          },
          {
            id: "heading3",
            label: "見出し 3",
            shortcut: "###",
            icon: <span className="w-5 h-5 flex items-center justify-center text-[13px] font-bold text-zinc-700">H<sub className="text-[9px]">3</sub></span>,
            blockType: "heading3" as BlockType,
          },
          {
            id: "bullet-list",
            label: "箇条書きリスト",
            shortcut: "-",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <circle cx="3" cy="4" r="1" fill="currentColor" stroke="none" />
                <line x1="6" y1="4" x2="14" y2="4" />
                <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
                <line x1="6" y1="8" x2="14" y2="8" />
                <circle cx="3" cy="12" r="1" fill="currentColor" stroke="none" />
                <line x1="6" y1="12" x2="14" y2="12" />
              </svg>
            ),
            blockType: "bulletList" as BlockType,
          },
          {
            id: "numbered-list",
            label: "番号付きリスト",
            shortcut: "1.",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="currentColor" stroke="none">
                <text x="1" y="5.5" fontSize="4.5" fontWeight="bold" fontFamily="system-ui">1</text>
                <text x="1" y="9.5" fontSize="4.5" fontWeight="bold" fontFamily="system-ui">2</text>
                <text x="1" y="13.5" fontSize="4.5" fontWeight="bold" fontFamily="system-ui">3</text>
                <line x1="6" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="6" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="6" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ),
            blockType: "numberedList" as BlockType,
          },
          {
            id: "todo-list",
            label: "ToDoリスト",
            shortcut: "[]",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="5" height="5" rx="1" />
                <path d="M3.5 4.5l1 1 2-2" />
                <line x1="9" y1="4.5" x2="14" y2="4.5" />
                <rect x="2" y="9" width="5" height="5" rx="1" />
                <line x1="9" y1="11.5" x2="14" y2="11.5" />
              </svg>
            ),
            blockType: "todo" as BlockType,
          },
          {
            id: "toggle-list",
            label: "トグルリスト",
            shortcut: ">",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 3l4 3-4 3" fill="currentColor" stroke="none" />
                <line x1="2" y1="12" x2="14" y2="12" />
              </svg>
            ),
            blockType: "toggleList" as BlockType,
          },
          {
            id: "new-file",
            label: "新規ファイル",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z" />
                <path d="M9.5 1.5v5h5" />
                <path d="M8 8v3" />
                <path d="M6.5 9.5h3" />
              </svg>
            ),
            action: () => { onCreateFile?.(createParentId); closeMenu(); },
          },
          {
            id: "new-folder",
            label: "新規フォルダー",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="5" width="13" height="8.5" rx="1.5" />
                <path d="M1.5 5V4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h4" />
                <path d="M8 8v3" />
                <path d="M6.5 9.5h3" />
              </svg>
            ),
            action: () => { onCreateFolder?.(createParentId); closeMenu(); },
          },
          {
            id: "callout",
            label: "コールアウト",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="2" width="14" height="12" rx="2" />
                <circle cx="5" cy="8" r="1.5" fill="currentColor" stroke="none" />
                <line x1="8" y1="8" x2="13" y2="8" />
              </svg>
            ),
            blockType: "callout" as BlockType,
          },
          {
            id: "quote",
            label: "引用",
            shortcut: "\"",
            icon: <span className="w-5 h-5 flex items-center justify-center text-[16px] font-bold text-zinc-700">&ldquo;</span>,
            blockType: "quote" as BlockType,
          },
          {
            id: "divider",
            label: "区切り線",
            shortcut: "---",
            icon: <span className="w-5 h-5 flex items-center justify-center text-[16px] font-bold text-zinc-500">&mdash;</span>,
            blockType: "divider" as BlockType,
          },
          {
            id: "code",
            label: "コード",
            shortcut: "```",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4.5,4 1.5,8 4.5,12" />
                <polyline points="11.5,4 14.5,8 11.5,12" />
                <line x1="9.5" y1="3" x2="6.5" y2="13" />
              </svg>
            ),
            blockType: "code" as BlockType,
          },
        ],
      },
      {
        label: "メディア",
        items: [
          {
            id: "image",
            label: "画像",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
                <circle cx="5.5" cy="6" r="1.5" />
                <path d="M14.5 10.5l-3-3-4 4-2-2-4 4" />
              </svg>
            ),
            action: () => { handleMediaInsert("image", "image/*"); },
          },
          {
            id: "video",
            label: "動画",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
                <polygon points="6.5,6 6.5,10 10.5,8" fill="currentColor" stroke="none" />
              </svg>
            ),
            action: () => { handleMediaInsert("video", "video/*"); },
          },
          {
            id: "audio",
            label: "オーディオ",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="2,5.5 2,10.5 5,10.5 9,13.5 9,2.5 5,5.5" fill="none" />
                <path d="M11.5 5.5c.8.8.8 2.1 0 3" />
                <path d="M13 4c1.5 1.5 1.5 4 0 5.5" />
              </svg>
            ),
            action: () => { handleMediaInsert("audio", "audio/*"); },
          },
          {
            id: "file-upload",
            label: "ファイル",
            icon: (
              <svg viewBox="0 0 16 16" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.5 7.5l-5.2 5.2a3 3 0 0 1-4.2-4.2l5.2-5.2a2 2 0 0 1 2.8 2.8l-5.2 5.2a1 1 0 0 1-1.4-1.4l4.5-4.5" />
              </svg>
            ),
            action: () => { handleMediaInsert("file", "*/*"); },
          },
        ],
      },
    ];
  }, [createParentId, onCreateFile, onCreateFolder, handleMediaInsert, closeMenu]);

  const filteredCategories = useMemo(() => {
    if (!slashFilter) return slashMenuCategories;
    const lower = slashFilter.toLowerCase();
    return slashMenuCategories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) => item.label.toLowerCase().includes(lower) || item.id.toLowerCase().includes(lower)
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [slashFilter, slashMenuCategories]);

  const filteredSlashItems = useMemo(() => {
    return filteredCategories.flatMap((cat) => cat.items);
  }, [filteredCategories]);

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashFilter]);

  useEffect(() => {
    if (showSlashMenu && slashInputRef.current) {
      slashInputRef.current.focus();
    }
  }, [showSlashMenu]);

  // Close slash menu on outside click
  useEffect(() => {
    if (!showSlashMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as HTMLElement)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSlashMenu, closeMenu]);

  const handleSlashItemSelect = useCallback(
    (item: SlashMenuItem) => {
      if (item.blockType) {
        handleSlashInsert(item.blockType);
      } else if (item.action) {
        item.action();
      }
    },
    [handleSlashInsert]
  );

  const handleSlashKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((prev) =>
          prev < filteredSlashItems.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSlashItems.length - 1
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredSlashItems[slashSelectedIndex]) {
          handleSlashItemSelect(filteredSlashItems[slashSelectedIndex]);
        }
      } else if (e.key === "Escape") {
        closeMenu();
      }
    },
    [filteredSlashItems, slashSelectedIndex, closeMenu, handleSlashItemSelect]
  );

  const getGlobalIndex = (catIndex: number, itemIndex: number): number => {
    let idx = 0;
    for (let i = 0; i < catIndex; i++) {
      idx += filteredCategories[i].items.length;
    }
    return idx + itemIndex;
  };

  // ── Empty-state click handler to add first block ──
  const handleEmptyClick = useCallback(() => {
    if (blocks.length === 0) {
      const newBlock = createBlock("paragraph");
      setBlocks([newBlock]);
      focusBlockId.current = newBlock.id;
    }
  }, [blocks.length]);

  // Numbered list counter
  const getNumberedListIndex = useCallback(
    (blockIndex: number) => {
      let count = 1;
      for (let i = blockIndex - 1; i >= 0; i--) {
        if (blocks[i].type === "numberedList") {
          count++;
        } else {
          break;
        }
      }
      return count;
    },
    [blocks]
  );

  // Sort child nodes
  const sortedChildren = useMemo(() => {
    return [...childNodes].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [childNodes]);

  return (
    <div className="h-full w-full flex flex-col items-center pt-24 px-8 overflow-auto bg-white">
      <div className="w-full max-w-3xl">
        {/* Title */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            className="w-full text-4xl font-bold text-zinc-900 bg-transparent border-none outline-none placeholder-zinc-300 focus:ring-0"
            placeholder="無題"
          />
        ) : (
          <h1
            onClick={() => setIsEditing(true)}
            className="text-4xl font-bold text-zinc-900 cursor-text hover:bg-zinc-50 rounded px-1 -mx-1 transition-colors"
          >
            {folderName || "無題"}
          </h1>
        )}

        {/* Block editor area */}
        <div className="mt-4 min-h-[200px]" onClick={handleEmptyClick}>
          {blocks.map((block, index) => {
            const refObj = { current: null as HTMLElement | null };
            return (
              <div key={block.id} className="relative">
                {/* Numbered list index */}
                {block.type === "numberedList" && (
                  <div className="absolute left-0 top-0.5 flex items-start">
                    <span className="text-zinc-500 text-[15px] select-none pl-1 min-w-[1.2em] text-right">
                      {getNumberedListIndex(index)}.
                    </span>
                  </div>
                )}
                <div className={block.type === "numberedList" ? "pl-7" : ""}>
                  <BlockItem
                    block={block}
                    onChange={(updated) => handleBlockInput(block.id, updated)}
                    onDelete={() => deleteBlock(block.id)}
                    onInsertAfter={(type) => insertBlockAfter(block.id, type)}
                    onFocus={() => setFocusedBlockId(block.id)}
                    focusRef={{
                      get current() { return blockRefs.current.get(block.id) ?? null; },
                      set current(el) { blockRefs.current.set(block.id, el); },
                    }}
                    onMergeWithPrevious={(trailing) => mergeWithPrevious(block.id, trailing)}
                  />
                </div>
              </div>
            );
          })}

          {/* Empty state placeholder */}
          {blocks.length === 0 && (
            <div className="text-zinc-300 text-[15px] cursor-text select-none py-1">
              テキストを入力するか、「/」でコマンドを選択...
            </div>
          )}
        </div>

        {/* Slash command menu */}
        {showSlashMenu && (
          <div
            ref={slashMenuRef}
            className="w-full max-w-md bg-white rounded-lg shadow-lg border border-zinc-200 overflow-hidden max-h-[400px] overflow-y-auto mt-1"
          >
            <div className="flex items-center px-3 py-2 border-b border-zinc-100 sticky top-0 bg-white z-10">
              <span className="text-zinc-400 text-sm mr-1">/</span>
              <input
                ref={slashInputRef}
                type="text"
                value={slashFilter}
                onChange={(e) => setSlashFilter(e.target.value)}
                onKeyDown={handleSlashKeyDown}
                className="flex-1 text-sm bg-transparent border-none outline-none placeholder-zinc-400"
                placeholder="フィルター..."
              />
              <span className="text-[10px] text-zinc-400 ml-2">esc</span>
            </div>

            {filteredCategories.length > 0 ? (
              filteredCategories.map((cat, catIndex) => (
                <div key={cat.label}>
                  <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    {cat.label}
                  </div>
                  {cat.items.map((item, itemIndex) => {
                    const globalIdx = getGlobalIndex(catIndex, itemIndex);
                    return (
                      <div
                        key={item.id}
                        onClick={() => handleSlashItemSelect(item)}
                        onMouseEnter={() => setSlashSelectedIndex(globalIdx)}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                          globalIdx === slashSelectedIndex
                            ? "bg-zinc-100"
                            : "hover:bg-zinc-50"
                        }`}
                      >
                        <span className="text-zinc-600 flex-shrink-0">{item.icon}</span>
                        <span className="text-sm text-zinc-800 flex-1">{item.label}</span>
                        {item.shortcut && (
                          <span className="text-xs text-zinc-400">{item.shortcut}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-zinc-400">
                結果なし
              </div>
            )}

            <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50 text-xs text-zinc-400 flex items-center justify-between sticky bottom-0">
              <span>「/{slashFilter || "フィルター"}」と入力してください</span>
              <span>esc</span>
            </div>
          </div>
        )}

        {/* Child nodes list */}
        {mounted && sortedChildren.length > 0 && (
          <div className="mt-6 pt-4 border-t border-zinc-100">
            {sortedChildren.map((child) => {
              const Icon =
                child.type === "folder"
                  ? FileIcons.Folder
                  : getFileIcon(child.name);
              return (
                <div
                  key={child.id}
                  onClick={() => onOpenNode?.(child.id)}
                  className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-50 transition-colors group"
                >
                  <Icon className="w-5 h-5 flex-shrink-0 text-zinc-500" />
                  <span className="text-[15px] text-zinc-900 truncate">
                    {child.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ContextMenu } from "./ContextMenu";
import { ActionIcons, ChevronIcon, FileIcons, getFileIcon, getFolderColor } from "./fileIcons";
import { AccountMenu } from "./AccountMenu";

type Node = {
  id: string;
  parent_id: string | null;
  type: "file" | "folder";
  name: string;
};

type Workspace = {
  id: string;
  name: string;
};

type FileTreeProps = {
  nodes: Node[];
  selectedNodeIds: Set<string>;
  onSelectNode: (nodeId: string) => void;
  onToggleSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  onHoverNode?: (nodeId: string) => void;
  revealNodeId?: string | null;
  onSelectFolder?: (nodeId: string) => void;
  onCreateFile: (path: string, parentId: string | null) => void;
  onCreateFolder: (path: string, parentId: string | null) => void;
  onRenameNode: (id: string, newName: string) => void;
  onDeleteNodes: (ids: string[]) => void;
  onUploadFiles?: (parentId: string | null) => void;
  onUploadFolder?: (parentId: string | null) => void;
  onDownload?: (nodeIds: string[]) => void;
  onNewNote?: () => void;
  onShare?: () => void;
  onDropFiles?: (dataTransfer: DataTransfer, targetFolderId: string | null) => void;
  onMoveNodes?: (nodeIds: string[], newParentId: string | null) => void;
  onCopyNodes?: (nodeIds: string[], newParentId: string | null) => Promise<string[]> | void;
  onUndo?: () => void;
  onRedo?: () => void;
  projectName?: string;
  userEmail?: string;
  userName?: string;
  planName?: string;
  onOpenSettings?: () => void;
  onRenameWorkspace?: (newName: string) => Promise<void>;
  onDeleteWorkspace?: () => void;
  isLoading?: boolean;
  // ワークスペース切り替え関連
  workspaces?: Workspace[];
  activeWorkspaceId?: string;
  onSelectWorkspace?: (id: string) => void;
  onCreateWorkspace?: () => void;
  // ワークスペースコンテキストメニュー用
  onRenameWorkspaceById?: (workspaceId: string, currentName: string) => void;
  onDeleteWorkspaceById?: (workspaceId: string, workspaceName: string) => void;
  onShareWorkspace?: (workspaceId: string) => void;
};

type EditingState = {
  type: "create" | "rename";
  nodeType: "file" | "folder";
  parentId: string | null;
  targetId?: string;
  initialValue?: string;
};

type DropdownMenu = {
  type: "more";
  x: number;
  y: number;
} | null;

type VisibleRow =
  | { kind: "node"; node: Node; depth: number }
  | { kind: "create"; nodeType: "file" | "folder"; depth: number; parentId: string | null };

const ROW_HEIGHT = 28;
const OVERSCAN = 8;
const BOTTOM_GAP = 40;

// Loading skeleton component
function FileTreeSkeleton() {
  return (
    <div className="p-2 space-y-1 animate-pulse">
      {/* Folder skeleton */}
      <div className="flex items-center gap-2 px-2 py-1">
        <div className="w-4 h-4 bg-zinc-200 rounded" />
        <div className="h-4 bg-zinc-200 rounded w-24" />
      </div>
      {/* Nested files */}
      <div className="pl-4 space-y-1">
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="w-4 h-4 bg-zinc-200 rounded" />
          <div className="h-4 bg-zinc-200 rounded w-20" />
        </div>
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="w-4 h-4 bg-zinc-200 rounded" />
          <div className="h-4 bg-zinc-200 rounded w-28" />
        </div>
      </div>
      {/* Another folder */}
      <div className="flex items-center gap-2 px-2 py-1">
        <div className="w-4 h-4 bg-zinc-200 rounded" />
        <div className="h-4 bg-zinc-200 rounded w-20" />
      </div>
      {/* Files */}
      <div className="flex items-center gap-2 px-2 py-1">
        <div className="w-4 h-4 bg-zinc-200 rounded" />
        <div className="h-4 bg-zinc-200 rounded w-32" />
      </div>
      <div className="flex items-center gap-2 px-2 py-1">
        <div className="w-4 h-4 bg-zinc-200 rounded" />
        <div className="h-4 bg-zinc-200 rounded w-16" />
      </div>
    </div>
  );
}

export function FileTree({
  nodes,
  selectedNodeIds,
  onSelectNode,
  onToggleSelectNode,
  onClearSelection,
  onHoverNode,
  revealNodeId,
  onSelectFolder,
  onCreateFile,
  onCreateFolder,
  onRenameNode,
  onDeleteNodes,
  onUploadFiles,
  onUploadFolder,
  onDownload,
  onNewNote,
  onShare,
  onDropFiles,
  onMoveNodes,
  onCopyNodes,
  onUndo,
  onRedo,
  projectName,
  userEmail,
  userName,
  planName,
  onOpenSettings,
  onRenameWorkspace,
  onDeleteWorkspace,
  isLoading,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspaceById,
  onDeleteWorkspaceById,
  onShareWorkspace,
}: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetId: string | null;
  } | null>(null);

  // ワークスペース用コンテキストメニュー
  const [wsContextMenu, setWsContextMenu] = useState<{
    x: number;
    y: number;
    workspaceId: string;
    workspaceName: string;
  } | null>(null);

  const [editingState, setEditingState] = useState<EditingState | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const [isProjectExpanded, setIsProjectExpanded] = useState(true);
  const [dropdownMenu, setDropdownMenu] = useState<DropdownMenu>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [dragOverSubtreeId, setDragOverSubtreeId] = useState<string | null>(null);
  const [draggingNodeIds, setDraggingNodeIds] = useState<Set<string>>(new Set());
  const dragCounterRef = useRef<Record<string, number>>({});
  const dragExpandTimerRef = useRef<NodeJS.Timeout | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement>(null);

  // Clipboard state for cut/copy/paste
  const [clipboard, setClipboard] = useState<{
    nodeIds: string[];
    operation: "cut" | "copy";
  } | null>(null);

  // Workspace name editing state
  const [isEditingWorkspaceName, setIsEditingWorkspaceName] = useState(false);
  const [workspaceNameValue, setWorkspaceNameValue] = useState("");
  const workspaceNameInputRef = useRef<HTMLInputElement>(null);
  // ワークスペース切り替えポップオーバー
  const [isWorkspacePopoverOpen, setIsWorkspacePopoverOpen] = useState(false);
  const workspacePopoverRef = useRef<HTMLDivElement>(null);
  const workspaceTriggerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  // 一度スクロールしたrevealNodeIdを追跡（同じIDで再スクロールしない）
  const lastRevealedNodeIdRef = useRef<string | null>(null);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const nameCollator = useMemo(
    () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
    []
  );
  const nodesByParentId = useMemo(() => {
    const map = new Map<string | null, Node[]>();
    for (const node of nodes) {
      const key = node.parent_id ?? null;
      const list = map.get(key);
      if (list) {
        list.push(node);
      } else {
        map.set(key, [node]);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return nameCollator.compare(a.name, b.name);
      });
    }
    return map;
  }, [nodes, nameCollator]);

  const handleScroll = useCallback(() => {
    const container = treeScrollRef.current;
    if (!container) return;
    const nextTop = container.scrollTop;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(nextTop);
    });
  }, []);

  useEffect(() => {
    const container = treeScrollRef.current;
    if (!container) return;
    const updateSize = () => {
      setViewportHeight(container.clientHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const visibleRows = useMemo<VisibleRow[]>(() => {
    if (projectName && !isProjectExpanded) return [];
    const rows: VisibleRow[] = [];
    const buildRows = (parentId: string | null, depth: number) => {
      const children = nodesByParentId.get(parentId ?? null) ?? [];
      const folders: Node[] = [];
      const files: Node[] = [];
      for (const child of children) {
        if (child.type === "folder") {
          folders.push(child);
        } else {
          files.push(child);
        }
      }

      const isCreatingHere =
        editingState?.type === "create" && editingState.parentId === parentId;

      if (isCreatingHere && editingState?.nodeType === "folder") {
        rows.push({ kind: "create", nodeType: "folder", depth, parentId });
      }

      for (const folder of folders) {
        rows.push({ kind: "node", node: folder, depth });
        if (expandedFolders.has(folder.id)) {
          buildRows(folder.id, depth + 1);
        }
      }

      if (isCreatingHere && editingState?.nodeType === "file") {
        rows.push({ kind: "create", nodeType: "file", depth, parentId });
      }

      for (const file of files) {
        rows.push({ kind: "node", node: file, depth });
      }
    };

    buildRows(null, 0);
    return rows;
  }, [editingState, expandedFolders, nodesByParentId, projectName, isProjectExpanded]);

  const rowIndexByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    visibleRows.forEach((row, index) => {
      if (row.kind === "node") {
        map.set(row.node.id, index);
      }
    });
    return map;
  }, [visibleRows]);

  const editRowIndex = useMemo(() => {
    if (!editingState || editingState.type !== "create") return null;
    for (let i = 0; i < visibleRows.length; i += 1) {
      const row = visibleRows[i];
      if (
        row.kind === "create" &&
        row.parentId === editingState.parentId &&
        row.nodeType === editingState.nodeType
      ) {
        return i;
      }
    }
    return null;
  }, [editingState, visibleRows]);

  const scrollToRowIndex = useCallback((index: number, centerInView = false) => {
    const container = treeScrollRef.current;
    if (!container) return;
    const rowTop = index * ROW_HEIGHT;

    if (centerInView) {
      const centerOffset = (container.clientHeight - ROW_HEIGHT) / 2;
      container.scrollTop = Math.max(0, rowTop - centerOffset);
    } else {
      const rowBottom = rowTop + ROW_HEIGHT;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      if (rowTop < viewTop) {
        container.scrollTop = rowTop;
      } else if (rowBottom > viewBottom) {
        container.scrollTop = Math.max(0, rowBottom - container.clientHeight);
      }
    }
  }, []);

  const totalRowsHeight = visibleRows.length * ROW_HEIGHT;
  const maxScrollTop = Math.max(0, totalRowsHeight - viewportHeight);
  const clampedScrollTop = Math.min(scrollTop, maxScrollTop);
  const startIndex = Math.max(0, Math.floor(clampedScrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    visibleRows.length,
    Math.ceil((clampedScrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );
  const visibleSlice = visibleRows.slice(startIndex, endIndex);
  const topPadding = startIndex * ROW_HEIGHT;
  const bottomPadding = Math.max(0, totalRowsHeight - endIndex * ROW_HEIGHT);

  useEffect(() => {
    if (!revealNodeId) return;
    // 同じIDで既にreveal済みならスキップ
    if (lastRevealedNodeIdRef.current === revealNodeId) return;
    setIsProjectExpanded(true);
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      let currentId: string | null = revealNodeId;
      while (currentId) {
        next.add(currentId);
        const node = nodeMap.get(currentId);
        if (!node) break;
        currentId = node.parent_id;
      }
      return next;
    });
  }, [revealNodeId, nodeMap]);

  useEffect(() => {
    if (!revealNodeId) return;
    // 同じIDで既にスクロール済みならスキップ
    if (lastRevealedNodeIdRef.current === revealNodeId) return;
    const index = rowIndexByNodeId.get(revealNodeId);
    if (index === undefined) return;
    scrollToRowIndex(index, true);
    // スクロール完了後、このIDを記録
    lastRevealedNodeIdRef.current = revealNodeId;
  }, [revealNodeId, rowIndexByNodeId, scrollToRowIndex]);

  // Get the selected folder (for creating files/folders in it)
  const getSelectedParentId = (): string | null => {
    if (selectedNodeIds.size === 0) return null;
    const firstSelectedId = Array.from(selectedNodeIds)[0];
    const selectedNode = nodeMap.get(firstSelectedId);
    if (!selectedNode) return null;
    return selectedNode.type === "folder" ? selectedNode.id : selectedNode.parent_id;
  };

  const getNodePath = (nodeId: string | null): string => {
    if (!nodeId) return "";
    const node = nodeMap.get(nodeId);
    if (!node) return "";
    const parentPath = getNodePath(node.parent_id);
    return parentPath ? `${parentPath}/${node.name}` : node.name;
  };

  // Check for duplicate names in same parent folder
  const checkDuplicateName = (name: string, parentId: string | null, excludeId?: string): boolean => {
    const trimmedName = name.trim().toLowerCase();
    if (!trimmedName) return false;

    const siblings = nodesByParentId.get(parentId ?? null) ?? [];
    return siblings.some(
      (n) => n.name.toLowerCase() === trimmedName && n.id !== excludeId
    );
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement)) {
        setDropdownMenu(null);
      }
    };
    if (dropdownMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownMenu]);

  // Cleanup drag expand timer on unmount
  useEffect(() => {
    return () => {
      if (dragExpandTimerRef.current) {
        clearTimeout(dragExpandTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editingState) return;
    const value = editingState.initialValue || "";
    setInputValue(value);
    setValidationError(null);

    let attempts = 0;
    const tryFocus = () => {
      if (!inputRef.current) {
        if (attempts < 30) {
          attempts += 1;
          requestAnimationFrame(tryFocus);
        }
        return;
      }

      inputRef.current.focus();

      // For rename operation on files, select only the basename (before extension)
      if (editingState.type === "rename" && editingState.nodeType === "file") {
        const lastDotIndex = value.lastIndexOf(".");
        // Only select basename if there's an extension (dot not at start or end)
        if (lastDotIndex > 0 && lastDotIndex < value.length - 1) {
          inputRef.current.setSelectionRange(0, lastDotIndex);
        } else {
          inputRef.current.select();
        }
      } else {
        // For folders or new files, select all
        inputRef.current.select();
      }
    };

    requestAnimationFrame(tryFocus);
  }, [editingState]);

  useEffect(() => {
    if (!editingState) return;
    let index: number | null = null;
    if (editingState.type === "rename" && editingState.targetId) {
      index = rowIndexByNodeId.get(editingState.targetId) ?? null;
    } else if (editingState.type === "create") {
      index = editRowIndex;
    }
    if (index !== null && index !== undefined) {
      scrollToRowIndex(index);
    }
  }, [editingState, editRowIndex, rowIndexByNodeId, scrollToRowIndex]);

  // Focus workspace name input when editing starts
  useEffect(() => {
    if (isEditingWorkspaceName && workspaceNameInputRef.current) {
      setTimeout(() => {
        if (!workspaceNameInputRef.current) return;
        workspaceNameInputRef.current.focus();
        workspaceNameInputRef.current.select();
      }, 0);
    }
  }, [isEditingWorkspaceName]);

  // Close workspace popover on outside click
  useEffect(() => {
    if (!isWorkspacePopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // ポップオーバー内のクリックは無視
      if (workspacePopoverRef.current && workspacePopoverRef.current.contains(target)) {
        return;
      }
      // トリガー領域（アイコン・名前）のクリックは無視（トグル処理に任せる）
      if (workspaceTriggerRef.current && workspaceTriggerRef.current.contains(target)) {
        return;
      }
      setIsWorkspacePopoverOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isWorkspacePopoverOpen]);

  // Keyboard shortcuts for cut/copy/paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if Cmd (Mac) or Ctrl (Windows) is pressed
      if (!(e.metaKey || e.ctrlKey)) return;

      // Don't handle if focus is in an input or textarea
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
        return;
      }

      // Check if we have selected nodes
      const hasSelection = selectedNodeIds.size > 0;

      switch (e.key.toLowerCase()) {
        case "c": // Copy
          if (hasSelection) {
            e.preventDefault();
            setClipboard({ nodeIds: Array.from(selectedNodeIds), operation: "copy" });
          }
          break;
        case "x": // Cut
          if (hasSelection) {
            e.preventDefault();
            setClipboard({ nodeIds: Array.from(selectedNodeIds), operation: "cut" });
          }
          break;
        case "v": // Paste
          if (clipboard && clipboard.nodeIds.length > 0) {
            e.preventDefault();
            // Paste at the same level as the copied item (same parent)
            const firstClipboardNode = nodeMap.get(clipboard.nodeIds[0]);
            const targetParentId = firstClipboardNode?.parent_id ?? null;

            if (clipboard.operation === "cut") {
              onMoveNodes?.(clipboard.nodeIds, targetParentId);
              setClipboard(null);
            } else {
              onCopyNodes?.(clipboard.nodeIds, targetParentId);
            }
          }
          break;
        case "z": // Undo or Redo
          e.preventDefault();
          if (e.shiftKey) {
            onRedo?.();
          } else {
            onUndo?.();
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeIds, clipboard, nodeMap, onMoveNodes, onCopyNodes, onUndo, onRedo]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);

    if (!editingState) return;

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setValidationError(null);
      return;
    }

    const excludeId = editingState.type === "rename" ? editingState.targetId : undefined;
    const isDuplicate = checkDuplicateName(trimmedValue, editingState.parentId, excludeId);

    if (isDuplicate) {
      setValidationError(trimmedValue);
    } else {
      setValidationError(null);
    }
  };

  const handleEditComplete = () => {
    if (!editingState || !inputRef.current) return;
    const value = inputRef.current.value.trim();
    if (!value) {
      setEditingState(null);
      setInputValue("");
      setValidationError(null);
      return;
    }

    if (validationError) {
      return;
    }

    if (editingState.type === "create") {
      const parentPath = getNodePath(editingState.parentId);
      const fullPath = parentPath ? `${parentPath}/${value}` : value;
      if (editingState.nodeType === "file") {
        onCreateFile(fullPath, editingState.parentId);
      } else {
        onCreateFolder(fullPath, editingState.parentId);
      }
    } else if (editingState.type === "rename" && editingState.targetId) {
      if (value !== editingState.initialValue) {
        onRenameNode(editingState.targetId, value);
      }
    }
    setEditingState(null);
    setInputValue("");
    setValidationError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (!validationError) {
        handleEditComplete();
      }
    } else if (e.key === "Escape") {
      setEditingState(null);
      setInputValue("");
      setValidationError(null);
    }
  };

  const handleInputBlur = () => {
    if (!validationError) {
      handleEditComplete();
    } else {
      setEditingState(null);
      setInputValue("");
      setValidationError(null);
    }
  };

  // Workspace name editing handlers
  const startEditingWorkspaceName = () => {
    setWorkspaceNameValue(projectName || "");
    setIsEditingWorkspaceName(true);
    setDropdownMenu(null);
  };

  const handleWorkspaceNameComplete = () => {
    const trimmedValue = workspaceNameValue.trim();
    if (!trimmedValue || trimmedValue === projectName) {
      setIsEditingWorkspaceName(false);
      setWorkspaceNameValue("");
      return;
    }

    // Close editing immediately for instant feedback
    setIsEditingWorkspaceName(false);
    setWorkspaceNameValue("");

    // Call API in background (optimistic update)
    if (onRenameWorkspace) {
      onRenameWorkspace(trimmedValue).catch(() => {
        // Error handling is done in the parent component
      });
    }
  };

  const handleWorkspaceNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleWorkspaceNameComplete();
    } else if (e.key === "Escape") {
      setIsEditingWorkspaceName(false);
      setWorkspaceNameValue("");
    }
  };

  // Determine parent for context menu actions
  const getContextParentId = (): string | null => {
    const targetId = contextMenu?.targetId || null;
    const targetNode = targetId ? nodeMap.get(targetId) : null;

    if (targetNode) {
      if (targetNode.type === "folder") {
        return targetNode.id;
      } else {
        return targetNode.parent_id;
      }
    }
    return null;
  };

  const handleContextMenuAction = (action: string) => {
    const targetId = contextMenu?.targetId || null;
    const targetNode = targetId ? nodeMap.get(targetId) : null;
    const parentId = getContextParentId();

    if (parentId && targetNode?.type === "folder") {
      setExpandedFolders(prev => new Set(prev).add(parentId));
    }

    switch (action) {
      case "new_file":
        setEditingState({ type: "create", nodeType: "file", parentId });
        break;
      case "new_folder":
        setEditingState({ type: "create", nodeType: "folder", parentId });
        break;
      case "new_note":
        onNewNote?.();
        break;
      case "share":
        onShare?.();
        break;
      case "upload_files":
        onUploadFiles?.(parentId);
        break;
      case "upload_folder":
        onUploadFolder?.(parentId);
        break;
      case "download":
        if (targetId) {
          // If the target is selected and there are multiple selections, download all selected
          const idsToDownload = selectedNodeIds.has(targetId) && selectedNodeIds.size > 1
            ? Array.from(selectedNodeIds)
            : [targetId];
          onDownload?.(idsToDownload);
        } else {
          // Download all
          onDownload?.([]);
        }
        break;
      case "rename":
        if (targetId && targetNode) {
          setEditingState({
            type: "rename",
            nodeType: targetNode.type,
            parentId: targetNode.parent_id,
            targetId,
            initialValue: targetNode.name,
          });
        }
        break;
      case "delete":
        if (targetId && targetNode) {
          // If the target is selected and there are multiple selections, delete all selected
          const idsToDelete = selectedNodeIds.has(targetId) && selectedNodeIds.size > 1
            ? Array.from(selectedNodeIds)
            : [targetId];
          // Call onDeleteNodes directly - confirmation is handled by AppLayout
          onDeleteNodes(idsToDelete);
        }
        break;
      case "cut":
        if (targetId) {
          setClipboard({ nodeIds: [targetId], operation: "cut" });
        }
        break;
      case "copy":
        if (targetId) {
          setClipboard({ nodeIds: [targetId], operation: "copy" });
        }
        break;
      case "paste":
        if (clipboard && clipboard.nodeIds.length > 0) {
          if (clipboard.operation === "cut") {
            onMoveNodes?.(clipboard.nodeIds, parentId);
            setClipboard(null); // Clear clipboard after cut-paste
          } else {
            onCopyNodes?.(clipboard.nodeIds, parentId);
            // Keep clipboard for copy (can paste multiple times)
          }
        }
        break;
    }
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Check if drag contains files (not internal nodes)
  const isExternalFileDrag = (dataTransfer: DataTransfer): boolean => {
    if (!dataTransfer.types) return false;
    // Check for files being dragged from outside (not internal node drag)
    const hasFiles = dataTransfer.types.includes("Files");
    const hasInternalNode = dataTransfer.types.includes("application/cursor-node");
    return hasFiles && !hasInternalNode;
  };

  // Check if drag is internal node drag
  const isInternalNodeDrag = (dataTransfer: DataTransfer): boolean => {
    if (!dataTransfer.types) return false;
    return dataTransfer.types.includes("application/cursor-node");
  };

  // Check if any drag is happening (external or internal)
  const isAnyDrag = (dataTransfer: DataTransfer): boolean => {
    return isExternalFileDrag(dataTransfer) || isInternalNodeDrag(dataTransfer);
  };

  // Check if dropping any of the nodes into target would create a cycle (can't drop folder into itself or its descendants)
  const wouldCreateCycle = (draggedNodeIds: Set<string>, targetFolderId: string | null): boolean => {
    if (!targetFolderId) return false;
    for (const nodeId of draggedNodeIds) {
      if (isNodeInSubtree(targetFolderId, nodeId)) return true;
    }
    return false;
  };

  // Clear drag expand timer
  const clearDragExpandTimer = () => {
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
  };

  // Get the target folder ID for a node (for files, returns parent folder)
  const getDropTargetFolderId = (nodeId: string): string | null => {
    const node = nodeMap.get(nodeId);
    if (!node) return null;
    return node.type === "folder" ? node.id : node.parent_id;
  };

  const isNodeInSubtree = (nodeId: string, ancestorId: string): boolean => {
    if (nodeId === ancestorId) return true;
    let current = nodeMap.get(nodeId);
    while (current?.parent_id) {
      if (current.parent_id === ancestorId) return true;
      current = nodeMap.get(current.parent_id);
    }
    return false;
  };

  // Drag handlers for node drop targets (files and folders)
  const handleNodeDragEnter = (e: React.DragEvent, nodeId: string) => {
    const isExternal = isExternalFileDrag(e.dataTransfer);
    const isInternal = isInternalNodeDrag(e.dataTransfer);
    if (!isExternal && !isInternal) return;

    e.preventDefault();
    e.stopPropagation();
    const node = nodeMap.get(nodeId);
    if (!node) return;

    // For internal drag, prevent dropping onto itself or its descendants
    if (isInternal && draggingNodeIds.size > 0) {
      const targetFolderId = node.type === "folder" ? node.id : node.parent_id;
      if (wouldCreateCycle(draggingNodeIds, targetFolderId)) {
        return;
      }
      // Don't allow dropping on a node being dragged
      if (draggingNodeIds.has(nodeId)) {
        return;
      }
    }

    const isTopLevelFile = node.type === "file" && !node.parent_id;
    const targetId = node.type === "file"
      ? (node.parent_id ?? "root")
      : node.id;
    dragCounterRef.current[targetId] = (dragCounterRef.current[targetId] || 0) + 1;
    setDragOverNodeId(targetId);

    // Clear any existing timer
    clearDragExpandTimer();

    // For files inside a folder, immediately set the parent folder as subtree target
    if (node.type === "file" && node.parent_id) {
      setDragOverSubtreeId(node.parent_id);
      return;
    }

    // For top-level files, no subtree highlight
    if (isTopLevelFile) {
      setDragOverSubtreeId(null);
      return;
    }

    const isSameFolderSubtree = node.type === "folder" && dragOverSubtreeId === node.id;

    // For folders
    if (node.type === "folder" && !isSameFolderSubtree) {
      const isAlreadyExpanded = expandedFolders.has(node.id);

      if (isAlreadyExpanded) {
        // Already expanded - immediately highlight subtree
        setDragOverSubtreeId(node.id);
      } else {
        // Not expanded - start a timer to expand after 500ms
        dragExpandTimerRef.current = setTimeout(() => {
          setExpandedFolders(prev => new Set(prev).add(node.id));
          setDragOverSubtreeId(node.id);
        }, 500);
      }
    }
  };

  const handleNodeDragLeave = (e: React.DragEvent, nodeId: string) => {
    const isExternal = isExternalFileDrag(e.dataTransfer);
    const isInternal = isInternalNodeDrag(e.dataTransfer);
    if (!isExternal && !isInternal) return;

    e.preventDefault();
    e.stopPropagation();
    const node = nodeMap.get(nodeId);
    const targetId = node
      ? (node.type === "file"
        ? (node.parent_id ?? "root")
        : node.id)
      : nodeId;
    dragCounterRef.current[targetId] = Math.max(0, (dragCounterRef.current[targetId] || 1) - 1);
    if (dragCounterRef.current[targetId] === 0 && dragOverNodeId === targetId) {
      setDragOverNodeId(null);
      setDragOverSubtreeId(null);
      clearDragExpandTimer();
    }
  };

  const handleNodeDragOver = (e: React.DragEvent, nodeId?: string) => {
    const isExternal = isExternalFileDrag(e.dataTransfer);
    const isInternal = isInternalNodeDrag(e.dataTransfer);
    if (!isExternal && !isInternal) return;

    // For internal drag, prevent dropping onto itself or its descendants
    if (isInternal && draggingNodeIds.size > 0 && nodeId) {
      const node = nodeMap.get(nodeId);
      const targetFolderId = node?.type === "folder" ? node.id : node?.parent_id ?? null;
      if (wouldCreateCycle(draggingNodeIds, targetFolderId) || draggingNodeIds.has(nodeId)) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = isInternal ? "move" : "copy";
  };

  const handleNodeDrop = (e: React.DragEvent, nodeId: string | null) => {
    const isExternal = isExternalFileDrag(e.dataTransfer);
    const isInternal = isInternalNodeDrag(e.dataTransfer);
    if (!isExternal && !isInternal) return;

    e.preventDefault();
    e.stopPropagation();
    clearDragExpandTimer();
    dragCounterRef.current = {};
    setDragOverNodeId(null);
    setDragOverSubtreeId(null);

    // Get the target folder (for files, use parent folder)
    const targetFolderId = nodeId ? getDropTargetFolderId(nodeId) : null;

    if (isInternal && draggingNodeIds.size > 0) {
      // Internal move
      if (wouldCreateCycle(draggingNodeIds, targetFolderId)) {
        setDraggingNodeIds(new Set());
        return;
      }
      // Filter out nodes that are already in the target folder
      const nodesToMove = Array.from(draggingNodeIds).filter(id => {
        const node = nodeMap.get(id);
        return node && node.parent_id !== targetFolderId;
      });
      if (nodesToMove.length === 0) {
        setDraggingNodeIds(new Set());
        return;
      }
      // Expand the target folder
      if (targetFolderId) {
        setExpandedFolders(prev => new Set(prev).add(targetFolderId));
      }
      onMoveNodes?.(nodesToMove, targetFolderId);
      setDraggingNodeIds(new Set());
    } else if (isExternal && onDropFiles) {
      // External file drop
      if (targetFolderId) {
        setExpandedFolders(prev => new Set(prev).add(targetFolderId));
      }
      onDropFiles(e.dataTransfer, targetFolderId);
    }
  };

  const handleDragEnd = () => {
    setDraggingNodeIds(new Set());
    setDragOverNodeId(null);
    setDragOverSubtreeId(null);
    clearDragExpandTimer();
    dragCounterRef.current = {};
  };

  // Reset drag state when drag leaves the tree entirely
  const handleTreeDragLeave = (e: React.DragEvent) => {
    const isExternal = isExternalFileDrag(e.dataTransfer);
    const isInternal = isInternalNodeDrag(e.dataTransfer);
    if (!isExternal && !isInternal) return;
    // Only reset if leaving the tree container itself
    const rect = treeScrollRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX, clientY } = e;
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        clearDragExpandTimer();
        dragCounterRef.current = {};
        setDragOverNodeId(null);
        setDragOverSubtreeId(null);
      }
    }
  };

  // Handle header button clicks - use selected folder as parent
  const handleHeaderNewFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    const parentId = getSelectedParentId();
    if (parentId) {
      setExpandedFolders(prev => new Set(prev).add(parentId));
    }
    setEditingState({ type: "create", nodeType: "file", parentId });
  };

  const handleHeaderNewFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    const parentId = getSelectedParentId();
    if (parentId) {
      setExpandedFolders(prev => new Set(prev).add(parentId));
    }
    setEditingState({ type: "create", nodeType: "folder", parentId });
  };

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setDropdownMenu({
      type: "more",
      x: rect.left,
      y: rect.bottom + 4,
    });
  };

  const handleDropdownAction = (action: string) => {
    const parentId = getSelectedParentId();

    switch (action) {
      case "new_note":
        onNewNote?.();
        break;
      case "share":
        onShare?.();
        break;
      case "upload_files":
        onUploadFiles?.(parentId);
        break;
      case "upload_folder":
        onUploadFolder?.(parentId);
        break;
      case "download":
        if (selectedNodeIds.size > 0) {
          onDownload?.(Array.from(selectedNodeIds));
        } else {
          onDownload?.([]);
        }
        break;
    }
    setDropdownMenu(null);
  };

  const renderRow = (row: VisibleRow) => {
    if (row.kind === "create") {
      const isCreatingFolder = row.nodeType === "folder";
      const IconComponent = isCreatingFolder ? FileIcons.Folder : FileIcons.Plain;
      const editPaddingLeft = row.depth * 16 + (isCreatingFolder ? 4 : 22);
      return (
        <div className="relative h-full">
          <div
            className="flex items-center gap-1 px-2 py-0 text-[14px] leading-5 h-full"
            style={{ paddingLeft: `${editPaddingLeft}px` }}
          >
            {isCreatingFolder && (
              <ChevronIcon isOpen={false} className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            )}
            <IconComponent
              className={`w-4 h-4 flex-shrink-0 ${isCreatingFolder ? "text-zinc-500" : ""}`}
            />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              className={`bg-white text-zinc-900 border rounded px-1.5 py-[3px] text-[14px] leading-5 w-full outline-none min-w-0 ${
                validationError ? "border-red-400" : "border-blue-500 ring-1 ring-blue-500"
              }`}
              onBlur={handleInputBlur}
              onKeyDown={handleKeyDown}
            />
          </div>
          {validationError && (
            <div
              className="absolute left-0 top-full z-20 mt-1 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600"
              style={{ marginLeft: `${row.depth * 16 + 22}px` }}
            >
              <span className="font-bold">{validationError}</span> というファイルまたはフォルダーはこの場所に既に存在します。別の名前を指定してください。
            </div>
          )}
        </div>
      );
    }

    const node = row.node;
    const depth = row.depth;
    const isRenaming = editingState?.type === "rename" && editingState.targetId === node.id;

    if (isRenaming) {
      const IconComponent = node.type === "file" ? getFileIcon(node.name) : FileIcons.Folder;
      return (
        <div className="relative h-full">
          <div
            className="flex items-center gap-1 px-2 py-0 text-[14px] leading-5 h-full"
            style={{ paddingLeft: `${depth * 16 + (node.type === "folder" ? 4 : 22)}px` }}
          >
            {node.type === "folder" && (
              <ChevronIcon isOpen={expandedFolders.has(node.id)} className="w-4 h-4 text-zinc-400" />
            )}
            <IconComponent className={`w-4 h-4 flex-shrink-0 ${node.type === "folder" ? getFolderColor(node.name) : ""}`} />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              className={`bg-white text-zinc-900 border rounded px-1.5 py-[3px] text-[14px] leading-5 w-full outline-none min-w-0 ${
                validationError ? "border-red-400" : "border-blue-500 ring-1 ring-blue-500"
              }`}
              onBlur={handleInputBlur}
              onKeyDown={handleKeyDown}
            />
          </div>
          {validationError && (
            <div
              className="absolute left-0 top-full z-20 mt-1 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600"
              style={{ marginLeft: `${depth * 16 + 22}px` }}
            >
              <span className="font-bold">{validationError}</span> というファイルまたはフォルダーはこの場所に既に存在します。別の名前を指定してください。
            </div>
          )}
        </div>
      );
    }

    const isExpanded = expandedFolders.has(node.id);
    const isSelected = selectedNodeIds.has(node.id);
    const isBeingDragged = draggingNodeIds.has(node.id);
    const isCut = clipboard?.operation === "cut" && clipboard.nodeIds.includes(node.id);
    const isRootDragOver = dragOverNodeId === "root";
    const isDragOver = !isRootDragOver && dragOverNodeId === node.id;
    const isDragOverSubtree =
      !isRootDragOver &&
      dragOverSubtreeId !== null &&
      isNodeInSubtree(node.id, dragOverSubtreeId);
    const FileIcon = getFileIcon(node.name);

    return (
      <div
        draggable
        data-node-id={node.id}
        onDragStart={(e) => {
          // Set node data for chat panel drops
          const dragData = {
            id: node.id,
            name: node.name,
            type: node.type,
          };
          e.dataTransfer.setData("application/cursor-node", node.id);
          e.dataTransfer.effectAllowed = "move";
          // If the dragged node is selected, drag all selected nodes
          // Otherwise, drag only this node
          const dragCount = selectedNodeIds.has(node.id) && selectedNodeIds.size > 1
            ? selectedNodeIds.size
            : 1;

          // Set data for all dragged nodes (for chat panel)
          if (dragCount > 1) {
            const allDragData = Array.from(selectedNodeIds).map(id => {
              const n = nodeMap.get(id);
              return n ? { id: n.id, name: n.name, type: n.type } : null;
            }).filter(Boolean);
            e.dataTransfer.setData("application/cursor-node-data", JSON.stringify(allDragData));
            setDraggingNodeIds(new Set(selectedNodeIds));
          } else {
            e.dataTransfer.setData("application/cursor-node-data", JSON.stringify([dragData]));
            setDraggingNodeIds(new Set([node.id]));
          }

          // Create custom drag preview
          if (dragPreviewRef.current) {
            const preview = dragPreviewRef.current;
            if (dragCount === 1) {
              // Single file: show filename in pill (blue border)
              preview.innerHTML = `<span style="
                display: inline-block;
                padding: 4px 12px;
                background: white;
                border: 1.5px solid #93c5fd;
                border-radius: 9999px;
                font-size: 13px;
                color: #374151;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 180px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
              ">${node.name}</span>`;
            } else {
              // Multiple files: show count in circle
              preview.innerHTML = `<span style="
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                background: white;
                border: 1.5px solid #a5b4fc;
                border-radius: 50%;
                font-size: 13px;
                color: #6366f1;
                font-weight: 500;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
              ">${dragCount}</span>`;
            }
            e.dataTransfer.setDragImage(preview, preview.offsetWidth / 2, preview.offsetHeight / 2);
          }
        }}
        onDragEnd={handleDragEnd}
        onDragEnter={(e) => handleNodeDragEnter(e, node.id)}
        onDragLeave={(e) => handleNodeDragLeave(e, node.id)}
        onDragOver={(e) => handleNodeDragOver(e, node.id)}
        onDrop={(e) => handleNodeDrop(e, node.id)}
        className={`
          group/item flex items-center gap-1 px-2 py-1 text-[14px] leading-5 cursor-pointer select-none h-full
          transition-colors duration-75
          ${isBeingDragged || isCut
            ? "opacity-50"
            : isDragOver || isDragOverSubtree
              ? "bg-green-600/10 text-zinc-900"
              : isSelected
                ? "bg-blue-600/10 text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100"
          }
        `}
        style={{ paddingLeft: `${depth * 16 + (node.type === "folder" ? 4 : 22)}px` }}
        onMouseEnter={() => {
          if (node.type === "file") {
            onHoverNode?.(node.id);
          }
        }}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            onToggleSelectNode(node.id);
            return;
          }
          if (node.type === "folder") {
            toggleFolder(node.id);
            onSelectFolder?.(node.id);
          } else {
            onSelectNode(node.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY, targetId: node.id });
        }}
      >
        {node.type === "folder" ? (
          <>
            <ChevronIcon isOpen={isExpanded} className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            {isExpanded ? (
              <FileIcons.FolderOpen className={`w-4 h-4 flex-shrink-0 ${getFolderColor(node.name)}`} />
            ) : (
              <FileIcons.Folder className={`w-4 h-4 flex-shrink-0 ${getFolderColor(node.name)}`} />
            )}
          </>
        ) : (
          <FileIcon className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="truncate flex-1">{node.name}</span>
      </div>
    );
  };

  return (
    <div
      className="flex-1 flex flex-col min-h-0 text-zinc-700"
      onClick={(e) => {
        setContextMenu(null);
        setDropdownMenu(null);
        if (e.target === e.currentTarget) {
          onClearSelection();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, targetId: null });
      }}
    >
      {/* Project name header */}
      {projectName && (
        <div className="group flex items-center px-3 py-2 border-b border-zinc-200 gap-0.5 relative">
          {/* Workspace trigger area (icon + name) */}
          <div ref={workspaceTriggerRef} className="flex items-center min-w-0 flex-1">
            {/* Workspace icon with first character */}
            <div
              className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center flex-shrink-0 mr-1.5 cursor-pointer hover:bg-blue-200 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setIsWorkspacePopoverOpen(!isWorkspacePopoverOpen);
              }}
            >
              <span className="text-sm font-bold text-blue-600">
                {(isEditingWorkspaceName ? workspaceNameValue : projectName).charAt(0).toUpperCase()}
              </span>
            </div>
            {isEditingWorkspaceName ? (
              <input
                ref={workspaceNameInputRef}
                type="text"
                value={workspaceNameValue}
                onChange={(e) => setWorkspaceNameValue(e.target.value)}
                onKeyDown={handleWorkspaceNameKeyDown}
                onBlur={handleWorkspaceNameComplete}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 px-1.5 py-0.5 text-base font-semibold text-zinc-800 border border-blue-500 rounded outline-none bg-white"
              />
            ) : (
              <div
                className="flex items-center min-w-0 flex-1 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsWorkspacePopoverOpen(!isWorkspacePopoverOpen);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditingWorkspaceName();
                }}
              >
                <span className="text-base font-semibold text-zinc-800 truncate min-w-[24px]">
                  {projectName}
                </span>
                <ChevronIcon isOpen={isWorkspacePopoverOpen} className="w-4 h-4 text-zinc-400 flex-shrink-0 ml-1" />
              </div>
            )}
          </div>

          {/* Workspace Switcher Popover */}
          {isWorkspacePopoverOpen && (
            <div
              ref={workspacePopoverRef}
              className="absolute top-full left-2 mt-1 w-72 bg-white rounded-lg shadow-lg border border-zinc-200 z-50 py-2"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Current workspace header */}
              <div className="px-3 py-2 border-b border-zinc-100">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-base font-bold text-blue-600">
                      {projectName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-base font-semibold text-zinc-800 truncate">
                    {projectName}
                  </span>
                </div>
              </div>

              {/* Workspace list */}
              <div className="py-1">
                {workspaces && workspaces.length > 0 ? (
                  workspaces.map((ws) => (
                    <div
                      key={ws.id}
                      className="w-full px-3 py-2 hover:bg-zinc-50 flex items-center group/wsitem"
                    >
                      <button
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        onClick={() => {
                          onSelectWorkspace?.(ws.id);
                          setIsWorkspacePopoverOpen(false);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setWsContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            workspaceId: ws.id,
                            workspaceName: ws.name,
                          });
                        }}
                      >
                        <div className="w-6 h-6 rounded bg-zinc-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-zinc-600">
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-zinc-700 truncate">{ws.name}</span>
                      </button>
                      {/* 右寄せのコンテナ */}
                      <div className="flex items-center gap-1 ml-auto">
                        {ws.id === activeWorkspaceId && (
                          <svg className="w-4 h-4 text-zinc-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {/* 縦3点メニュー */}
                        <button
                          className="p-1 rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-600 flex-shrink-0 opacity-0 group-hover/wsitem:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setWsContextMenu({
                              x: rect.left,
                              y: rect.bottom + 4,
                              workspaceId: ws.id,
                              workspaceName: ws.name,
                            });
                          }}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-2 text-sm text-zinc-400">
                    ワークスペースがありません
                  </div>
                )}

                {/* Create new workspace button */}
                <button
                  className="w-full px-3 py-2 text-left hover:bg-zinc-50 flex items-center gap-2 text-blue-600"
                  onClick={() => {
                    onCreateWorkspace?.();
                    setIsWorkspacePopoverOpen(false);
                  }}
                >
                  <span className="w-6 h-6 flex items-center justify-center text-lg">+</span>
                  <span className="text-sm font-medium">新しいワークスペース</span>
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center flex-shrink-0 ml-auto -mr-0.5">
            <button
              onClick={handleHeaderNewFile}
              className="p-0.5 rounded text-zinc-700 hover:text-zinc-900 bg-transparent hover:bg-transparent"
              title="新規ファイル"
            >
              <ActionIcons.FilePlus className="w-5 h-5" />
            </button>
            <button
              onClick={handleHeaderNewFolder}
              className="p-0.5 rounded text-zinc-700 hover:text-zinc-900 bg-transparent hover:bg-transparent ml-1"
              title="新規フォルダ"
            >
              <ActionIcons.FolderPlus className="w-5 h-5" />
            </button>
            <button
              onClick={handleMoreClick}
              className="p-0.5 rounded text-zinc-700 hover:text-zinc-900 bg-transparent hover:bg-transparent -mr-2"
              title="その他"
            >
              <ActionIcons.More className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Dropdown menu */}
      {dropdownMenu && (
        <div
          ref={dropdownRef}
          className="fixed bg-white border border-zinc-200 rounded-lg shadow-lg py-1 z-50 min-w-[180px]"
          style={{ left: dropdownMenu.x, top: dropdownMenu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => handleDropdownAction("new_note")}
          >
            <ActionIcons.Note className="w-4 h-4" />
            新規ノート
          </button>
          <div className="border-t border-zinc-200 my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => handleDropdownAction("share")}
          >
            <ActionIcons.Share className="w-4 h-4" />
            共有
          </button>
          <div className="border-t border-zinc-200 my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => handleDropdownAction("upload_files")}
          >
            <ActionIcons.Upload className="w-4 h-4" />
            ファイルをアップロード
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => handleDropdownAction("upload_folder")}
          >
            <ActionIcons.FolderUpload className="w-4 h-4" />
            フォルダをアップロード
          </button>
          <div className="border-t border-zinc-200 my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => handleDropdownAction("download")}
          >
            <ActionIcons.Download className="w-4 h-4" />
            {selectedNodeIds.size > 0 ? "選択項目をダウンロード" : "すべてダウンロード"}
          </button>
          <div className="border-t border-zinc-200 my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => startEditingWorkspaceName()}
          >
            <ActionIcons.Rename className="w-4 h-4" />
            ワークスペース名を変更
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => {
              setDropdownMenu(null);
              onDeleteWorkspace?.();
            }}
          >
            <ActionIcons.Trash className="w-4 h-4" />
            ワークスペースを削除
          </button>
        </div>
      )}

      {/* File tree content */}
      <div
        className={`flex-1 overflow-y-auto py-1 transition-colors duration-75 ${
          dragOverNodeId === "root" ? "bg-green-600/10" : ""
        }`}
        ref={treeScrollRef}
        onScroll={handleScroll}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClearSelection();
          }
        }}
        onDragEnter={(e) => {
          const isExternal = isExternalFileDrag(e.dataTransfer);
          const isInternal = isInternalNodeDrag(e.dataTransfer);
          if (!isExternal && !isInternal) return;
          e.preventDefault();
          dragCounterRef.current["root"] = (dragCounterRef.current["root"] || 0) + 1;
          // Only set root as target if not hovering over a specific folder
          if (!dragOverNodeId || dragOverNodeId === "root") {
            setDragOverNodeId("root");
            setDragOverSubtreeId(null);
          }
        }}
        onDragLeave={(e) => {
          const isExternal = isExternalFileDrag(e.dataTransfer);
          const isInternal = isInternalNodeDrag(e.dataTransfer);
          if (!isExternal && !isInternal) return;
          e.preventDefault();
          dragCounterRef.current["root"] = Math.max(0, (dragCounterRef.current["root"] || 1) - 1);
          if (dragCounterRef.current["root"] === 0 && dragOverNodeId === "root") {
            setDragOverNodeId(null);
            setDragOverSubtreeId(null);
          }
        }}
        onDragOver={(e) => {
          const isExternal = isExternalFileDrag(e.dataTransfer);
          const isInternal = isInternalNodeDrag(e.dataTransfer);
          if (!isExternal && !isInternal) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = isInternal ? "move" : "copy";
          if (e.target === e.currentTarget) {
            setDragOverNodeId("root");
            setDragOverSubtreeId(null);
          }
        }}
        onDrop={(e) => {
          const isExternal = isExternalFileDrag(e.dataTransfer);
          const isInternal = isInternalNodeDrag(e.dataTransfer);
          if (!isExternal && !isInternal) return;
          e.preventDefault();
          clearDragExpandTimer();
          dragCounterRef.current = {};
          // Get the target folder (for files, use parent folder)
          let targetFolderId: string | null = null;
          if (dragOverNodeId && dragOverNodeId !== "root") {
            targetFolderId = getDropTargetFolderId(dragOverNodeId);
          }
          setDragOverNodeId(null);
          setDragOverSubtreeId(null);

          if (isInternal && draggingNodeIds.size > 0) {
            // Internal move to root
            const nodesToMove = Array.from(draggingNodeIds).filter(id => {
              const node = nodeMap.get(id);
              return node && node.parent_id !== targetFolderId;
            });
            if (nodesToMove.length > 0) {
              onMoveNodes?.(nodesToMove, targetFolderId);
            }
            setDraggingNodeIds(new Set());
          } else if (isExternal && onDropFiles) {
            if (targetFolderId) {
              setExpandedFolders(prev => new Set(prev).add(targetFolderId!));
            }
            onDropFiles(e.dataTransfer, targetFolderId);
          }
        }}
      >
        {(!projectName || isProjectExpanded) && (
          isLoading ? (
            <FileTreeSkeleton />
          ) : nodes.length === 0 && !editingState ? (
            <div className="text-zinc-400 text-sm p-4 text-center">
              ファイルがありません<br/>右クリックで作成
            </div>
          ) : (
            <div
              className="relative"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  onClearSelection();
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, targetId: null });
              }}
            >
              <div
                style={{ height: topPadding }}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearSelection();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ x: e.clientX, y: e.clientY, targetId: null });
                }}
              />
              {visibleSlice.map((row) => (
                <div
                  key={
                    row.kind === "node"
                      ? row.node.id
                      : `create:${row.parentId ?? "root"}:${row.nodeType}`
                  }
                  style={{ height: ROW_HEIGHT }}
                  className="relative"
                >
                  {renderRow(row)}
                </div>
              ))}
              <div
                style={{ height: bottomPadding }}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearSelection();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ x: e.clientX, y: e.clientY, targetId: null });
                }}
              />
              <div
                className="flex-1 cursor-pointer"
                style={{ height: BOTTOM_GAP }}
                onClick={(e) => {
                  e.stopPropagation();
                  onClearSelection();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ x: e.clientX, y: e.clientY, targetId: null });
                }}
              />
            </div>
          )
        )}
      </div>

      <div
        className="border-t border-zinc-200 px-2 py-2 bg-zinc-50"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <AccountMenu
          userEmail={userEmail}
          displayName={userName}
          planName={planName}
          onOpenSettings={onOpenSettings}
        />
      </div>

      {contextMenu && (() => {
        const targetNode = contextMenu.targetId ? nodeMap.get(contextMenu.targetId) : null;
        const isFile = targetNode?.type === "file";
        const hasClipboard = clipboard && clipboard.nodeIds.length > 0;

        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              // Show create/upload options only for folders or empty space
              ...(!isFile ? [
                { label: "新規ファイル", icon: <ActionIcons.FilePlus className="w-4 h-4" />, action: () => handleContextMenuAction("new_file") },
                { label: "新規フォルダ", icon: <ActionIcons.FolderPlus className="w-4 h-4" />, action: () => handleContextMenuAction("new_folder") },
                { label: "新規ノート", icon: <ActionIcons.Note className="w-4 h-4" />, action: () => handleContextMenuAction("new_note") },
                { separator: true, label: "", action: () => {} },
                { label: "共有", icon: <ActionIcons.Share className="w-4 h-4" />, action: () => handleContextMenuAction("share") },
                { separator: true, label: "", action: () => {} },
                { label: "ファイルをアップロード", icon: <ActionIcons.Upload className="w-4 h-4" />, action: () => handleContextMenuAction("upload_files") },
                { label: "フォルダをアップロード", icon: <ActionIcons.FolderUpload className="w-4 h-4" />, action: () => handleContextMenuAction("upload_folder") },
                { separator: true, label: "", action: () => {} },
              ] : []),
              // Show share for files at the top (for folders it's already in the block above)
              ...(isFile ? [
                { label: "共有", icon: <ActionIcons.Share className="w-4 h-4" />, action: () => handleContextMenuAction("share") },
                { separator: true, label: "", action: () => {} },
              ] : []),
              { label: selectedNodeIds.size > 0 || contextMenu.targetId ? "選択項目をダウンロード" : "すべてダウンロード", icon: <ActionIcons.Download className="w-4 h-4" />, action: () => handleContextMenuAction("download") },
              ...(contextMenu.targetId ? [
                { separator: true, label: "", action: () => {} },
                { label: "切り取り", icon: <ActionIcons.Cut className="w-4 h-4" />, action: () => handleContextMenuAction("cut") },
                { label: "コピー", icon: <ActionIcons.Copy className="w-4 h-4" />, action: () => handleContextMenuAction("copy") },
              ] : []),
              // Show paste only for folders or empty space, and when clipboard has content
              ...(!isFile && hasClipboard ? [
                { label: "貼り付け", icon: <ActionIcons.Paste className="w-4 h-4" />, action: () => handleContextMenuAction("paste") },
              ] : []),
              ...(contextMenu.targetId ? [
                { separator: true, label: "", action: () => {} },
                { label: "名前を変更", icon: <ActionIcons.Rename className="w-4 h-4" />, action: () => handleContextMenuAction("rename") },
                { label: "削除", icon: <ActionIcons.Trash className="w-4 h-4" />, action: () => handleContextMenuAction("delete"), danger: true },
              ] : [
                // Workspace actions when no file/folder is selected
                { separator: true, label: "", action: () => {} },
                { label: "ワークスペース名を変更", icon: <ActionIcons.Rename className="w-4 h-4" />, action: () => { setContextMenu(null); startEditingWorkspaceName(); } },
                { label: "ワークスペースを削除", icon: <ActionIcons.Trash className="w-4 h-4" />, action: () => { setContextMenu(null); onDeleteWorkspace?.(); }, danger: true },
              ])
            ]}
          />
        );
      })()}

      {/* Workspace context menu */}
      {wsContextMenu && (
        <ContextMenu
          x={wsContextMenu.x}
          y={wsContextMenu.y}
          onClose={() => setWsContextMenu(null)}
          items={[
            {
              label: "共有",
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              ),
              action: () => {
                onShareWorkspace?.(wsContextMenu.workspaceId);
              },
            },
            {
              label: "ワークスペース名を変更",
              icon: <ActionIcons.Rename className="w-4 h-4" />,
              action: () => {
                onRenameWorkspaceById?.(wsContextMenu.workspaceId, wsContextMenu.workspaceName);
              },
            },
            { separator: true, label: "", action: () => {} },
            {
              label: "ワークスペースを削除",
              icon: <ActionIcons.Trash className="w-4 h-4" />,
              action: () => {
                onDeleteWorkspaceById?.(wsContextMenu.workspaceId, wsContextMenu.workspaceName);
              },
              danger: true,
            },
          ]}
        />
      )}

      {/* Hidden drag preview element */}
      <div
        ref={dragPreviewRef}
        style={{
          position: "fixed",
          top: -1000,
          left: -1000,
          pointerEvents: "none",
          zIndex: -1,
        }}
      />
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ContextMenu } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { ActionIcons, ChevronIcon, FileIcons, getFileIcon, getFolderColor } from "./fileIcons";
import { AccountMenu } from "./AccountMenu";

type Node = {
  id: string;
  parent_id: string | null;
  type: "file" | "folder";
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
  onDeleteNode: (id: string) => void;
  onUploadFiles?: (parentId: string | null) => void;
  onUploadFolder?: (parentId: string | null) => void;
  onDownload?: (nodeIds: string[]) => void;
  onDropFiles?: (dataTransfer: DataTransfer, targetFolderId: string | null) => void;
  onMoveNodes?: (nodeIds: string[], newParentId: string | null) => void;
  projectName?: string;
  userEmail?: string;
  userName?: string;
  planName?: string;
  onOpenSettings?: () => void;
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
  onDeleteNode,
  onUploadFiles,
  onUploadFolder,
  onDownload,
  onDropFiles,
  onMoveNodes,
  projectName,
  userEmail,
  userName,
  planName,
  onOpenSettings,
}: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetId: string | null;
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

  // Delete confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    targetId: string | null;
    targetName: string;
  }>({
    isOpen: false,
    targetId: null,
    targetName: "",
  });

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  useEffect(() => {
    if (!revealNodeId) return;
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
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const container = treeScrollRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(`[data-node-id="${revealNodeId}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest" });
        return;
      }
      if (attempts < 6) {
        attempts += 1;
        requestAnimationFrame(tryScroll);
      }
    };
    requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [revealNodeId, nodeMap]);

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

    return nodes.some(n =>
      n.parent_id === parentId &&
      n.name.toLowerCase() === trimmedName &&
      n.id !== excludeId
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
    if (editingState && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      setInputValue(editingState.initialValue || "");
      setValidationError(null);
    }
  }, [editingState]);

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
      setValidationError(`A file or folder with this name already exists in this location.`);
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
      case "upload_files":
        onUploadFiles?.(parentId);
        break;
      case "upload_folder":
        onUploadFolder?.(parentId);
        break;
      case "download":
        if (targetId) {
          onDownload?.([targetId]);
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
          setConfirmDialog({
            isOpen: true,
            targetId,
            targetName: targetNode.name,
          });
        }
        break;
    }
  };

  const handleDeleteConfirm = () => {
    if (confirmDialog.targetId) {
      onDeleteNode(confirmDialog.targetId);
    }
    setConfirmDialog({ isOpen: false, targetId: null, targetName: "" });
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

  const renderTree = (parentId: string | null, depth: number = 0) => {
    const currentLevelNodes = nodes
      .filter((n) => n.parent_id === parentId)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const nodesToRender = [...currentLevelNodes];
    let editItem = null;
    const isCreatingFile =
      editingState?.type === "create" &&
      editingState.parentId === parentId &&
      editingState.nodeType === "file";
    const isCreatingFolder =
      editingState?.type === "create" &&
      editingState.parentId === parentId &&
      editingState.nodeType === "folder";

    if (editingState && editingState.type === "create" && editingState.parentId === parentId) {
      const IconComponent = isCreatingFile ? FileIcons.Plain : FileIcons.Folder;
      const editPaddingLeft = depth * 16 + (isCreatingFolder ? 4 : 22);
      editItem = (
        <div
          key="editing-item"
          className="relative"
        >
          <div
            className="flex items-center gap-1 px-2 py-0 text-[14px] leading-5"
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
              placeholder={editingState.nodeType === "file" ? "filename" : "folder name"}
            />
          </div>
          {validationError && (
            <div
              className="mt-1 mx-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600"
              style={{ marginLeft: `${depth * 16 + 22}px` }}
            >
              {validationError}
            </div>
          )}
        </div>
      );
    }

    const renderNode = (node: Node) => {
      const isRenaming = editingState?.type === "rename" && editingState.targetId === node.id;

      if (isRenaming) {
        const IconComponent = node.type === "file" ? getFileIcon(node.name) : FileIcons.Folder;
        return (
          <div
            key={node.id}
            className="relative"
          >
            <div
              className="flex items-center gap-1 px-2 py-0 text-[14px] leading-5"
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
                className="mt-1 mx-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600"
                style={{ marginLeft: `${depth * 16 + 22}px` }}
              >
                {validationError}
              </div>
            )}
          </div>
        );
      }

      const isExpanded = expandedFolders.has(node.id);
      const isSelected = selectedNodeIds.has(node.id);
      const isBeingDragged = draggingNodeIds.has(node.id);
      const isRootDragOver = dragOverNodeId === "root";
      const isDragOver = !isRootDragOver && dragOverNodeId === node.id;
      const isDragOverSubtree =
        !isRootDragOver &&
        dragOverSubtreeId !== null &&
        isNodeInSubtree(node.id, dragOverSubtreeId);
      const FileIcon = getFileIcon(node.name);

      return (
        <div key={node.id}>
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
              group/item flex items-center gap-1 px-2 py-1 text-[14px] leading-5 cursor-pointer select-none
              transition-colors duration-75
              ${isBeingDragged
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

          {node.type === "folder" && isExpanded && renderTree(node.id, depth + 1)}
        </div>
      );
    };

    const folderNodes = nodesToRender.filter((node) => node.type === "folder");
    const fileNodes = nodesToRender.filter((node) => node.type === "file");

    return (
      <>
        {editItem && isCreatingFolder ? editItem : null}
        {folderNodes.map(renderNode)}
        {editItem && isCreatingFile ? editItem : null}
        {fileNodes.map(renderNode)}
      </>
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
      {/* Project name header - Cursor style */}
      {projectName && (
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-100 border-b border-zinc-200"
          onClick={() => setIsProjectExpanded(!isProjectExpanded)}
        >
          <div className="flex items-center gap-1 min-w-0">
            <ChevronIcon isOpen={isProjectExpanded} className="w-4 h-4 text-zinc-500" />
            <span className="text-[12px] font-semibold text-zinc-700 uppercase tracking-wide truncate">
              {projectName}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleHeaderNewFile}
              className="p-1 rounded text-zinc-700 hover:text-zinc-900 bg-transparent hover:bg-transparent"
              title="New File"
            >
              <ActionIcons.FilePlus className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={handleHeaderNewFolder}
              className="p-1 rounded text-zinc-700 hover:text-zinc-900 bg-transparent hover:bg-transparent"
              title="New Folder"
            >
              <ActionIcons.FolderPlus className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={handleMoreClick}
              className="p-1 rounded text-zinc-700 hover:text-zinc-900 bg-transparent hover:bg-transparent"
              title="More Actions"
            >
              <ActionIcons.More className="w-[18px] h-[18px]" />
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
            onClick={() => handleDropdownAction("upload_files")}
          >
            <ActionIcons.Upload className="w-4 h-4" />
            Upload Files
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => handleDropdownAction("upload_folder")}
          >
            <ActionIcons.FolderUpload className="w-4 h-4" />
            Upload Folder
          </button>
          <div className="border-t border-zinc-200 my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 flex items-center gap-2"
            onClick={() => handleDropdownAction("download")}
          >
            <ActionIcons.Download className="w-4 h-4" />
            {selectedNodeIds.size > 0 ? "Download Selected" : "Download All"}
          </button>
        </div>
      )}

      {/* File tree content */}
      <div
        className={`flex-1 overflow-y-auto py-1 transition-colors duration-75 ${
          dragOverNodeId === "root" ? "bg-green-600/10" : ""
        }`}
        ref={treeScrollRef}
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
          nodes.length === 0 && !editingState ? (
            <div className="text-zinc-400 text-sm p-4 text-center">
              No files.<br/>Right click to create.
            </div>
          ) : (
            <>
              {renderTree(null)}
              {/* Clickable gap at bottom to clear selection */}
              <div
                className="min-h-[40px] cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearSelection();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              />
            </>
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: "New File", action: () => handleContextMenuAction("new_file") },
            { label: "New Folder", action: () => handleContextMenuAction("new_folder") },
            { separator: true, label: "", action: () => {} },
            { label: "Upload Files", action: () => handleContextMenuAction("upload_files") },
            { label: "Upload Folder", action: () => handleContextMenuAction("upload_folder") },
            { separator: true, label: "", action: () => {} },
            { label: "Download", action: () => handleContextMenuAction("download") },
            ...(contextMenu.targetId ? [
              { separator: true, label: "", action: () => {} },
              { label: "Rename", action: () => handleContextMenuAction("rename") },
              { label: "Delete", action: () => handleContextMenuAction("delete"), danger: true },
            ] : [])
          ]}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title="Delete File?"
        message={`Are you sure you want to delete '${confirmDialog.targetName}'? This action cannot be undone.`}
        confirmLabel="Delete"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDialog({ isOpen: false, targetId: null, targetName: "" })}
      />

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

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ContextMenu } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { ActionIcons, ChevronIcon, FileIcons, getFileIcon, getFolderColor } from "./fileIcons";

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
  onSelectFolder?: (nodeId: string) => void;
  onCreateFile: (path: string, parentId: string | null) => void;
  onCreateFolder: (path: string, parentId: string | null) => void;
  onRenameNode: (id: string, newName: string) => void;
  onDeleteNode: (id: string) => void;
  onUploadFiles?: (parentId: string | null) => void;
  onUploadFolder?: (parentId: string | null) => void;
  onDownload?: (nodeIds: string[]) => void;
  projectName?: string;
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
  onSelectFolder,
  onCreateFile,
  onCreateFolder,
  onRenameNode,
  onDeleteNode,
  onUploadFiles,
  onUploadFolder,
  onDownload,
  projectName,
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
  const [isProjectExpanded, setIsProjectExpanded] = useState(true);
  const [dropdownMenu, setDropdownMenu] = useState<DropdownMenu>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      const FileIcon = getFileIcon(node.name);

      return (
        <div key={node.id}>
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/cursor-node", node.name);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className={`
              group/item flex items-center gap-1 px-2 py-1 text-[14px] leading-5 cursor-pointer select-none
              ${isSelected
                ? "bg-blue-600/10 text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100"
              }
            `}
            style={{ paddingLeft: `${depth * 16 + (node.type === "folder" ? 4 : 22)}px` }}
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
        className="flex-1 overflow-y-auto py-1"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClearSelection();
          }
        }}
      >
        {(!projectName || isProjectExpanded) && (
          nodes.length === 0 && !editingState ? (
            <div className="text-zinc-400 text-sm p-4 text-center">
              No files.<br/>Right click to create.
            </div>
          ) : (
            renderTree(null)
          )
        )}
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
    </div>
  );
}

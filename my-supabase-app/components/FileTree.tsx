"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ContextMenu } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";

// アイコン
const Icons = {
  File: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="12" y1="18" x2="12" y2="12"></line>
      <line x1="9" y1="15" x2="15" y2="15"></line>
    </svg>
  ),
  Folder: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
  ),
  FolderOpen: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      <line x1="2" y1="10" x2="22" y2="10"></line>
    </svg>
  ),
  FilePlus: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="12" y1="18" x2="12" y2="12"></line>
      <line x1="9" y1="15" x2="15" y2="15"></line>
    </svg>
  ),
  FolderPlus: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      <line x1="12" y1="11" x2="12" y2="17"></line>
      <line x1="9" y1="14" x2="15" y2="14"></line>
    </svg>
  ),
};

type Node = {
  id: string;
  parent_id: string | null;
  type: "file" | "folder";
  name: string;
};

type FileTreeProps = {
  nodes: Node[];
  activeNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onRenameNode: (id: string, newName: string) => void;
  onDeleteNode: (id: string) => void;
};

type EditingState = {
  type: "create" | "rename";
  nodeType: "file" | "folder";
  parentId: string | null;
  targetId?: string;
  initialValue?: string;
};

export function FileTree({
  nodes,
  activeNodeId,
  onSelectNode,
  onCreateFile,
  onCreateFolder,
  onRenameNode,
  onDeleteNode,
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

  // 削除確認ダイアログ用ステート
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
  
  const getNodePath = (nodeId: string | null): string => {
    if (!nodeId) return "";
    const node = nodeMap.get(nodeId);
    if (!node) return "";
    const parentPath = getNodePath(node.parent_id);
    return parentPath ? `${parentPath}/${node.name}` : node.name;
  };

  // 同じ親フォルダ内に同じ名前のノードが存在するかチェック
  const checkDuplicateName = (name: string, parentId: string | null, excludeId?: string): boolean => {
    const trimmedName = name.trim().toLowerCase();
    if (!trimmedName) return false;
    
    return nodes.some(n => 
      n.parent_id === parentId && 
      n.name.toLowerCase() === trimmedName &&
      n.id !== excludeId
    );
  };

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

    // リネーム時は自分自身を除外してチェック
    const excludeId = editingState.type === "rename" ? editingState.targetId : undefined;
    const isDuplicate = checkDuplicateName(trimmedValue, editingState.parentId, excludeId);
    
    if (isDuplicate) {
      setValidationError(`'${trimmedValue}' というファイルまたはフォルダーはこの場所に既に存在します。別の名前を指定してください。`);
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

    // バリデーションエラーがある場合は作成/リネームしない
    if (validationError) {
      return;
    }

    if (editingState.type === "create") {
      const parentPath = getNodePath(editingState.parentId);
      const fullPath = parentPath ? `${parentPath}/${value}` : value;
      if (editingState.nodeType === "file") {
        onCreateFile(fullPath);
      } else {
        onCreateFolder(fullPath);
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

  const handleContextMenuAction = (action: string) => {
    const targetId = contextMenu?.targetId || null;
    const targetNode = targetId ? nodeMap.get(targetId) : null;
    
    let parentId: string | null = null;
    if (targetNode) {
      if (targetNode.type === "folder") {
        parentId = targetNode.id;
        setExpandedFolders(prev => new Set(prev).add(targetNode.id));
      } else {
        parentId = targetNode.parent_id;
      }
    }

    switch (action) {
      case "new_file":
        setEditingState({ type: "create", nodeType: "file", parentId });
        break;
      case "new_folder":
        setEditingState({ type: "create", nodeType: "folder", parentId });
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
          // ConfirmDialogを表示
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

  const renderTree = (parentId: string | null, depth: number = 0) => {
    const currentLevelNodes = nodes
      .filter((n) => n.parent_id === parentId)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    let nodesToRender = [...currentLevelNodes];
    let editItem = null;

    if (editingState && editingState.type === "create" && editingState.parentId === parentId) {
      editItem = (
        <div 
          key="editing-item" 
          className="relative"
          style={{ "--depth": depth } as any}
        >
          <div className="flex items-center gap-1.5 px-2 py-1 text-sm pl-[calc(8px+12px*var(--depth))]">
            <span className="w-4 flex-shrink-0 text-center text-zinc-400">
              {editingState.nodeType === "file" ? <Icons.File className="w-3.5 h-3.5" /> : <Icons.Folder className="w-3.5 h-3.5" />}
            </span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              className={`bg-white text-zinc-900 border rounded px-1 py-0.5 text-sm w-full outline-none min-w-0 ${
                validationError ? "border-red-400" : "border-blue-400"
              }`}
              onBlur={handleInputBlur}
              onKeyDown={handleKeyDown}
            />
          </div>
          {validationError && (
            <div className="ml-[calc(8px+12px*var(--depth)+20px)] mr-2 mt-1 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 leading-relaxed">
              {validationError}
            </div>
          )}
        </div>
      );
    }

    return (
      <>
        {editItem && editingState?.nodeType === "folder" ? editItem : null}
        
        {nodesToRender.map(node => {
          const isRenaming = editingState?.type === "rename" && editingState.targetId === node.id;
          
          if (isRenaming) {
            return (
              <div 
                key={node.id}
                className="relative"
                style={{ "--depth": depth } as any}
              >
                <div className="flex items-center gap-1.5 px-2 py-1 text-sm pl-[calc(8px+12px*var(--depth))]">
                  <span className="w-4 flex-shrink-0 text-center text-zinc-400">
                    {node.type === "file" ? <Icons.File className="w-3.5 h-3.5" /> : <Icons.Folder className="w-3.5 h-3.5" />}
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    className={`bg-white text-zinc-900 border rounded px-1 py-0.5 text-sm w-full outline-none min-w-0 ${
                      validationError ? "border-red-400" : "border-blue-400"
                    }`}
                    onBlur={handleInputBlur}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                {validationError && (
                  <div className="ml-[calc(8px+12px*var(--depth)+20px)] mr-2 mt-1 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 leading-relaxed">
                    {validationError}
                  </div>
                )}
              </div>
            );
          }

          const isExpanded = expandedFolders.has(node.id);
          const isSelected = activeNodeId === node.id;

          const handleAddFile = (e: React.MouseEvent) => {
            e.stopPropagation();
            // フォルダを展開
            setExpandedFolders(prev => new Set(prev).add(node.id));
            setEditingState({ type: "create", nodeType: "file", parentId: node.id });
          };

          const handleAddFolder = (e: React.MouseEvent) => {
            e.stopPropagation();
            // フォルダを展開
            setExpandedFolders(prev => new Set(prev).add(node.id));
            setEditingState({ type: "create", nodeType: "folder", parentId: node.id });
          };

          return (
            <div key={node.id}>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/cursor-node", node.name);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className={`
                  group/item flex items-center gap-1.5 px-2 py-1 text-sm cursor-pointer select-none transition-colors
                  ${isSelected ? "bg-blue-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}
                `}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => {
                  if (node.type === "folder") {
                    toggleFolder(node.id);
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
                <span className="w-4 flex-shrink-0 text-center flex items-center justify-center">
                  {node.type === "folder" ? (
                    isExpanded ? <Icons.FolderOpen className="w-3.5 h-3.5 text-zinc-400" /> : <Icons.Folder className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <Icons.File className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </span>
                <span className="truncate flex-1">{node.name}</span>
                
                {/* フォルダの場合、ホバー時にアイコンボタンを表示 */}
                {node.type === "folder" && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
                    <button
                      onClick={handleAddFile}
                      className="p-0.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-700"
                      title="New File"
                    >
                      <Icons.FilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleAddFolder}
                      className="p-0.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-700"
                      title="New Folder"
                    >
                      <Icons.FolderPlus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              
              {node.type === "folder" && isExpanded && renderTree(node.id, depth + 1)}
            </div>
          );
        })}

        {editItem && editingState?.nodeType === "file" ? editItem : null}
      </>
    );
  };

  return (
    <div 
      className="flex-1 flex flex-col min-h-0" 
      onClick={() => setContextMenu(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, targetId: null });
      }}
    >
      <div className="p-3 border-b border-zinc-200 flex justify-between items-center bg-zinc-50 flex-shrink-0">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Explorer
        </h2>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-100">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setEditingState({ type: "create", nodeType: "file", parentId: null });
            }}
            className="p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-700"
            title="New File"
          >
            <Icons.FilePlus className="w-4 h-4" />
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setEditingState({ type: "create", nodeType: "folder", parentId: null });
            }}
            className="p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-700"
            title="New Folder"
          >
            <Icons.FolderPlus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2 group">
        {nodes.length === 0 && !editingState ? (
          <div className="text-zinc-400 text-sm p-4 text-center">
            No files.<br/>Right click to create.
          </div>
        ) : (
          renderTree(null)
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

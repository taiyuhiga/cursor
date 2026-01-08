"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ContextMenu } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";

// File type icons
const FileIcons = {
  // Folder icons
  Folder: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-6l-1-1.5H1.5z" fillOpacity="0.8" />
    </svg>
  ),
  FolderOpen: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184l.326.378A1.5 1.5 0 0 0 9.036 4H13.5A1.5 1.5 0 0 1 15 5.5v.03a1.5 1.5 0 0 0-.128-.264L12.5 4H9.036a.5.5 0 0 1-.345-.134l-.326-.378C7.897 2.962 7.278 2.5 6.264 2.5H2.5a.5.5 0 0 0-.5.5v1.616a1.5 1.5 0 0 0-1-.116V3.5zM.5 6.5A1.5 1.5 0 0 1 2 5h11a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 14H2a1.5 1.5 0 0 1-1.5-1.5v-6z" fillOpacity="0.8" />
    </svg>
  ),

  // Default file
  File: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M4 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5.414a1 1 0 0 0-.293-.707L10.293 1.293A1 1 0 0 0 9.586 1H4zm5.5 1.5v3h3L9.5 2.5z" fillOpacity="0.6" />
    </svg>
  ),

  // Markdown file
  Markdown: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="2" width="14" height="12" rx="2" fill="#519aba" fillOpacity="0.9" />
      <path d="M3.5 5v6h1.5v-3l1.5 2 1.5-2v3h1.5v-6h-1.5l-1.5 2-1.5-2h-1.5zm7 0v6h1.5v-2.5l1.5 2.5h0l1.5-2.5v2.5" stroke="white" strokeWidth="0.8" fill="none" />
    </svg>
  ),

  // TypeScript/JavaScript
  TypeScript: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#3178c6" />
      <path d="M4.5 7h4v1h-1.5v4h-1v-4h-1.5v-1zm4.5 0h1.75c.414 0 .75.336.75.75v.5a.75.75 0 0 1-.75.75h-1v1.25h1.75v.75h-2c-.414 0-.75-.336-.75-.75v-2.5c0-.414.336-.75.75-.75z" fill="white" />
    </svg>
  ),

  JavaScript: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#f7df1e" />
      <path d="M5.5 7v4.5c0 .5-.5 1-1 1s-1-.25-1.25-.75l-.75.5c.25.75 1 1.25 2 1.25s2-.5 2-2v-4.5h-1zm3.5 0v5.5h1v-2.5h1c1 0 1.75-.75 1.75-1.5s-.75-1.5-1.75-1.5h-2zm1 1h.75c.5 0 .75.25.75.5s-.25.5-.75.5h-.75v-1z" fill="#323232" />
    </svg>
  ),

  // JSON
  Json: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#cbcb41" fillOpacity="0.9" />
      <path d="M5 5c-.55 0-1 .45-1 1v1c0 .55-.45 1-1 1v1c.55 0 1 .45 1 1v1c0 .55.45 1 1 1h1v-1h-.5c-.28 0-.5-.22-.5-.5v-1.5c0-.55-.45-1-1-1 .55 0 1-.45 1-1v-1.5c0-.28.22-.5.5-.5h.5v-1h-1zm6 0h-1v1h.5c.28 0 .5.22.5.5v1.5c0 .55.45 1 1 1-.55 0-1 .45-1 1v1.5c0 .28-.22.5-.5.5h-.5v1h1c.55 0 1-.45 1-1v-1c0-.55.45-1 1-1v-1c-.55 0-1-.45-1-1v-1c0-.55-.45-1-1-1z" fill="#323232" />
    </svg>
  ),

  // Lua
  Lua: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <circle cx="8" cy="8" r="7" fill="#000080" />
      <circle cx="8" cy="8" r="4" fill="none" stroke="white" strokeWidth="1.5" />
      <circle cx="11.5" cy="4.5" r="1.5" fill="white" />
    </svg>
  ),

  // Config/Settings
  Config: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" fillOpacity="0.7" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" fillOpacity="0.7" />
    </svg>
  ),

  // CSS/SCSS
  Css: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#264de4" />
      <path d="M3 3l.8 9.2L8 14l4.2-1.8L13 3H3zm7.5 3.5H5.7l.1 1.2h4.5l-.3 3.5-2 .7-2-.7-.1-1.7h1.2l.1.9.8.3.8-.3.1-1.3H5.5L5.2 5h5.5l-.2 1.5z" fill="white" />
    </svg>
  ),

  // HTML
  Html: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#e34f26" />
      <path d="M3 3l.8 9.2L8 14l4.2-1.8L13 3H3zm7.7 3.5l-.1 1h-5l.1 1h4.7l-.3 3.5-2.1.7-2.1-.7-.1-1.5h1l.1.8.9.3 1-.3.1-1.3h-4l-.3-3.5h7.2z" fill="white" />
    </svg>
  ),

  // Python
  Python: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <defs>
        <linearGradient id="python-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#387eb8" />
          <stop offset="100%" stopColor="#366994" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="url(#python-grad)" />
      <path d="M8 3c-2 0-1.9 1-1.9 1v1h2v.5h-3s-1.5-.1-1.5 2c0 2.1 1.3 2 1.3 2h.8v-1s0-1.3 1.3-1.3h2s1.2 0 1.2-1.2v-2s.2-1-2.2-1zm-.9.6c.2 0 .4.2.4.4s-.2.4-.4.4-.4-.2-.4-.4.2-.4.4-.4zM8 13c2 0 1.9-1 1.9-1v-1h-2v-.5h3s1.5.1 1.5-2c0-2.1-1.3-2-1.3-2h-.8v1s0 1.3-1.3 1.3h-2s-1.2 0-1.2 1.2v2s-.2 1 2.2 1zm.9-.6c-.2 0-.4-.2-.4-.4s.2-.4.4-.4.4.2.4.4-.2.4-.4.4z" fill="white" />
    </svg>
  ),

  // Image files
  Image: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" fillOpacity="0.7" />
      <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z" fillOpacity="0.7" />
    </svg>
  ),

  // Git
  Git: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <path d="M15.698 7.287L8.712.302a1.03 1.03 0 0 0-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 0 1 1.55 1.56l1.773 1.774a1.224 1.224 0 1 1-.733.693L8.57 5.953v4.17a1.225 1.225 0 1 1-1.008-.036V5.917a1.224 1.224 0 0 1-.665-1.608L5.09 2.5l-4.788 4.79a1.03 1.03 0 0 0 0 1.456l6.986 6.986a1.03 1.03 0 0 0 1.457 0l6.953-6.953a1.031 1.031 0 0 0 0-1.492" fill="#f05033" />
    </svg>
  ),

  // Environment file
  Env: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="2" width="14" height="12" rx="2" fill="#ecd53f" fillOpacity="0.9" />
      <path d="M4 5h8v1h-8v-1zm0 2.5h6v1h-6v-1zm0 2.5h5v1h-5v-1z" fill="#323232" fillOpacity="0.8" />
    </svg>
  ),
};

// Chevron icon for folders
const ChevronIcon = ({ isOpen, className }: { isOpen: boolean; className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    className={`${className} transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
    fill="currentColor"
  >
    <path d="M6 4l4 4-4 4" fillRule="evenodd" />
  </svg>
);

// Action icons
const ActionIcons = {
  FilePlus: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M8 4a.5.5 0 0 1 .5.5V6H10a.5.5 0 0 1 0 1H8.5v1.5a.5.5 0 0 1-1 0V7H6a.5.5 0 0 1 0-1h1.5V4.5A.5.5 0 0 1 8 4z" />
      <path d="M4 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5.414a1 1 0 0 0-.293-.707L10.293 1.293A1 1 0 0 0 9.586 1H4zm5.5 1.5v3h3L9.5 2.5z" fillOpacity="0.7" />
    </svg>
  ),
  FolderPlus: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M12 6.5a.5.5 0 0 1 .5.5v1.5H14a.5.5 0 0 1 0 1h-1.5V11a.5.5 0 0 1-1 0V9.5H10a.5.5 0 0 1 0-1h1.5V7a.5.5 0 0 1 .5-.5z" />
      <path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-6l-1-1.5H1.5z" fillOpacity="0.7" />
    </svg>
  ),
  Refresh: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z" />
      <path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z" />
    </svg>
  ),
  Collapse: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M1 2a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2zm1.5.5v1h11v-1h-11zM1 8a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V8zm1.5.5v1h11v-1h-11z" />
    </svg>
  ),
};

// Get file icon based on extension
const getFileIcon = (fileName: string) => {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const name = fileName.toLowerCase();

  // Config files
  if (name.includes("config") || name.includes(".config.") || ext === "cfg" || ext === "ini") {
    return FileIcons.Config;
  }

  // Environment files
  if (name.startsWith(".env") || ext === "env") {
    return FileIcons.Env;
  }

  // Git files
  if (name === ".gitignore" || name === ".gitattributes") {
    return FileIcons.Git;
  }

  switch (ext) {
    case "md":
    case "mdx":
      return FileIcons.Markdown;
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return FileIcons.TypeScript;
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return FileIcons.JavaScript;
    case "json":
      return FileIcons.Json;
    case "lua":
    case "luau":
      return FileIcons.Lua;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return FileIcons.Css;
    case "html":
    case "htm":
      return FileIcons.Html;
    case "py":
    case "pyw":
      return FileIcons.Python;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return FileIcons.Image;
    default:
      return FileIcons.File;
  }
};

// Get folder color based on name
const getFolderColor = (name: string): string => {
  const n = name.toLowerCase();
  if (n.includes("config") || n.includes("settings")) return "text-zinc-500";
  if (n.includes("src") || n.includes("lib")) return "text-blue-500";
  if (n.includes("assets") || n.includes("public")) return "text-green-500";
  if (n.includes("test") || n.includes("spec")) return "text-yellow-600";
  if (n.includes("node_modules") || n.includes("vendor")) return "text-zinc-400";
  if (n.includes(".")) return "text-zinc-400"; // Hidden folders
  return "text-amber-500";
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
  projectName?: string;
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
      const IconComponent = editingState.nodeType === "file" ? FileIcons.File : FileIcons.Folder;
      editItem = (
        <div
          key="editing-item"
          className="relative"
        >
          <div
            className="flex items-center gap-1 px-2 py-0.5 text-[13px]"
            style={{ paddingLeft: `${depth * 16 + 22}px` }}
          >
            <IconComponent className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              className={`bg-white text-zinc-900 border rounded px-1.5 py-0.5 text-[13px] w-full outline-none min-w-0 ${
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

    return (
      <>
        {editItem && editingState?.nodeType === "folder" ? editItem : null}

        {nodesToRender.map(node => {
          const isRenaming = editingState?.type === "rename" && editingState.targetId === node.id;

          if (isRenaming) {
            const IconComponent = node.type === "file" ? getFileIcon(node.name) : FileIcons.Folder;
            return (
              <div
                key={node.id}
                className="relative"
              >
                <div
                  className="flex items-center gap-1 px-2 py-0.5 text-[13px]"
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
                    className={`bg-white text-zinc-900 border rounded px-1.5 py-0.5 text-[13px] w-full outline-none min-w-0 ${
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
          const isSelected = activeNodeId === node.id;
          const FileIcon = getFileIcon(node.name);

          const handleAddFile = (e: React.MouseEvent) => {
            e.stopPropagation();
            setExpandedFolders(prev => new Set(prev).add(node.id));
            setEditingState({ type: "create", nodeType: "file", parentId: node.id });
          };

          const handleAddFolder = (e: React.MouseEvent) => {
            e.stopPropagation();
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
                  group/item flex items-center gap-1 px-2 py-0.5 text-[13px] cursor-pointer select-none
                  ${isSelected
                    ? "bg-blue-600/10 text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-100"
                  }
                `}
                style={{ paddingLeft: `${depth * 16 + (node.type === "folder" ? 4 : 22)}px` }}
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

                {/* Hover action buttons for folders */}
                {node.type === "folder" && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
                    <button
                      onClick={handleAddFile}
                      className="p-0.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600"
                      title="New File"
                    >
                      <ActionIcons.FilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleAddFolder}
                      className="p-0.5 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600"
                      title="New Folder"
                    >
                      <ActionIcons.FolderPlus className="w-3.5 h-3.5" />
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
      className="flex-1 flex flex-col min-h-0 text-zinc-700"
      onClick={() => setContextMenu(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, targetId: null });
      }}
    >
      {/* Header with action icons */}
      <div className="px-3 py-2 flex justify-between items-center border-b border-zinc-200 flex-shrink-0">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
          Explorer
        </span>
        <div className="flex gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingState({ type: "create", nodeType: "file", parentId: null });
            }}
            className="p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600"
            title="New File"
          >
            <ActionIcons.FilePlus className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingState({ type: "create", nodeType: "folder", parentId: null });
            }}
            className="p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600"
            title="New Folder"
          >
            <ActionIcons.FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpandedFolders(new Set());
            }}
            className="p-1 hover:bg-zinc-200 rounded text-zinc-400 hover:text-zinc-600"
            title="Collapse All"
          >
            <ActionIcons.Collapse className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Project name header - Cursor style */}
      {projectName && (
        <div
          className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-zinc-100 border-b border-zinc-100"
          onClick={() => setIsProjectExpanded(!isProjectExpanded)}
        >
          <ChevronIcon isOpen={isProjectExpanded} className="w-4 h-4 text-zinc-500" />
          <span className="text-[12px] font-semibold text-zinc-700 uppercase tracking-wide">
            {projectName}
          </span>
        </div>
      )}

      {/* File tree content */}
      <div className="flex-1 overflow-y-auto py-1">
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

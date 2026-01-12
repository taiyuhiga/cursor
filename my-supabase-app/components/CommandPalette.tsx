"use client";

import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { Icons } from "./Icons";

type Node = {
  id: string;
  type: "file" | "folder";
  name: string;
};

type Props = {
  nodes: Node[];
  onSelectNode: (nodeId: string) => void;
  onHoverNode?: (nodeId: string) => void;
  onAction: (action: string) => void;
};

export function CommandPalette({ nodes, onSelectNode, onHoverNode, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"file" | "command">("file");

  // ファイルのみフィルタリング
  const files = nodes.filter((n) => n.type === "file");

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setMode("file");
        setOpen((open) => !open);
      } else if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setMode("command");
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Global Command Menu"
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] max-w-[90vw] bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden z-[100]"
    >
      <div className="flex items-center border-b border-zinc-200 px-3">
        {mode === "file" ? (
          <Icons.Search className="w-4 h-4 text-zinc-400 mr-2" />
        ) : (
          <span className="text-zinc-400 mr-2 text-xs font-mono">{">"}</span>
        )}
        <Command.Input
          className="w-full bg-transparent p-3 text-sm outline-none text-zinc-900 placeholder:text-zinc-400"
          placeholder={
            mode === "file"
              ? "Search files..."
              : "Type a command or search..."
          }
        />
      </div>

      <Command.List className="max-h-[300px] overflow-y-auto p-2 scroll-py-2">
        <Command.Empty className="py-6 text-center text-sm text-zinc-400">
          No results found.
        </Command.Empty>

        {mode === "file" ? (
          <Command.Group heading="Files" className="text-xs font-medium text-zinc-500 px-2 pb-1 mb-2">
            {files.map((node) => (
              <Command.Item
                key={node.id}
                onMouseEnter={() => onHoverNode?.(node.id)}
                onSelect={() => {
                  onSelectNode(node.id);
                  setOpen(false);
                }}
                className="flex items-center gap-2 px-2 py-2 text-sm text-zinc-700 rounded hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer aria-selected:bg-zinc-100 aria-selected:text-zinc-900"
              >
                <Icons.Explorer className="w-4 h-4 text-zinc-400" />
                <span>{node.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : (
          <>
            <Command.Group heading="AI Actions" className="text-xs font-medium text-zinc-500 px-2 pb-1 mb-2">
              <Command.Item
                onSelect={() => {
                  onAction("explain");
                  setOpen(false);
                }}
                className="flex items-center gap-2 px-2 py-2 text-sm text-zinc-700 rounded hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer aria-selected:bg-zinc-100 aria-selected:text-zinc-900"
              >
                <Icons.AI className="w-4 h-4 text-blue-500" />
                <span>Explain this file</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onAction("fix");
                  setOpen(false);
                }}
                className="flex items-center gap-2 px-2 py-2 text-sm text-zinc-700 rounded hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer aria-selected:bg-zinc-100 aria-selected:text-zinc-900"
              >
                <Icons.AI className="w-4 h-4 text-blue-500" />
                <span>Fix bugs</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onAction("test");
                  setOpen(false);
                }}
                className="flex items-center gap-2 px-2 py-2 text-sm text-zinc-700 rounded hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer aria-selected:bg-zinc-100 aria-selected:text-zinc-900"
              >
                <Icons.AI className="w-4 h-4 text-blue-500" />
                <span>Generate tests</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onAction("refactor");
                  setOpen(false);
                }}
                className="flex items-center gap-2 px-2 py-2 text-sm text-zinc-700 rounded hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer aria-selected:bg-zinc-100 aria-selected:text-zinc-900"
              >
                <Icons.AI className="w-4 h-4 text-blue-500" />
                <span>Refactor code</span>
              </Command.Item>
            </Command.Group>
            
            <Command.Group heading="Editor" className="text-xs font-medium text-zinc-500 px-2 pb-1 mb-2 mt-2 border-t border-zinc-200 pt-2">
              <Command.Item
                onSelect={() => {
                  onAction("save");
                  setOpen(false);
                }}
                className="flex items-center gap-2 px-2 py-2 text-sm text-zinc-700 rounded hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer aria-selected:bg-zinc-100 aria-selected:text-zinc-900"
              >
                <Icons.Settings className="w-4 h-4 text-zinc-400" />
                <span>Save file</span>
              </Command.Item>
            </Command.Group>
          </>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

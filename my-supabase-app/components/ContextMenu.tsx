"use client";

import { useEffect, useRef } from "react";

type MenuItem = {
  label: string;
  action: () => void;
  shortcut?: string;
  danger?: boolean;
  separator?: boolean;
};

type Props = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white border border-zinc-200 rounded-lg shadow-xl py-1 w-64 text-sm"
      style={{ top: y, left: x }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={index} className="h-px bg-zinc-200 my-1" />;
        }

        return (
          <button
            key={index}
            onClick={() => {
              item.action();
              onClose();
            }}
            className={`
              w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-blue-500 hover:text-white transition-colors
              ${item.danger ? "text-red-500" : "text-zinc-700"}
            `}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-xs opacity-50">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

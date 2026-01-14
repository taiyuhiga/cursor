"use client";

import { useEffect, useRef, ReactNode, useState } from "react";

type MenuItem = {
  label: string;
  action: () => void;
  icon?: ReactNode;
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
  const [position, setPosition] = useState({ x, y });

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      // Adjust horizontal position if menu goes off right edge
      if (x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 8;
      }

      // Adjust vertical position if menu goes off bottom edge
      if (y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 8;
      }

      // Ensure menu doesn't go off left or top edge
      if (newX < 8) newX = 8;
      if (newY < 8) newY = 8;

      if (newX !== x || newY !== y) {
        setPosition({ x: newX, y: newY });
      }
    }
  }, [x, y]);

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
      style={{ top: position.y, left: position.x }}
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
            <span className="flex items-center gap-2">
              {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
              {item.label}
            </span>
            {item.shortcut && (
              <span className="text-xs opacity-50">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { diffLines, Change } from "diff";
import { useMemo } from "react";

type Props = {
  oldCode: string;
  newCode: string;
  onApply: () => void;
  onCancel: () => void;
};

export function DiffView({ oldCode, newCode, onApply, onCancel }: Props) {
  const changes = useMemo(() => {
    return diffLines(oldCode, newCode);
  }, [oldCode, newCode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-8">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-zinc-100">Review Changes</h2>
            <div className="flex gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-500/20 border border-red-500/50"></span>
                Deleted
              </span>
              <span className="flex items-center gap-1.5 text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-500/20 border border-green-500/50"></span>
                Added
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            >
              Discard
            </button>
            <button
              onClick={onApply}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors"
            >
              Apply Changes
            </button>
          </div>
        </div>

        {/* 差分ビュー */}
        <div className="flex-1 overflow-auto bg-zinc-950 font-mono text-sm">
          {changes.map((part, index) => {
            const color = part.added
              ? "bg-green-900/20 text-green-100"
              : part.removed
              ? "bg-red-900/20 text-red-100"
              : "text-zinc-400";
            
            // 行番号の表示は簡易的（今回は省略するか、必要なら実装）
            // ここでは行ごとに分割して表示
            return part.value
              .split("\n")
              .filter((line, i, arr) => !(i === arr.length - 1 && line === "")) // 最後の空行を除外
              .map((line, lineIndex) => (
                <div
                  key={`${index}-${lineIndex}`}
                  className={`flex ${color} min-w-full`}
                >
                  <div className="w-8 flex-shrink-0 select-none text-right pr-3 opacity-30 bg-zinc-900/50 border-r border-zinc-800">
                    {/* 行番号プレースホルダー */}
                  </div>
                  <div className="px-4 py-0.5 whitespace-pre-wrap break-all w-full">
                    <span className="select-none inline-block w-4 opacity-50">
                      {part.added ? "+" : part.removed ? "-" : " "}
                    </span>
                    {line}
                  </div>
                </div>
              ));
          })}
        </div>
      </div>
    </div>
  );
}


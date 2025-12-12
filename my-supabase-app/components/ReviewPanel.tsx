"use client";

import { useEffect, useState, useMemo } from "react";
import { diffLines } from "diff";
import { Icons } from "./Icons";

export type PendingChange = {
  id: string;
  filePath: string;
  fileName: string;
  oldContent: string;
  newContent: string;
  action: "create" | "update" | "delete";
  status: "pending" | "accepted" | "rejected";
  lineStatuses?: Record<number, "accepted" | "rejected" | "pending">;
};

type Props = {
  changes: PendingChange[];
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptFile: (changeId: string) => void;
  onRejectFile: (changeId: string) => void;
  onAcceptLine: (changeId: string, lineIndex: number) => void;
  onRejectLine: (changeId: string, lineIndex: number) => void;
  onClose: () => void;
  onFindIssues?: () => void;
  issues?: string | null;
  isFindingIssues?: boolean;
};

export function ReviewPanel({
  changes,
  onAcceptAll,
  onRejectAll,
  onAcceptFile,
  onRejectFile,
  onAcceptLine,
  onRejectLine,
  onClose,
  onFindIssues,
  issues,
  isFindingIssues,
}: Props) {
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(
    changes[0]?.id || null
  );
  const [showLineActions, setShowLineActions] = useState(false);

  // changes が更新された時に選択状態が壊れないようにする
  useEffect(() => {
    if (!changes || changes.length === 0) {
      setSelectedChangeId(null);
      return;
    }
    if (!selectedChangeId || !changes.find(c => c.id === selectedChangeId)) {
      setSelectedChangeId(changes[0].id);
    }
  }, [changes, selectedChangeId]);

  const selectedChange = changes.find((c) => c.id === selectedChangeId);

  const diffResult = useMemo(() => {
    if (!selectedChange) return [];
    return diffLines(selectedChange.oldContent, selectedChange.newContent);
  }, [selectedChange]);

  // 行インデックスを計算
  const linesWithIndex = useMemo(() => {
    let lineIndex = 0;
    const lines: Array<{
      index: number;
      type: "added" | "removed" | "context";
      content: string;
      status: "pending" | "accepted" | "rejected";
    }> = [];

    diffResult.forEach((part) => {
      const partLines = part.value.split("\n").filter((_, i, arr) => !(i === arr.length - 1 && _ === ""));
      partLines.forEach((line) => {
        const type = part.added ? "added" : part.removed ? "removed" : "context";
        const status = selectedChange?.lineStatuses?.[lineIndex] || "pending";
        lines.push({ index: lineIndex, type, content: line, status });
        lineIndex++;
      });
    });

    return lines;
  }, [diffResult, selectedChange]);

  const stats = useMemo(() => {
    const added = linesWithIndex.filter((l) => l.type === "added").length;
    const removed = linesWithIndex.filter((l) => l.type === "removed").length;
    return { added, removed };
  }, [linesWithIndex]);

  const pendingCount = changes.filter((c) => c.status === "pending").length;
  const currentIndex = changes.findIndex((c) => c.id === selectedChangeId) + 1;

  const goToNextPending = () => {
    const currentIdx = changes.findIndex((c) => c.id === selectedChangeId);
    for (let i = currentIdx + 1; i < changes.length; i++) {
      if (changes[i].status === "pending") {
        setSelectedChangeId(changes[i].id);
        return;
      }
    }
    // Wrap around
    for (let i = 0; i < currentIdx; i++) {
      if (changes[i].status === "pending") {
        setSelectedChangeId(changes[i].id);
        return;
      }
    }
  };

  const goToPrevPending = () => {
    const currentIdx = changes.findIndex((c) => c.id === selectedChangeId);
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (changes[i].status === "pending") {
        setSelectedChangeId(changes[i].id);
        return;
      }
    }
    // Wrap around
    for (let i = changes.length - 1; i > currentIdx; i--) {
      if (changes[i].status === "pending") {
        setSelectedChangeId(changes[i].id);
        return;
      }
    }
  };

  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 bg-zinc-50">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-zinc-900">Review Changes</h2>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-green-500"></span>
              +{stats.added} lines
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-500"></span>
              -{stats.removed} lines
            </span>
          </div>
          <span className="text-sm text-zinc-400">
            {pendingCount} file{pendingCount !== 1 ? "s" : ""} pending
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onFindIssues && (
            <button
              onClick={onFindIssues}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-md transition-colors"
            >
              <Icons.Search className="w-4 h-4" />
              {isFindingIssues ? "Finding..." : "Find Issues"}
            </button>
          )}
          <button
            onClick={() => setShowLineActions(!showLineActions)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              showLineActions
                ? "bg-blue-100 text-blue-700 border border-blue-200"
                : "text-zinc-600 hover:bg-zinc-100 border border-zinc-200"
            }`}
          >
            Line-by-line
          </button>
          <button
            onClick={onRejectAll}
            className="px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-md transition-colors"
          >
            Reject All
          </button>
          <button
            onClick={onAcceptAll}
            className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors"
          >
            Accept All
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded transition-colors"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Issues panel */}
      {(isFindingIssues || issues) && (
        <div className="border-b border-zinc-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900">Agent Review</div>
            <div className="text-xs text-zinc-500">
              {isFindingIssues ? "Analyzing diffs..." : "Done"}
            </div>
          </div>
          <div className="mt-2 text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed max-h-40 overflow-auto">
            {isFindingIssues ? "Please wait..." : issues}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* File List Sidebar */}
        <div className="w-64 border-r border-zinc-200 bg-zinc-50 overflow-y-auto">
          <div className="p-2">
            <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider px-2 py-1.5">
              Changed Files ({changes.length})
            </div>
            {changes.map((change) => (
              <button
                key={change.id}
                onClick={() => setSelectedChangeId(change.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                  selectedChangeId === change.id
                    ? "bg-blue-100 text-blue-800"
                    : "hover:bg-zinc-100 text-zinc-700"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    change.status === "accepted"
                      ? "bg-green-500"
                      : change.status === "rejected"
                      ? "bg-red-500"
                      : "bg-amber-400"
                  }`}
                />
                <Icons.File className="w-4 h-4 flex-shrink-0 text-zinc-400" />
                <span className="truncate flex-1">{change.fileName}</span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    change.action === "create"
                      ? "bg-green-100 text-green-700"
                      : change.action === "delete"
                      ? "bg-red-100 text-red-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {change.action === "create" ? "A" : change.action === "delete" ? "D" : "M"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Diff View */}
        <div className="flex-1 overflow-auto bg-zinc-50 font-mono text-sm">
          {selectedChange && (
            <>
              <div className="sticky top-0 z-10 bg-zinc-100 border-b border-zinc-200 px-4 py-2 flex items-center justify-between">
                <span className="text-zinc-600">{selectedChange.filePath}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onRejectFile(selectedChange.id)}
                    disabled={selectedChange.status === "rejected"}
                    className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                      selectedChange.status === "rejected"
                        ? "bg-red-200 text-red-800 cursor-not-allowed"
                        : "text-red-600 hover:bg-red-100 border border-red-200"
                    }`}
                  >
                    Reject File
                  </button>
                  <button
                    onClick={() => onAcceptFile(selectedChange.id)}
                    disabled={selectedChange.status === "accepted"}
                    className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                      selectedChange.status === "accepted"
                        ? "bg-green-200 text-green-800 cursor-not-allowed"
                        : "text-green-600 hover:bg-green-100 border border-green-200"
                    }`}
                  >
                    Accept File
                  </button>
                </div>
              </div>
              <div>
                {linesWithIndex.map((line, idx) => {
                  const bgColor =
                    line.type === "added"
                      ? line.status === "rejected"
                        ? "bg-red-50/50 line-through opacity-50"
                        : "bg-green-50"
                      : line.type === "removed"
                      ? line.status === "accepted"
                        ? "bg-green-50/50 line-through opacity-50"
                        : "bg-red-50"
                      : "";

                  const textColor =
                    line.type === "added"
                      ? "text-green-800"
                      : line.type === "removed"
                      ? "text-red-800"
                      : "text-zinc-600";

                  return (
                    <div
                      key={idx}
                      className={`flex group ${bgColor} hover:brightness-95 min-w-full`}
                    >
                      {/* Line Number */}
                      <div className="w-12 flex-shrink-0 select-none text-right pr-3 text-zinc-400 bg-zinc-100/50 border-r border-zinc-200">
                        {idx + 1}
                      </div>

                      {/* Line Actions (when enabled) */}
                      {showLineActions && line.type !== "context" && (
                        <div className="w-16 flex-shrink-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => onAcceptLine(selectedChange.id, line.index)}
                            className="p-0.5 text-green-600 hover:bg-green-100 rounded"
                            title="Accept this line"
                          >
                            <Icons.Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onRejectLine(selectedChange.id, line.index)}
                            className="p-0.5 text-red-600 hover:bg-red-100 rounded"
                            title="Reject this line"
                          >
                            <Icons.X className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Sign */}
                      <div className={`w-6 flex-shrink-0 text-center select-none ${textColor}`}>
                        {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                      </div>

                      {/* Content */}
                      <div className={`px-2 py-0.5 whitespace-pre-wrap break-all flex-1 ${textColor}`}>
                        {line.content || " "}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Floating Review Bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-full shadow-xl">
        <button
          onClick={goToPrevPending}
          className="p-1 hover:bg-zinc-700 rounded-full transition-colors"
          title="Previous file"
        >
          <Icons.ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-sm px-2">
          {currentIndex} / {changes.length}
        </span>
        <button
          onClick={goToNextPending}
          className="p-1 hover:bg-zinc-700 rounded-full transition-colors"
          title="Next file"
        >
          <Icons.ChevronRight className="w-5 h-5" />
        </button>
        <div className="w-px h-5 bg-zinc-700 mx-1" />
        {selectedChange && (
          <>
            <button
              onClick={() => onRejectFile(selectedChange.id)}
              className="px-3 py-1 text-sm font-medium text-red-400 hover:bg-zinc-700 rounded-full transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => {
                onAcceptFile(selectedChange.id);
                goToNextPending();
              }}
              className="px-3 py-1 text-sm font-medium bg-green-600 hover:bg-green-500 rounded-full transition-colors"
            >
              Accept
            </button>
          </>
        )}
      </div>
    </div>
  );
}



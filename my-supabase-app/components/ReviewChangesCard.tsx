"use client";

import { useMemo, useState } from "react";
import { diffLines } from "diff";
import type { PendingChange, ReviewIssue } from "@/lib/review/types";
import { Icons } from "./Icons";

function getExtLabel(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (!ext) return "FILE";
  return ext.length > 4 ? ext.slice(0, 4).toUpperCase() : ext.toUpperCase();
}

function countAddedRemoved(oldContent: string, newContent: string) {
  const parts = diffLines(oldContent, newContent);
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    const lines = part.value
      .split("\n")
      .filter((line, i, arr) => !(i === arr.length - 1 && line === ""));
    if (part.added) added += lines.length;
    else if (part.removed) removed += lines.length;
  }
  return { added, removed };
}

type Props = {
  changes: PendingChange[];
  onSelectFile: (changeId: string) => void;
  onSelectIssue?: (issueId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onFindIssues?: () => void;
  isFindingIssues?: boolean;
  issues?: ReviewIssue[] | null;
  onFixIssue?: (issueId: string) => void;
  onDismissIssue?: (issueId: string) => void;
  onFixAllIssues?: () => void;
};

export function ReviewChangesCard({
  changes,
  onSelectFile,
  onSelectIssue,
  onAcceptAll,
  onRejectAll,
  onFindIssues,
  isFindingIssues,
  issues,
  onFixIssue,
  onDismissIssue,
  onFixAllIssues,
}: Props) {
  const [open, setOpen] = useState(true);

  const perFileStats = useMemo(() => {
    return changes.map((c) => {
      const stats = countAddedRemoved(c.oldContent, c.newContent);
      return { id: c.id, added: stats.added, removed: stats.removed };
    });
  }, [changes]);

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const s of perFileStats) {
      added += s.added;
      removed += s.removed;
    }
    return { added, removed };
  }, [perFileStats]);

  const pendingCount = useMemo(
    () => changes.filter((c) => c.status === "pending").length,
    [changes]
  );
  const openIssues = useMemo(
    () => (issues || []).filter((i) => i.status === "open"),
    [issues]
  );

  if (!changes || changes.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#171a21] shadow-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icons.Review className="w-3.5 h-3.5 text-zinc-400" />
          <span className="font-medium">Review changes</span>
          <span className="text-[11px] text-zinc-500">
            {changes.length} file{changes.length === 1 ? "" : "s"} · {pendingCount} pending
          </span>
        </div>
        <Icons.ChevronDown
          className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      {open && (
        <div className="px-3 pb-3">
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="text-xs text-zinc-300 flex items-center gap-2">
              <span className="font-medium">
                Edited {changes.length} file{changes.length === 1 ? "" : "s"}
              </span>
              <span className="text-green-400 font-medium">+{totals.added}</span>
              <span className="text-red-400 font-medium">-{totals.removed}</span>
            </div>
            <div className="flex items-center gap-2">
              {onFindIssues && (
                <button
                  type="button"
                  onClick={onFindIssues}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-200 transition-colors flex items-center gap-1.5"
                >
                  <Icons.Search className="w-3.5 h-3.5" />
                  {isFindingIssues ? "Finding..." : "Find Issues"}
                </button>
              )}
              <button
                type="button"
                onClick={onRejectAll}
                className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/15 text-red-200 transition-colors"
              >
                Reject all
              </button>
              <button
                type="button"
                onClick={onAcceptAll}
                className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#4b8cff] hover:bg-[#3c7af0] text-white transition-colors"
              >
                Accept all
              </button>
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-white/10 overflow-hidden">
            {changes.map((change) => {
              const stats = perFileStats.find((s) => s.id === change.id) || {
                added: 0,
                removed: 0,
              };
              const dot =
                change.status === "accepted"
                  ? "bg-green-400"
                  : change.status === "rejected"
                  ? "bg-red-400"
                  : "bg-amber-400";
              return (
                <button
                  key={change.id}
                  type="button"
                  onClick={() => onSelectFile(change.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-sm text-zinc-200 hover:bg-white/5 transition-colors"
                >
                  <div className="w-6 flex-shrink-0 flex items-center justify-center">
                    <span className="text-[10px] font-semibold text-zinc-400">
                      {getExtLabel(change.fileName)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{change.fileName}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-green-400">+{stats.added}</span>
                        <span className="text-xs text-red-400">-{stats.removed}</span>
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                      </div>
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {change.filePath}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {(isFindingIssues || (issues && issues.length > 0)) && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-zinc-300">Agent Review</span>
                  {!isFindingIssues && (
                    <span className="text-zinc-500">
                      Found {openIssues.length} potential issue{openIssues.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {onFindIssues && (
                    <button
                      type="button"
                      onClick={onFindIssues}
                      className="px-2 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-200 transition-colors"
                    >
                      Review Again
                    </button>
                  )}
                  {onFixAllIssues && openIssues.length > 0 && (
                    <button
                      type="button"
                      onClick={onFixAllIssues}
                      className="px-2 py-1 rounded-md bg-[#4b8cff] hover:bg-[#3c7af0] text-white transition-colors"
                    >
                      Fix All Issues
                    </button>
                  )}
                </div>
              </div>

              {isFindingIssues ? (
                <div className="mt-2 text-xs text-zinc-300">Analyzing…</div>
              ) : (
                <div className="mt-2 space-y-2 max-h-44 overflow-auto">
                  {openIssues.length === 0 ? (
                    <div className="text-xs text-zinc-500">No issues found.</div>
                  ) : (
                    openIssues.map((issue) => {
                      const sev =
                        issue.severity === "high"
                          ? "bg-red-500/15 text-red-200 border-red-500/20"
                          : issue.severity === "medium"
                          ? "bg-amber-500/15 text-amber-200 border-amber-500/20"
                          : "bg-blue-500/15 text-blue-200 border-blue-500/20";
                      const changeForFile = changes.find((c) => c.filePath === issue.filePath);
                      return (
                        <div
                          key={issue.id}
                          className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors px-2.5 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (onSelectIssue) {
                                onSelectIssue(issue.id);
                                return;
                              }
                              if (changeForFile) onSelectFile(changeForFile.id);
                            }}
                            className="w-full text-left"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sev}`}>
                                    {issue.severity.toUpperCase()}
                                  </span>
                                  <span className="text-xs font-medium text-zinc-200 truncate">
                                    {issue.title}
                                  </span>
                                </div>
                                <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                                  {issue.filePath}
                                  {issue.startLine ? `:${issue.startLine}` : ""}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {onFixIssue && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onFixIssue(issue.id);
                                    }}
                                    className="px-2 py-1 text-[11px] rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-200"
                                  >
                                    Fix
                                  </button>
                                )}
                                {onDismissIssue && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDismissIssue(issue.id);
                                    }}
                                    className="p-1.5 rounded-md hover:bg-white/10 text-zinc-400 hover:text-zinc-200"
                                    title="Dismiss"
                                  >
                                    <Icons.X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
                              {issue.description}
                            </div>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

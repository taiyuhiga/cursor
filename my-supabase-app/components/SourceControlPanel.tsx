"use client";

import { useMemo } from "react";
import { Icons } from "./Icons";
import type { ReviewIssue } from "@/lib/review/types";

export type SourceControlChange = {
  id: string;
  filePath: string;
  fileName: string;
  status: "modified" | "added" | "deleted";
  added: number;
  removed: number;
};

type Props = {
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onCommit: () => void;
  changes: SourceControlChange[];
  onSelectChange: (changeId: string) => void;
  issues: ReviewIssue[] | null;
  isReviewing: boolean;
  onRunReview: () => void;
  onFixIssue: (issueId: string) => void;
  onDismissIssue: (issueId: string) => void;
  onFixAllIssues: () => void;
};

function extLabel(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (!ext) return "FILE";
  return ext.length > 4 ? ext.slice(0, 4).toUpperCase() : ext.toUpperCase();
}

export function SourceControlPanel({
  commitMessage,
  onCommitMessageChange,
  onCommit,
  changes,
  onSelectChange,
  issues,
  isReviewing,
  onRunReview,
  onFixIssue,
  onDismissIssue,
  onFixAllIssues,
}: Props) {
  const openIssues = useMemo(() => (issues || []).filter((i) => i.status === "open"), [issues]);

  return (
    <div className="h-full bg-[#0f1115] text-zinc-200 flex flex-col">
      <div className="px-3 pt-3 pb-2 border-b border-white/10">
        <div className="text-[11px] font-semibold text-zinc-400 tracking-wider">
          CHANGES
        </div>
        <div className="mt-2 space-y-2">
          <input
            value={commitMessage}
            onChange={(e) => onCommitMessageChange(e.target.value)}
            onKeyDown={(e) => {
              const cmd = e.metaKey || e.ctrlKey;
              if (cmd && e.key === "Enter") {
                e.preventDefault();
                onCommit();
              }
            }}
            placeholder={`Message (⌘↩ to commit on "main")`}
            className="w-full px-2.5 py-2 text-sm rounded-md bg-white/5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/10 placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={onCommit}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-[#4b8cff] hover:bg-[#3c7af0] text-white text-sm font-medium transition-colors"
          >
            <Icons.Check className="w-4 h-4" />
            Commit
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="px-3 py-2 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-400">Changes</div>
            <div className="text-[11px] text-zinc-500">{changes.length}</div>
          </div>
          <div className="mt-2 space-y-1">
            {changes.length === 0 ? (
              <div className="py-4 text-xs text-zinc-500 text-center">
                No changes
              </div>
            ) : (
              changes.map((c) => {
                const badge =
                  c.status === "added"
                    ? "bg-green-500/15 text-green-200 border-green-500/20"
                    : c.status === "deleted"
                    ? "bg-red-500/15 text-red-200 border-red-500/20"
                    : "bg-blue-500/15 text-blue-200 border-blue-500/20";
                const letter = c.status === "added" ? "A" : c.status === "deleted" ? "D" : "M";
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectChange(c.id)}
                    className="w-full text-left px-2 py-2 rounded-md hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-zinc-400 w-8 flex-shrink-0 text-center">
                        {extLabel(c.fileName)}
                      </span>
                      <span className="truncate flex-1 text-sm">{c.fileName}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge}`}>
                        {letter}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="truncate">{c.filePath}</span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-green-400">+{c.added}</span>
                        <span className="text-red-400">-{c.removed}</span>
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="px-3 py-3">
          <div className="text-[11px] font-semibold text-zinc-400 tracking-wider">
            AGENT REVIEW
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onRunReview}
              className="flex-1 px-3 py-2 text-sm rounded-md border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              {isReviewing ? "Reviewing..." : "Review Again"}
            </button>
            <button
              type="button"
              onClick={onFixAllIssues}
              disabled={openIssues.length === 0}
              className={`flex-1 px-3 py-2 text-sm rounded-md transition-colors ${
                openIssues.length === 0
                  ? "bg-white/5 text-zinc-500 cursor-not-allowed"
                  : "bg-[#4b8cff] hover:bg-[#3c7af0] text-white"
              }`}
            >
              Fix All Issues
            </button>
          </div>

          <div className="mt-3 text-xs text-zinc-500">
            {isReviewing
              ? "Analyzing diffs..."
              : issues
              ? `Found ${openIssues.length} Potential Issue${openIssues.length === 1 ? "" : "s"} (Diff with Main Branch)`
              : "Run Agent Review to find issues."}
          </div>

          {openIssues.length > 0 && (
            <div className="mt-2 space-y-2">
              {openIssues.map((issue) => (
                <div
                  key={issue.id}
                  className="rounded-md border border-white/10 bg-white/5 overflow-hidden"
                >
                  <div className="px-2.5 py-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-zinc-200 font-medium truncate">
                        {issue.title}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {issue.filePath}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => onFixIssue(issue.id)}
                        className="text-[11px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10"
                      >
                        Fix
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismissIssue(issue.id)}
                        className="p-1.5 rounded hover:bg-white/10 text-zinc-400 hover:text-zinc-200"
                        title="Dismiss"
                      >
                        <Icons.X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="px-2.5 pb-2 text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed">
                    {issue.description}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

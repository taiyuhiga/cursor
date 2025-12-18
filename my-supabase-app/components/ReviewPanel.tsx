"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { diffLines } from "diff";
import type { PendingChange, ReviewIssue } from "@/lib/review/types";
import { Icons } from "./Icons";

type DiffLine = {
  displayIndex: number;
  diffIndex: number;
  type: "added" | "removed" | "context";
  content: string;
  status: "pending" | "accepted" | "rejected";
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

type Props = {
  changes: PendingChange[];
  selectedChangeId: string | null;
  onSelectChange: (changeId: string) => void;
  onAcceptFile: (changeId: string) => Promise<void> | void;
  onRejectFile: (changeId: string) => void;
  onAcceptLine: (changeId: string, lineIndex: number) => void;
  onRejectLine: (changeId: string, lineIndex: number) => void;
  onClose: () => void;
  focusIssue?: { id: string; nonce: number } | null;
  issues?: ReviewIssue[] | null;
  isFindingIssues?: boolean;
  onFindIssues?: () => void;
  onDismissIssue?: (issueId: string) => void;
  onFixIssueInChat?: (issueId: string) => void;
  onFixAllIssuesInChat?: () => void;
};

export function ReviewPanel({
  changes,
  selectedChangeId,
  onSelectChange,
  onAcceptFile,
  onRejectFile,
  onAcceptLine,
  onRejectLine,
  onClose,
  focusIssue,
  issues,
  isFindingIssues,
  onFindIssues,
  onDismissIssue,
  onFixIssueInChat,
  onFixAllIssuesInChat,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [issueFeedback, setIssueFeedback] = useState<Record<string, "up" | "down" | null>>({});
  const pendingIssueScrollRef = useRef<{ filePath: string; line: number | null } | null>(null);

  const selectedChange = useMemo(
    () => changes.find((c) => c.id === selectedChangeId) ?? null,
    [changes, selectedChangeId]
  );

  const openIssues = useMemo(
    () => (issues || []).filter((i) => i.status === "open"),
    [issues]
  );

  const orderedIssues = useMemo(() => {
    return [...openIssues].sort((a, b) => {
      const pathCmp = a.filePath.localeCompare(b.filePath);
      if (pathCmp !== 0) return pathCmp;
      const aLine = a.startLine ?? 0;
      const bLine = b.startLine ?? 0;
      if (aLine !== bLine) return aLine - bLine;
      return a.title.localeCompare(b.title);
    });
  }, [openIssues]);

  const activeIssueIndex = useMemo(() => {
    if (!activeIssueId) return -1;
    return orderedIssues.findIndex((i) => i.id === activeIssueId);
  }, [activeIssueId, orderedIssues]);

  const activeIssue = useMemo(() => {
    if (activeIssueIndex < 0) return null;
    return orderedIssues[activeIssueIndex] ?? null;
  }, [activeIssueIndex, orderedIssues]);

  const issuesForSelectedFile = useMemo(() => {
    if (!selectedChange) return [] as ReviewIssue[];
    return orderedIssues.filter((i) => i.filePath === selectedChange.filePath);
  }, [orderedIssues, selectedChange]);

  const changeIdByFilePath = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of changes) {
      map.set(c.filePath, c.id);
    }
    return map;
  }, [changes]);

  const { lines, hunkStarts } = useMemo(() => {
    if (!selectedChange) return { lines: [] as DiffLine[], hunkStarts: [] as number[] };

    const parts = diffLines(selectedChange.oldContent, selectedChange.newContent);
    let diffIndex = 0;
    let displayIndex = 0;
    let oldLine = 1;
    let newLine = 1;
    const out: DiffLine[] = [];
    const starts: number[] = [];

    let prevWasContext = true;
    for (const part of parts) {
      const type = part.added ? "added" : part.removed ? "removed" : "context";
      const partLines = part.value
        .split("\n")
        .filter((line, i, arr) => !(i === arr.length - 1 && line === ""));

      for (const content of partLines) {
        const status = selectedChange.lineStatuses?.[diffIndex] || "pending";

        if (type !== "context" && prevWasContext) {
          starts.push(displayIndex);
        }

        const oldLineNumber = type === "added" ? null : oldLine;
        const newLineNumber = type === "removed" ? null : newLine;

        out.push({ displayIndex, diffIndex, type, content, status, oldLineNumber, newLineNumber });
        prevWasContext = type === "context";

        if (type === "context") {
          oldLine++;
          newLine++;
        } else if (type === "removed") {
          oldLine++;
        } else if (type === "added") {
          newLine++;
        }

        diffIndex++;
        displayIndex++;
      }
    }

    return { lines: out, hunkStarts: starts.length > 0 ? starts : [0] };
  }, [selectedChange]);

  const fileStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const l of lines) {
      if (l.type === "added") added++;
      else if (l.type === "removed") removed++;
    }
    return { added, removed };
  }, [lines]);

  const newLineToDisplayIndex = useMemo(() => {
    const map = new Map<number, number>();
    for (const l of lines) {
      if (l.newLineNumber !== null) {
        map.set(l.newLineNumber, l.displayIndex);
      }
    }
    return map;
  }, [lines]);

  const issueAnchors = useMemo(() => {
    const map = new Map<number, ReviewIssue[]>();
    if (!selectedChange || issuesForSelectedFile.length === 0) return map;

    for (const issue of issuesForSelectedFile) {
      const target = issue.startLine ?? null;
      const displayIdx =
        target !== null ? newLineToDisplayIndex.get(target) : undefined;
      const anchor = displayIdx ?? 0;
      const existing = map.get(anchor) ?? [];
      existing.push(issue);
      existing.sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
      map.set(anchor, existing);
    }
    return map;
  }, [issuesForSelectedFile, newLineToDisplayIndex, selectedChange]);

  const currentFileIndex = useMemo(() => {
    const idx = changes.findIndex((c) => c.id === selectedChangeId);
    return idx >= 0 ? idx : 0;
  }, [changes, selectedChangeId]);

  const goToFile = (nextIndex: number) => {
    if (changes.length === 0) return;
    const idx = (nextIndex + changes.length) % changes.length;
    onSelectChange(changes[idx].id);
  };

  const goToNextPendingFile = () => {
    if (changes.length === 0) return;
    const start = currentFileIndex;
    for (let i = 1; i <= changes.length; i++) {
      const idx = (start + i) % changes.length;
      if (changes[idx].status === "pending") {
        onSelectChange(changes[idx].id);
        return;
      }
    }
    // no pending, just advance
    goToFile(start + 1);
  };

  const scrollToDisplayIndex = (displayIdx: number) => {
    const el = scrollRef.current?.querySelector(`[data-review-line="${displayIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "center" });
  };

  const scrollToNewLine = (lineNumber: number | null) => {
    if (lineNumber === null) return;
    const displayIdx = newLineToDisplayIndex.get(lineNumber);
    if (displayIdx === undefined) return;
    scrollToDisplayIndex(displayIdx);
  };

  const goToHunk = (next: number) => {
    if (!hunkStarts || hunkStarts.length === 0) return;
    const idx = (next + hunkStarts.length) % hunkStarts.length;
    setCurrentHunkIndex(idx);
    scrollToDisplayIndex(hunkStarts[idx] ?? 0);
  };

  useEffect(() => {
    setCurrentHunkIndex(0);
    if (hunkStarts && hunkStarts.length > 0) {
      // scroll to first hunk on file change
      requestAnimationFrame(() => scrollToDisplayIndex(hunkStarts[0] ?? 0));
    }
  }, [selectedChangeId, hunkStarts]);

  // Maintain an active issue selection (Cursor-like)
  useEffect(() => {
    if (orderedIssues.length === 0) {
      if (activeIssueId !== null) setActiveIssueId(null);
      return;
    }
    if (activeIssueId && orderedIssues.some((i) => i.id === activeIssueId)) return;
    setActiveIssueId(orderedIssues[0]?.id ?? null);
  }, [activeIssueId, orderedIssues]);

  useEffect(() => {
    if (!selectedChange) return;
    if (issuesForSelectedFile.length === 0) return;

    const current = activeIssueId ? orderedIssues.find((i) => i.id === activeIssueId) : null;
    if (current?.filePath === selectedChange.filePath) return;
    setActiveIssueId(issuesForSelectedFile[0]?.id ?? null);
  }, [activeIssueId, issuesForSelectedFile, orderedIssues, selectedChange]);

  // If issue navigation triggers a file switch, scroll once the file is active.
  useEffect(() => {
    const pending = pendingIssueScrollRef.current;
    if (!pending) return;
    if (!selectedChange) return;
    if (pending.filePath !== selectedChange.filePath) return;

    pendingIssueScrollRef.current = null;
    requestAnimationFrame(() => scrollToNewLine(pending.line));
  }, [selectedChange, scrollToNewLine]);

  const goToIssueIndex = (idx: number) => {
    if (orderedIssues.length === 0) return;
    const clamped = (idx + orderedIssues.length) % orderedIssues.length;
    const issue = orderedIssues[clamped];
    if (!issue) return;

    setActiveIssueId(issue.id);
    const changeId = changeIdByFilePath.get(issue.filePath);
    pendingIssueScrollRef.current = { filePath: issue.filePath, line: issue.startLine ?? null };

    if (changeId && changeId !== selectedChangeId) {
      onSelectChange(changeId);
      return;
    }
    scrollToNewLine(issue.startLine ?? null);
  };

  const goToIssueByOffset = (delta: number) => {
    if (orderedIssues.length === 0) return;
    const cur = activeIssueIndex >= 0 ? activeIssueIndex : 0;
    goToIssueIndex(cur + delta);
  };

  useEffect(() => {
    if (!focusIssue) return;
    const issue = orderedIssues.find((i) => i.id === focusIssue.id) ?? null;
    if (!issue) return;

    setActiveIssueId(issue.id);
    const changeId = changeIdByFilePath.get(issue.filePath);
    pendingIssueScrollRef.current = { filePath: issue.filePath, line: issue.startLine ?? null };

    if (changeId && changeId !== selectedChangeId) {
      onSelectChange(changeId);
      return;
    }

    const lineNumber = issue.startLine ?? null;
    if (lineNumber === null) return;
    const displayIdx = newLineToDisplayIndex.get(lineNumber);
    if (displayIdx === undefined) return;
    requestAnimationFrame(() => scrollToDisplayIndex(displayIdx));
  }, [changeIdByFilePath, focusIssue, newLineToDisplayIndex, onSelectChange, orderedIssues, selectedChangeId]);

  useEffect(() => {
    if (!selectedChange) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (isTyping) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === "Enter") {
        e.preventDefault();
        void onAcceptFile(selectedChange.id);
        goToNextPendingFile();
        return;
      }
      if (cmd && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        onRejectFile(selectedChange.id);
        goToNextPendingFile();
        return;
      }

      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        goToHunk(currentHunkIndex - 1);
        return;
      }
      if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        goToHunk(currentHunkIndex + 1);
        return;
      }

      if (cmd && e.key === "[") {
        e.preventDefault();
        goToIssueByOffset(-1);
        return;
      }
      if (cmd && e.key === "]") {
        e.preventDefault();
        goToIssueByOffset(1);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentHunkIndex, goToNextPendingFile, onAcceptFile, onClose, onRejectFile, selectedChange, selectedChangeId, activeIssueIndex, orderedIssues.length]);

  if (!selectedChange) return null;

  return (
    <div className="absolute inset-0 z-40 bg-white text-zinc-900">
      {/* Top bar */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-zinc-200 bg-white">
        <div className="flex items-center gap-2 min-w-0">
          <Icons.File className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <div className="text-xs text-zinc-900 truncate font-medium">
            {selectedChange.fileName}
          </div>
          <div className="text-xs text-zinc-500 truncate">
            {selectedChange.filePath}
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="text-green-600">+{fileStats.added}</span>
            <span className="text-red-600">-{fileStats.removed}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {orderedIssues.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-zinc-700">
              <span className="text-zinc-600">{orderedIssues.length} Issues Found</span>
              <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-200 bg-zinc-50">
                <button
                  type="button"
                  onClick={() => goToIssueByOffset(-1)}
                  className="p-0.5 rounded hover:bg-zinc-200/60"
                  title="Previous issue (Cmd+[)"
                >
                  <Icons.ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="tabular-nums text-zinc-700">
                  Issue {(activeIssueIndex >= 0 ? activeIssueIndex : 0) + 1}/{orderedIssues.length}
                </span>
                <button
                  type="button"
                  onClick={() => goToIssueByOffset(1)}
                  className="p-0.5 rounded hover:bg-zinc-200/60"
                  title="Next issue (Cmd+])"
                >
                  <Icons.ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {onFindIssues && (
            <button
              type="button"
              onClick={onFindIssues}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 transition-colors"
              title="Find Issues"
            >
              <div className="flex items-center gap-1.5">
                <Icons.Search className="w-3.5 h-3.5" />
                {isFindingIssues ? "Finding…" : "Find Issues"}
              </div>
            </button>
          )}

          {onFixAllIssuesInChat && orderedIssues.length > 0 && (
            <button
              type="button"
              onClick={onFixAllIssuesInChat}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#4b8cff] hover:bg-[#3c7af0] text-white transition-colors"
              title="Fix All"
            >
              Fix All
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 transition-colors"
            title="Close (Esc)"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Diff */}
      <div
        ref={scrollRef}
        className="absolute inset-x-0 top-10 bottom-0 overflow-auto font-mono text-[13px] leading-6 pb-24"
      >
        {lines.map((line) => {
          const isActiveIssueLine = (() => {
            if (!activeIssue) return false;
            if (activeIssue.filePath !== selectedChange.filePath) return false;
            if (line.newLineNumber === null) return false;
            if (typeof activeIssue.startLine !== "number") return false;
            const end = typeof activeIssue.endLine === "number" ? activeIssue.endLine : activeIssue.startLine;
            return line.newLineNumber >= activeIssue.startLine && line.newLineNumber <= end;
          })();

          const bg =
            line.type === "added"
              ? line.status === "rejected"
                ? "bg-green-50 opacity-60 line-through"
                : line.status === "accepted"
                ? "bg-green-100"
                : "bg-green-50"
              : line.type === "removed"
              ? line.status === "accepted"
                ? "bg-red-100 opacity-60 line-through"
                : "bg-red-50"
              : "";

          const text =
            line.type === "added"
              ? "text-green-800"
              : line.type === "removed"
              ? "text-red-800"
              : "text-zinc-800";

          const sign = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const lineNumberText =
            line.newLineNumber !== null
              ? String(line.newLineNumber)
              : line.oldLineNumber !== null
              ? String(line.oldLineNumber)
              : "";

          return (
            <div key={line.displayIndex}>
              <div
                data-review-line={line.displayIndex}
                className={`group flex min-w-full ${bg} ${isActiveIssueLine ? "ring-1 ring-amber-500/15" : ""}`}
              >
                <div className="w-14 flex-shrink-0 select-none text-right pr-3 text-zinc-500 bg-zinc-50 border-r border-zinc-200">
                  {lineNumberText}
                </div>

                {line.type !== "context" && (
                  <div className="w-14 flex-shrink-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => onAcceptLine(selectedChange.id, line.diffIndex)}
                      className="p-1 text-green-700 hover:bg-green-100 rounded"
                      title="Accept this line"
                    >
                      <Icons.Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRejectLine(selectedChange.id, line.diffIndex)}
                      className="p-1 text-red-700 hover:bg-red-100 rounded"
                      title="Reject this line"
                    >
                      <Icons.X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {line.type === "context" && <div className="w-14 flex-shrink-0" />}

                <div className={`w-6 flex-shrink-0 text-center select-none ${text}`}>{sign}</div>
                <div className={`px-2 whitespace-pre-wrap break-all flex-1 ${text}`}>
                  {line.content || " "}
                </div>
              </div>

              {(issueAnchors.get(line.displayIndex) || []).map((issue) => {
                const sev =
                  issue.severity === "high"
                    ? "bg-red-50 text-red-700 border-red-200"
                    : issue.severity === "medium"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-blue-50 text-blue-700 border-blue-200";
                const feedback = issueFeedback[issue.id] ?? null;

                return (
                  <div
                    key={`${line.displayIndex}-issue-${issue.id}`}
                    className="flex min-w-full"
                  >
                    <div className="w-14 flex-shrink-0 bg-zinc-50 border-r border-zinc-200" />
                    <div className="w-14 flex-shrink-0" />
                    <div className="w-6 flex-shrink-0" />
                    <div className="flex-1 px-2 py-2">
                      <div
                        className={`rounded-lg border border-zinc-200 bg-white shadow-md overflow-hidden ${activeIssueId === issue.id ? "ring-1 ring-blue-500/20" : ""}`}
                      >
                        <div className="px-3 py-2 flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveIssueId(issue.id);
                              scrollToNewLine(issue.startLine ?? null);
                            }}
                            className="min-w-0 text-left"
                            title="Jump to issue"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-6 h-6 rounded-md bg-zinc-50 border border-zinc-200 flex items-center justify-center flex-shrink-0">
                                <Icons.Review className="w-3.5 h-3.5 text-zinc-600" />
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sev}`}>
                                {issue.severity.toUpperCase()}
                              </span>
                              <span className="text-sm font-medium text-zinc-900 truncate">
                                {issue.title}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-zinc-600">
                              {issue.filePath}
                              {issue.startLine ? `:${issue.startLine}` : ""}
                            </div>
                          </button>
                        </div>
                        <div className="px-3 pb-3 text-[12px] text-zinc-700 whitespace-pre-wrap leading-relaxed">
                          {issue.description}
                        </div>
                        <div className="px-3 py-2 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onFixIssueInChat?.(issue.id)}
                              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 transition-colors"
                            >
                              Fix in Chat
                            </button>
                            <button
                              type="button"
                              onClick={() => onDismissIssue?.(issue.id)}
                              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 transition-colors"
                            >
                              Dismiss
                            </button>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setIssueFeedback((prev) => ({
                                  ...prev,
                                  [issue.id]: prev[issue.id] === "up" ? null : "up",
                                }));
                              }}
                              className={`p-1.5 rounded border border-zinc-200 hover:bg-zinc-100 ${
                                feedback === "up" ? "text-zinc-900 bg-zinc-100" : "text-zinc-500"
                              }`}
                              title="Helpful"
                            >
                              <Icons.ThumbUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIssueFeedback((prev) => ({
                                  ...prev,
                                  [issue.id]: prev[issue.id] === "down" ? null : "down",
                                }));
                              }}
                              className={`p-1.5 rounded border border-zinc-200 hover:bg-zinc-100 ${
                                feedback === "down" ? "text-zinc-900 bg-zinc-100" : "text-zinc-500"
                              }`}
                              title="Not helpful"
                            >
                              <Icons.ThumbDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Floating review bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(720px,calc(100%-2rem))]">
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-zinc-200 bg-white shadow-xl">
          {/* Hunks */}
          <div className="flex items-center gap-2 text-xs text-zinc-700">
            <button
              type="button"
              onClick={() => goToHunk(currentHunkIndex - 1)}
              className="p-1.5 rounded-md hover:bg-zinc-100 text-zinc-700"
              title="Previous hunk (Alt+↑)"
            >
              <Icons.ArrowUp className="w-4 h-4" />
            </button>
            <span className="tabular-nums text-zinc-600">
              {hunkStarts.length > 0 ? currentHunkIndex + 1 : 0}/{hunkStarts.length}
            </span>
            <button
              type="button"
              onClick={() => goToHunk(currentHunkIndex + 1)}
              className="p-1.5 rounded-md hover:bg-zinc-100 text-zinc-700"
              title="Next hunk (Alt+↓)"
            >
              <Icons.ArrowDown className="w-4 h-4" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onRejectFile(selectedChange.id);
                goToNextPendingFile();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 transition-colors"
              title="Reject file (Cmd+Backspace)"
            >
              Reject file
            </button>
            <button
              type="button"
              onClick={() => {
                void onAcceptFile(selectedChange.id);
                goToNextPendingFile();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#4b8cff] hover:bg-[#3c7af0] text-white transition-colors"
              title="Accept file (Cmd+Enter)"
            >
              Accept file
            </button>
          </div>

          {/* Files */}
          <div className="flex items-center gap-2 text-xs text-zinc-700">
            <button
              type="button"
              onClick={() => goToFile(currentFileIndex - 1)}
              className="p-1.5 rounded-md hover:bg-zinc-100 text-zinc-700"
              title="Previous file"
            >
              <Icons.ChevronLeft className="w-4 h-4" />
            </button>
            <span className="tabular-nums text-zinc-600">
              {currentFileIndex + 1}/{changes.length} files
            </span>
            <button
              type="button"
              onClick={() => goToFile(currentFileIndex + 1)}
              className="p-1.5 rounded-md hover:bg-zinc-100 text-zinc-700"
              title="Next file"
            >
              <Icons.ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

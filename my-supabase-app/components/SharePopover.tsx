"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  nodeName: string;
  nodeId: string;
  isPublic: boolean;
  onTogglePublic: (isPublic: boolean) => Promise<void>;
  ownerEmail?: string;
};

type AccessRole = "viewer" | "editor";

export function SharePopover({
  isOpen,
  onClose,
  nodeName,
  nodeId,
  isPublic,
  onTogglePublic,
  ownerEmail,
}: Props) {
  const [isCopied, setIsCopied] = useState(false);
  const [accessRole, setAccessRole] = useState<AccessRole>("editor");
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const roleButtonRef = useRef<HTMLButtonElement | null>(null);
  const roleMenuRef = useRef<HTMLDivElement | null>(null);

  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin}/share/${nodeId}`
    : `https://cursor-clone.com/share/${nodeId}`;
  const safeNodeName = nodeName?.trim() || "ファイルやフォルダー名";
  const trimmedOwnerEmail = ownerEmail?.trim() || "";
  const ownerName = trimmedOwnerEmail ? trimmedOwnerEmail.split("@")[0] : "自分";
  const ownerDisplayName = `${ownerName} (you)`;
  const ownerInitial = ownerName[0]?.toUpperCase() || "U";

  useEffect(() => {
    if (!isOpen) {
      setIsCopied(false);
      setIsRoleMenuOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = publicUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand("copy");
      } catch {
        // Ignore clipboard fallback errors
      }
      document.body.removeChild(textarea);
    }

    if (!isPublic) {
      void onTogglePublic(true);
    }

    setIsCopied(true);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000);
  };

  if (!isOpen) return null;

  const roleLabel = accessRole === "editor" ? "編集者" : "閲覧者";
  const roleDescription = accessRole === "editor"
    ? "リンクを知っているインターネット上の誰もが編集できます"
    : "リンクを知っているインターネット上の誰もが閲覧できます";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="relative w-[560px] max-w-[92vw] rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        onMouseDown={(event) => {
          const target = event.target as Node;
          if (roleButtonRef.current?.contains(target) || roleMenuRef.current?.contains(target)) {
            return;
          }
          setIsRoleMenuOpen(false);
        }}
      >
        <div className="px-6 pt-5">
          <div className="text-lg font-semibold text-zinc-900">
            「{safeNodeName}」を共有
          </div>
        </div>

        <div className="px-6 pb-6 pt-4 space-y-6">
          <div>
            <div className="text-sm font-semibold text-zinc-700 mb-3">
              アクセスできるユーザー
            </div>
            <div className="flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-200 flex items-center justify-center text-sm font-medium text-zinc-600">
                  {ownerInitial}
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-900">
                    {ownerDisplayName}
                  </div>
                  {trimmedOwnerEmail ? (
                    <div className="text-xs text-zinc-500">{trimmedOwnerEmail}</div>
                  ) : null}
                </div>
              </div>
              <div className="text-xs text-zinc-400">オーナー</div>
            </div>
          </div>

          <div className="border-t border-zinc-100" />

          <div>
            <div className="text-sm font-semibold text-zinc-700 mb-3">
              一般的なアクセス
            </div>
            <div className="relative flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18" />
                    <path d="M12 3c2.5 2.8 4 6 4 9s-1.5 6.2-4 9" />
                    <path d="M12 3c-2.5 2.8-4 6-4 9s1.5 6.2 4 9" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-900">
                    リンクを知っている全員
                  </div>
                  <div className="text-xs text-zinc-500">{roleDescription}</div>
                </div>
              </div>
              <div className="relative">
                <button
                  ref={roleButtonRef}
                  type="button"
                  onClick={() => setIsRoleMenuOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-zinc-700 hover:text-zinc-900"
                  aria-haspopup="listbox"
                  aria-expanded={isRoleMenuOpen}
                >
                  {roleLabel}
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M5.5 7.5l4.5 4.5 4.5-4.5" />
                  </svg>
                </button>
                {isRoleMenuOpen ? (
                  <div
                    ref={roleMenuRef}
                    className="absolute right-0 top-full mt-2 w-44 rounded-lg border border-zinc-200 bg-white shadow-xl py-1 z-10"
                    role="listbox"
                  >
                    <div className="px-3 py-2 text-[11px] text-zinc-400">役割</div>
                    <button
                      type="button"
                      onClick={() => {
                        setAccessRole("viewer");
                        setIsRoleMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                    >
                      閲覧者
                      {accessRole === "viewer" ? (
                        <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccessRole("editor");
                        setIsRoleMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                    >
                      編集者
                      {accessRole === "editor" ? (
                        <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : null}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleCopyUrl}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 12" />
                <path d="M14 11a5 5 0 0 1 0 7L12.5 20.5a5 5 0 1 1-7-7L7 12" />
              </svg>
              リンクをコピー
            </button>
            <button
              onClick={onClose}
              className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              完了
            </button>
          </div>
        </div>

        {isCopied ? (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-zinc-800 px-4 py-2 text-xs text-white shadow-lg">
            リンクをコピーしました
          </div>
        ) : null}
      </div>
    </div>
  );
}

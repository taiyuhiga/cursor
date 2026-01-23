"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type SharedUser = {
  id: string;
  email: string;
  displayName: string;
  role: "viewer" | "editor";
  userId: string | null;
};

type AccessType = "restricted" | "public";
type AccessRole = "viewer" | "editor";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  nodeName: string;
  nodeId: string;
  isPublic: boolean;
  onTogglePublic: (isPublic: boolean) => Promise<void>;
  ownerEmail?: string;
  isWorkspace?: boolean;
};

export function SharePopover({
  isOpen,
  onClose,
  nodeName,
  nodeId,
  isPublic,
  onTogglePublic,
  ownerEmail,
  isWorkspace = false,
}: Props) {
  const [isCopied, setIsCopied] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([]);
  const [accessType, setAccessType] = useState<AccessType>(isPublic ? "public" : "restricted");
  const [publicRole, setPublicRole] = useState<AccessRole>("editor");
  const [isAccessMenuOpen, setIsAccessMenuOpen] = useState(false);
  const [isPublicRoleMenuOpen, setIsPublicRoleMenuOpen] = useState(false);
  const [openUserRoleMenuId, setOpenUserRoleMenuId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyTimeoutRef = useRef<number | null>(null);
  const accessButtonRef = useRef<HTMLButtonElement | null>(null);
  const accessMenuRef = useRef<HTMLDivElement | null>(null);
  const publicRoleButtonRef = useRef<HTMLButtonElement | null>(null);
  const publicRoleMenuRef = useRef<HTMLDivElement | null>(null);

  const sharePath = isWorkspace ? `/share/workspace/${nodeId}` : `/share/${nodeId}`;
  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin}${sharePath}`
    : `https://cursor-clone.com${sharePath}`;
  const safeNodeName = nodeName?.trim() || "ファイルやフォルダー名";
  const trimmedOwnerEmail = ownerEmail?.trim() || "";
  const ownerName = trimmedOwnerEmail ? trimmedOwnerEmail.split("@")[0] : "自分";
  const ownerDisplayName = `${ownerName} (you)`;
  const ownerInitial = ownerName[0]?.toUpperCase() || "U";

  // Fetch shared users when dialog opens
  const fetchSharedUsers = useCallback(async () => {
    if (!nodeId) return;
    try {
      const res = await fetch(`/api/share?nodeId=${nodeId}`);
      const data = await res.json();
      if (data.sharedUsers) {
        setSharedUsers(data.sharedUsers);
      }
      setAccessType(data.isPublic ? "public" : "restricted");
    } catch {
      // Ignore fetch errors
    }
  }, [nodeId]);

  useEffect(() => {
    if (isOpen) {
      fetchSharedUsers();
    }
  }, [isOpen, fetchSharedUsers]);

  useEffect(() => {
    if (!isOpen) {
      setIsCopied(false);
      setEmailInput("");
      setIsAccessMenuOpen(false);
      setIsPublicRoleMenuOpen(false);
      setOpenUserRoleMenuId(null);
      setError(null);
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

  const handleInvite = async () => {
    if (!emailInput.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invite",
          nodeId,
          email: emailInput.trim(),
          role: "viewer",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to invite user");
        return;
      }

      if (data.share) {
        setSharedUsers(prev => [...prev, data.share]);
      }
      setEmailInput("");
    } catch {
      setError("Failed to invite user");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveUser = async (shareId: string) => {
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          shareId,
        }),
      });

      if (res.ok) {
        setSharedUsers(prev => prev.filter(u => u.id !== shareId));
      }
    } catch {
      // Ignore errors
    }
    setOpenUserRoleMenuId(null);
  };

  const handleUpdateUserRole = async (shareId: string, newRole: AccessRole) => {
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_role",
          shareId,
          role: newRole,
        }),
      });

      if (res.ok) {
        setSharedUsers(prev => prev.map(u =>
          u.id === shareId ? { ...u, role: newRole } : u
        ));
      }
    } catch {
      // Ignore errors
    }
    setOpenUserRoleMenuId(null);
  };

  const handleAccessTypeChange = async (newType: AccessType) => {
    setAccessType(newType);
    setIsAccessMenuOpen(false);

    const newIsPublic = newType === "public";
    if (newIsPublic !== isPublic) {
      await onTogglePublic(newIsPublic);
    }
  };

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

    setIsCopied(true);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000);
  };

  if (!isOpen) return null;

  const accessLabel = accessType === "public" ? "リンクを知っている全員" : "制限付き";
  const accessDescription = accessType === "public"
    ? (publicRole === "editor"
        ? "リンクを知っているインターネット上の誰もが編集できます"
        : "リンクを知っているインターネット上の誰もが閲覧できます")
    : "アクセス権のあるユーザーのみが、リンクから開くことができます";
  const publicRoleLabel = publicRole === "editor" ? "編集者" : "閲覧者";

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
          if (
            accessButtonRef.current?.contains(target) ||
            accessMenuRef.current?.contains(target) ||
            publicRoleButtonRef.current?.contains(target) ||
            publicRoleMenuRef.current?.contains(target)
          ) {
            return;
          }
          setIsAccessMenuOpen(false);
          setIsPublicRoleMenuOpen(false);
          setOpenUserRoleMenuId(null);
        }}
      >
        <div className="px-6 pt-5">
          <div className="text-lg font-semibold text-zinc-900">
            「{safeNodeName}」を共有
          </div>
        </div>

        <div className="px-6 pb-6 pt-4 space-y-5">
          {/* Email Input */}
          <div>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleInvite();
                  }
                }}
                placeholder="メールアドレスを追加"
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleInvite}
                disabled={!emailInput.trim() || isLoading}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? "..." : "招待"}
              </button>
            </div>
            {error && (
              <div className="mt-2 text-xs text-red-500">{error}</div>
            )}
          </div>

          {/* Access Users */}
          <div>
            <div className="text-sm font-semibold text-zinc-700 mb-3">
              アクセスできるユーザー
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {/* Owner */}
              <div className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-zinc-50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-zinc-200 flex items-center justify-center text-sm font-medium text-zinc-600">
                    {ownerInitial}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-zinc-900">
                      {ownerDisplayName}
                    </div>
                    {trimmedOwnerEmail && (
                      <div className="text-xs text-zinc-500">{trimmedOwnerEmail}</div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-zinc-400">オーナー</div>
              </div>

              {/* Shared Users */}
              {sharedUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-zinc-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium text-blue-600">
                      {user.displayName[0]?.toUpperCase() || "U"}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-zinc-900">
                        {user.displayName}
                      </div>
                      <div className="text-xs text-zinc-500">{user.email}</div>
                    </div>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenUserRoleMenuId(openUserRoleMenuId === user.id ? null : user.id)}
                      className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:bg-zinc-200 rounded px-2 py-1 transition-colors"
                    >
                      {user.role === "editor" ? "編集者" : "閲覧者"}
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M5.5 7.5l4.5 4.5 4.5-4.5" />
                      </svg>
                    </button>
                    {openUserRoleMenuId === user.id && (
                      <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-zinc-200 bg-white shadow-xl py-1 z-20">
                        <button
                          type="button"
                          onClick={() => handleUpdateUserRole(user.id, "viewer")}
                          className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                        >
                          閲覧者
                          {user.role === "viewer" && (
                            <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateUserRole(user.id, "editor")}
                          className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                        >
                          編集者
                          {user.role === "editor" && (
                            <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                        <div className="border-t border-zinc-100 my-1" />
                        <button
                          type="button"
                          onClick={() => handleRemoveUser(user.id)}
                          className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                        >
                          アクセス権を削除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* General Access */}
          <div>
            <div className="text-sm font-semibold text-zinc-700 mb-3">
              一般的なアクセス
            </div>
            <div className="relative flex items-center justify-between gap-4 rounded-lg hover:bg-zinc-50 px-2 py-2 transition-colors">
              <div className="flex items-center gap-3">
                <div className={`flex w-9 h-9 items-center justify-center rounded-full ${
                  accessType === "public" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"
                }`}>
                  {accessType === "public" ? (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18" />
                      <path d="M12 3c2.5 2.8 4 6 4 9s-1.5 6.2-4 9" />
                      <path d="M12 3c-2.5 2.8-4 6-4 9s1.5 6.2 4 9" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="relative inline-block">
                    <button
                      ref={accessButtonRef}
                      type="button"
                      onClick={() => setIsAccessMenuOpen(prev => !prev)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-zinc-900 hover:bg-zinc-200 rounded px-2 py-1 -ml-2 transition-colors"
                    >
                      {accessLabel}
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M5.5 7.5l4.5 4.5 4.5-4.5" />
                      </svg>
                    </button>
                    {isAccessMenuOpen && (
                      <div
                        ref={accessMenuRef}
                        className="absolute left-0 top-full mt-1 w-52 rounded-lg border border-zinc-200 bg-white shadow-xl py-1 z-20"
                      >
                        <button
                          type="button"
                          onClick={() => handleAccessTypeChange("restricted")}
                          className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                        >
                          制限付き
                          {accessType === "restricted" && (
                            <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAccessTypeChange("public")}
                          className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                        >
                          リンクを知っている全員
                          {accessType === "public" && (
                            <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">{accessDescription}</div>
                </div>
              </div>

              {/* Public Role selector - only show when public */}
              {accessType === "public" && (
                <div className="relative">
                  <button
                    ref={publicRoleButtonRef}
                    type="button"
                    onClick={() => setIsPublicRoleMenuOpen(prev => !prev)}
                    className="inline-flex items-center gap-1 text-sm font-medium text-zinc-700 hover:bg-zinc-200 rounded px-2 py-1 transition-colors"
                  >
                    {publicRoleLabel}
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M5.5 7.5l4.5 4.5 4.5-4.5" />
                    </svg>
                  </button>
                  {isPublicRoleMenuOpen && (
                    <div
                      ref={publicRoleMenuRef}
                      className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-zinc-200 bg-white shadow-xl py-1 z-20"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPublicRole("viewer");
                          setIsPublicRoleMenuOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                      >
                        閲覧者
                        {publicRole === "viewer" && (
                          <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPublicRole("editor");
                          setIsPublicRoleMenuOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                      >
                        編集者
                        {publicRole === "editor" && (
                          <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleCopyUrl}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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

        {isCopied && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-zinc-800 px-4 py-2 text-xs text-white shadow-lg">
            リンクをコピーしました
          </div>
        )}
      </div>
    </div>
  );
}

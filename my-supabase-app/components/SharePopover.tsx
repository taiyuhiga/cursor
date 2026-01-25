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

type PendingInvite = {
  email: string;
  id: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  nodeName: string;
  nodeId: string;
  isPublic: boolean;
  isPublicLoaded?: boolean;
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
  isPublicLoaded = true,
  onTogglePublic,
  ownerEmail,
  isWorkspace = false,
}: Props) {
  const [isCopied, setIsCopied] = useState(false);
  const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([]);
  const [accessType, setAccessType] = useState<AccessType>("public");
  const [publicRole, setPublicRole] = useState<AccessRole>("viewer");
  const [isAccessMenuOpen, setIsAccessMenuOpen] = useState(false);
  const [isPublicRoleMenuOpen, setIsPublicRoleMenuOpen] = useState(false);
  const [openUserRoleMenuId, setOpenUserRoleMenuId] = useState<string | null>(null);
  const [userRoleMenuPosition, setUserRoleMenuPosition] = useState<{ top: number; right: number } | null>(null);

  // Invite panel state
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [inviteEmailInput, setInviteEmailInput] = useState("");
  const [inviteRole, setInviteRole] = useState<AccessRole>("editor");
  const [isInviteRoleMenuOpen, setIsInviteRoleMenuOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Email history for suggestions
  const [emailHistory, setEmailHistory] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const copyTimeoutRef = useRef<number | null>(null);
  const accessButtonRef = useRef<HTMLButtonElement | null>(null);
  const accessMenuRef = useRef<HTMLDivElement | null>(null);
  const publicRoleButtonRef = useRef<HTMLButtonElement | null>(null);
  const publicRoleMenuRef = useRef<HTMLDivElement | null>(null);
  const inviteRoleButtonRef = useRef<HTMLButtonElement | null>(null);
  const inviteRoleMenuRef = useRef<HTMLDivElement | null>(null);
  const inviteInputRef = useRef<HTMLInputElement | null>(null);

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
      setIsAccessMenuOpen(false);
      setIsPublicRoleMenuOpen(false);
      setOpenUserRoleMenuId(null);
      setUserRoleMenuPosition(null);
      setShowInvitePanel(false);
      setPendingInvites([]);
      setInviteEmailInput("");
      setInviteRole("editor");
      setInviteError(null);
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
        if (showInvitePanel) {
          setShowInvitePanel(false);
          setPendingInvites([]);
          setInviteEmailInput("");
          setInviteError(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showInvitePanel]);

  // Focus input when invite panel opens
  useEffect(() => {
    if (showInvitePanel && inviteInputRef.current) {
      inviteInputRef.current.focus();
    }
  }, [showInvitePanel]);

  // Load email history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("share_email_history");
      if (saved) {
        setEmailHistory(JSON.parse(saved));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save email to history
  const saveEmailToHistory = useCallback((email: string) => {
    setEmailHistory(prev => {
      const normalized = email.toLowerCase();
      // Remove if already exists, then add to front
      const filtered = prev.filter(e => e !== normalized);
      const updated = [normalized, ...filtered].slice(0, 50); // Keep max 50
      try {
        localStorage.setItem("share_email_history", JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, []);

  // Common email domains whitelist
  const commonDomains = [
    "gmail.com",
    "yahoo.com",
    "yahoo.co.jp",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "icloud.com",
    "protonmail.com",
    "mail.com",
    "aol.com",
    "zoho.com",
    "yandex.com",
    "gmx.com",
    "tutanota.com",
  ];

  // Check if current input is a valid email with known domain
  const currentInputEmail = inviteEmailInput.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const isValidFormat = emailRegex.test(currentInputEmail);
  const domain = currentInputEmail.split("@")[1] || "";
  const isKnownDomain = commonDomains.includes(domain) ||
    // Education domains worldwide
    domain.endsWith(".edu") ||
    domain.endsWith(".ac.jp") || domain.endsWith(".ed.jp") ||
    domain.endsWith(".ac.uk") || domain.endsWith(".edu.au") ||
    domain.endsWith(".edu.cn") || domain.endsWith(".edu.tw") ||
    domain.endsWith(".ac.kr") || domain.endsWith(".edu.sg") ||
    domain.endsWith(".edu.hk") || domain.endsWith(".ac.in") ||
    domain.endsWith(".edu.br") || domain.endsWith(".edu.mx") ||
    domain.endsWith(".edu.fr") || domain.endsWith(".edu.de") ||
    // Japan domains
    domain.endsWith(".go.jp") || domain.endsWith(".co.jp") ||
    domain.endsWith(".ne.jp") || domain.endsWith(".or.jp") ||
    // International company/org domains
    domain.endsWith(".co.uk") || domain.endsWith(".com.au") ||
    domain.endsWith(".co.kr") || domain.endsWith(".com.cn") ||
    domain.endsWith(".com.tw") || domain.endsWith(".com.sg") ||
    domain.endsWith(".com.hk") || domain.endsWith(".co.in") ||
    domain.endsWith(".com.br") || domain.endsWith(".com.mx") ||
    // Government domains
    domain.endsWith(".gov") || domain.endsWith(".gov.uk") ||
    domain.endsWith(".gov.au") || domain.endsWith(".go.kr");

  const isCurrentInputValid = isValidFormat && isKnownDomain &&
    !pendingInvites.some(p => p.email === currentInputEmail) &&
    !sharedUsers.some(u => u.email === currentInputEmail);

  // Get filtered suggestions based on input (from localStorage history)
  const historySuggestions = emailHistory
    .filter(email =>
      (inviteEmailInput.trim() === "" || email.includes(inviteEmailInput.toLowerCase())) &&
      !pendingInvites.some(p => p.email === email) &&
      !sharedUsers.some(u => u.email === email) &&
      email !== currentInputEmail
    )
    .slice(0, 5);

  // Combine: current valid input + history suggestions
  const filteredSuggestions = isCurrentInputValid
    ? [currentInputEmail, ...historySuggestions].slice(0, 5)
    : historySuggestions;

  // Select a suggestion
  const selectSuggestion = (email: string) => {
    if (!pendingInvites.some(p => p.email === email) && !sharedUsers.some(u => u.email === email)) {
      setPendingInvites(prev => [...prev, { email, id: crypto.randomUUID() }]);
    }
    setInviteEmailInput("");
    // Keep suggestions visible for remaining suggestions
    setShowSuggestions(true);
    inviteInputRef.current?.focus();
  };

  const addPendingInvite = () => {
    const email = inviteEmailInput.trim().toLowerCase();
    if (!email) return;

    // Email format validation (xxx@xxx.xx)
    const validEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!validEmailRegex.test(email)) {
      setInviteError("有効なメールアドレスを入力してください");
      return;
    }

    // Check for duplicates
    if (pendingInvites.some(p => p.email === email)) {
      setInviteError("このメールアドレスは既に追加されています");
      return;
    }

    // Check if already shared
    if (sharedUsers.some(u => u.email === email)) {
      setInviteError("このユーザーは既にアクセス権を持っています");
      return;
    }

    setPendingInvites(prev => [...prev, { email, id: crypto.randomUUID() }]);
    setInviteEmailInput("");
    setInviteError(null);
  };

  const removePendingInvite = (id: string) => {
    setPendingInvites(prev => prev.filter(p => p.id !== id));
  };

  const handleSendInvites = async () => {
    // First add any remaining input as a pending invite
    let currentPendingInvites = [...pendingInvites];
    if (inviteEmailInput.trim()) {
      const email = inviteEmailInput.trim().toLowerCase();
      if (email.includes("@") && !currentPendingInvites.some(p => p.email === email) && !sharedUsers.some(u => u.email === email)) {
        currentPendingInvites.push({ email, id: crypto.randomUUID() });
      }
    }

    // Use pendingInvites for emails
    const emails = currentPendingInvites.map(p => p.email);

    if (emails.length === 0) {
      // If no pending invites, try to parse the current input
      const inputEmail = inviteEmailInput.trim().toLowerCase();
      if (!inputEmail) return;
      if (!inputEmail.includes("@")) {
        setInviteError("有効なメールアドレスを入力してください");
        return;
      }
      emails.push(inputEmail);
    }

    // Check for duplicates with existing shared users
    const alreadyShared = emails.filter(e => sharedUsers.some(u => u.email === e));
    if (alreadyShared.length > 0) {
      setInviteError(`既にアクセス権があります: ${alreadyShared.join(", ")}`);
      return;
    }

    // Optimistic update: immediately add users and go back to main panel
    const optimisticUsers: SharedUser[] = emails.map(email => ({
      id: `temp-${crypto.randomUUID()}`,
      email,
      displayName: email.split("@")[0],
      role: inviteRole,
      userId: null,
    }));

    setSharedUsers(prev => [...prev, ...optimisticUsers]);
    setInviteEmailInput("");
    setPendingInvites([]);
    setShowInvitePanel(false);
    setInviteError(null);

    // Save emails to history
    emails.forEach(email => saveEmailToHistory(email));

    // Make API calls in background
    try {
      const results = await Promise.all(
        emails.map(async (email) => {
          const res = await fetch("/api/share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "invite",
              nodeId,
              email,
              role: inviteRole,
            }),
          });
          const data = await res.json();
          return { success: res.ok, data, email };
        })
      );

      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      // Update with real IDs from successful invites
      if (successful.length > 0) {
        setSharedUsers(prev => {
          const updated = [...prev];
          successful.forEach(r => {
            if (r.data.share) {
              const tempIndex = updated.findIndex(u => u.id.startsWith("temp-") && u.email === r.email);
              if (tempIndex !== -1) {
                updated[tempIndex] = r.data.share;
              }
            }
          });
          return updated;
        });
      }

      // Remove failed invites from shared users
      if (failed.length > 0) {
        const failedEmails = failed.map(f => f.email);
        setSharedUsers(prev => prev.filter(u => !u.id.startsWith("temp-") || !failedEmails.includes(u.email)));
        // Could show a toast/notification here for failed invites
        console.error("Failed invites:", failed.map(f => f.data?.error));
      }
    } catch {
      // Remove all optimistic users on error
      setSharedUsers(prev => prev.filter(u => !u.id.startsWith("temp-")));
      console.error("招待の送信に失敗しました");
    }
  };

  const handleRemoveUser = async (shareId: string) => {
    // Optimistic update: immediately remove user
    const removedUser = sharedUsers.find(u => u.id === shareId);
    setSharedUsers(prev => prev.filter(u => u.id !== shareId));
    setOpenUserRoleMenuId(null);

    // Make API call in background
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          shareId,
        }),
      });

      if (!res.ok && removedUser) {
        // Restore user if API failed
        setSharedUsers(prev => [...prev, removedUser]);
      }
    } catch {
      // Restore user if API failed
      if (removedUser) {
        setSharedUsers(prev => [...prev, removedUser]);
      }
    }
  };

  const handleUpdateUserRole = async (shareId: string, newRole: AccessRole) => {
    // Optimistic update: immediately update role
    const previousRole = sharedUsers.find(u => u.id === shareId)?.role;
    setSharedUsers(prev => prev.map(u =>
      u.id === shareId ? { ...u, role: newRole } : u
    ));
    setOpenUserRoleMenuId(null);

    // Make API call in background
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

      if (!res.ok && previousRole) {
        // Restore previous role if API failed
        setSharedUsers(prev => prev.map(u =>
          u.id === shareId ? { ...u, role: previousRole } : u
        ));
      }
    } catch {
      // Restore previous role if API failed
      if (previousRole) {
        setSharedUsers(prev => prev.map(u =>
          u.id === shareId ? { ...u, role: previousRole } : u
        ));
      }
    }
  };

  const handleAccessTypeChange = async (newType: AccessType) => {
    if (!isPublicLoaded) return;
    const previousType = accessType;
    const previousIsPublic = isPublic;
    setAccessType(newType);
    setIsAccessMenuOpen(false);

    const newIsPublic = newType === "public";
    try {
      // Always send the intent to the server to avoid stale state mismatches.
      await onTogglePublic(newIsPublic);
    } catch (error) {
      console.error("Failed to update access type:", error);
      setAccessType(previousType);
      if (previousIsPublic !== newIsPublic) {
        // Reopen menu so the user sees the revert.
        setIsAccessMenuOpen(true);
      }
    }
  };

  const handlePublicRoleChange = async (newRole: AccessRole) => {
    if (!isPublicLoaded) return;
    setPublicRole(newRole);
    setIsPublicRoleMenuOpen(false);

    // Save the public role to the database
    try {
      await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_public_role",
          nodeId,
          publicAccessRole: newRole,
        }),
      });
    } catch {
      // Ignore errors for now
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

  useEffect(() => {
    if (!isOpen || !isPublicLoaded) return;
    setAccessType(isPublic ? "public" : "restricted");
  }, [isOpen, isPublic, isPublicLoaded]);

  if (!isOpen) return null;

  const controlsDisabled = !isPublicLoaded;
  const accessLabel = accessType === "public" ? "リンクを知っている全員" : "制限付き";
  const accessDescription = !isPublicLoaded
    ? "アクセス設定を読み込み中..."
    : accessType === "public"
      ? (publicRole === "editor"
          ? "リンクを知っているインターネット上の誰もが編集できます"
          : "リンクを知っているインターネット上の誰もが閲覧できます")
      : "アクセス権のあるユーザーのみが、リンクから開くことができます";
  const publicRoleLabel = publicRole === "editor" ? "編集者" : "閲覧者";
  const inviteRoleLabel = inviteRole === "editor" ? "編集者" : "閲覧者";

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
            publicRoleMenuRef.current?.contains(target) ||
            inviteRoleButtonRef.current?.contains(target) ||
            inviteRoleMenuRef.current?.contains(target)
          ) {
            return;
          }
          setIsAccessMenuOpen(false);
          setIsPublicRoleMenuOpen(false);
          setOpenUserRoleMenuId(null);
          setIsInviteRoleMenuOpen(false);
        }}
      >
        {/* Panels */}
        {!showInvitePanel ? (
          /* Main Panel */
          <div>
            <div className="px-6 pt-5">
              <div className="text-lg font-semibold text-zinc-900">
                「{safeNodeName}」を共有
              </div>
            </div>

            <div className="px-6 pb-6 pt-4 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* Email Input - Click to open invite panel */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowInvitePanel(true)}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-left text-zinc-400 hover:border-zinc-400 transition-colors"
                >
                  メールアドレスを追加
                </button>
                <button
                  type="button"
                  onClick={() => setShowInvitePanel(true)}
                  className="rounded-full bg-blue-600/50 px-5 py-2 text-sm font-medium text-white hover:bg-blue-600/60 transition-colors"
                >
                  招待
                </button>
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
                        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                          </svg>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-zinc-900">
                            {user.displayName}
                          </div>
                          <div className="text-xs text-zinc-500">{user.email}</div>
                        </div>
                      </div>
                      <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => {
                            if (openUserRoleMenuId === user.id) {
                              setOpenUserRoleMenuId(null);
                              setUserRoleMenuPosition(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setUserRoleMenuPosition({
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              });
                              setOpenUserRoleMenuId(user.id);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:bg-zinc-200 rounded px-2 py-1 transition-colors"
                        >
                          {user.role === "editor" ? "編集者" : "閲覧者"}
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M5.5 7.5l4.5 4.5 4.5-4.5" />
                          </svg>
                        </button>
                        {openUserRoleMenuId === user.id && userRoleMenuPosition && (
                          <div
                            className="fixed w-36 rounded-lg border border-zinc-200 bg-white shadow-xl py-1 z-[100]"
                            style={{
                              top: userRoleMenuPosition.top,
                              right: userRoleMenuPosition.right,
                            }}
                          >
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
                          disabled={controlsDisabled}
                          onClick={() => {
                            if (controlsDisabled) return;
                            setIsAccessMenuOpen(prev => !prev);
                          }}
                          className="inline-flex items-center gap-1 text-sm font-medium text-zinc-900 hover:bg-zinc-200 rounded px-2 py-1 -ml-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                        disabled={controlsDisabled}
                        onClick={() => {
                          if (controlsDisabled) return;
                          setIsPublicRoleMenuOpen(prev => !prev);
                        }}
                        className="inline-flex items-center gap-1 text-sm font-medium text-zinc-700 hover:bg-zinc-200 rounded px-2 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                            onClick={() => handlePublicRoleChange("viewer")}
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
                            onClick={() => handlePublicRoleChange("editor")}
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
        ) : (
          /* Invite Panel */
          <div>
            <div className="px-6 pt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowInvitePanel(false);
                  setPendingInvites([]);
                  setInviteEmailInput("");
                  setInviteError(null);
                }}
                className="p-1 -ml-1 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5" />
                  <path d="M12 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="text-lg font-semibold text-zinc-900">
                「{safeNodeName}」を共有
              </div>
            </div>

            <div className="px-6 pb-6 pt-4 space-y-4">
              {/* Email input row with role selector */}
              <div className="flex gap-3 items-start">
                {/* Email chips input */}
                <div className="relative flex-1">
                  <div
                    className="w-full rounded-lg border border-zinc-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 px-2 py-2 cursor-text max-h-[160px] overflow-y-auto"
                    onClick={() => inviteInputRef.current?.focus()}
                  >
                    <div className="flex flex-col gap-1.5">
                      {/* Email chips - one per line */}
                      {pendingInvites.map((invite) => {
                        const initial = invite.email[0]?.toUpperCase() || "?";
                        const colors = [
                          { bg: "bg-teal-600", text: "text-white" },
                          { bg: "bg-blue-600", text: "text-white" },
                          { bg: "bg-purple-600", text: "text-white" },
                          { bg: "bg-pink-600", text: "text-white" },
                          { bg: "bg-orange-600", text: "text-white" },
                          { bg: "bg-green-600", text: "text-white" },
                        ];
                        const colorIndex = invite.email.charCodeAt(0) % colors.length;
                        const color = colors[colorIndex];

                        return (
                          <div
                            key={invite.id}
                            className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white pl-1.5 pr-2 py-1 text-sm self-start max-w-full"
                          >
                            <div className={`w-6 h-6 rounded-full ${color.bg} flex items-center justify-center text-xs font-medium ${color.text} flex-shrink-0`}>
                              {initial}
                            </div>
                            <span className="text-zinc-700 truncate">{invite.email}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removePendingInvite(invite.id);
                              }}
                              className="text-zinc-400 hover:text-zinc-600 transition-colors flex-shrink-0"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                      {/* Input field */}
                      <input
                        ref={inviteInputRef}
                        type="text"
                        value={inviteEmailInput}
                        onChange={(e) => {
                          const value = e.target.value;
                          setInviteError(null);
                          setShowSuggestions(true);

                          if (value.endsWith(" ") || value.endsWith(",")) {
                            const emailPart = value.slice(0, -1).trim().toLowerCase();
                            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                            if (emailRegex.test(emailPart)) {
                              if (!pendingInvites.some(p => p.email === emailPart) && !sharedUsers.some(u => u.email === emailPart)) {
                                setPendingInvites(prev => [...prev, { email: emailPart, id: crypto.randomUUID() }]);
                                setInviteEmailInput("");
                                return;
                              }
                            }
                          }
                          setInviteEmailInput(value);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => {
                          setTimeout(() => {
                            setShowSuggestions(false);
                            const email = inviteEmailInput.trim().toLowerCase();
                            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                            if (emailRegex.test(email)) {
                              if (!pendingInvites.some(p => p.email === email) && !sharedUsers.some(u => u.email === email)) {
                                setPendingInvites(prev => [...prev, { email, id: crypto.randomUUID() }]);
                                setInviteEmailInput("");
                              }
                            }
                          }, 150);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            addPendingInvite();
                          } else if (e.key === "Backspace" && inviteEmailInput === "" && pendingInvites.length > 0) {
                            removePendingInvite(pendingInvites[pendingInvites.length - 1].id);
                          } else if (e.key === "Escape") {
                            setShowSuggestions(false);
                          }
                        }}
                        onPaste={(e) => {
                          const pastedText = e.clipboardData.getData("text");
                          if (pastedText.includes(",") || pastedText.includes(" ") || pastedText.includes("\n")) {
                            e.preventDefault();
                            const emails = pastedText
                              .split(/[,\s\n]+/)
                              .map(email => email.trim().toLowerCase())
                              .filter(email => email.length > 0 && email.includes("@"));

                            emails.forEach(email => {
                              if (!pendingInvites.some(p => p.email === email) && !sharedUsers.some(u => u.email === email)) {
                                setPendingInvites(prev => [...prev, { email, id: crypto.randomUUID() }]);
                              }
                            });
                          }
                        }}
                        placeholder={pendingInvites.length === 0 ? "メールアドレスを入力" : ""}
                        className="w-full text-sm outline-none bg-transparent py-1 px-1 placeholder:text-zinc-400"
                      />
                    </div>
                  </div>

                  {/* Email suggestions dropdown */}
                  {showSuggestions && filteredSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-zinc-200 bg-white shadow-xl py-1 z-50 max-h-64 overflow-y-auto">
                      {filteredSuggestions.map((email) => {
                        const initial = email[0]?.toUpperCase() || "?";
                        const colors = [
                          { bg: "bg-teal-600", text: "text-white" },
                          { bg: "bg-blue-600", text: "text-white" },
                          { bg: "bg-purple-600", text: "text-white" },
                          { bg: "bg-pink-600", text: "text-white" },
                          { bg: "bg-orange-600", text: "text-white" },
                          { bg: "bg-green-600", text: "text-white" },
                        ];
                        const colorIndex = email.charCodeAt(0) % colors.length;
                        const color = colors[colorIndex];
                        const displayName = email.split("@")[0];

                        return (
                          <button
                            key={email}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectSuggestion(email);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-zinc-50 flex items-center gap-3"
                          >
                            <div className={`w-9 h-9 rounded-full ${color.bg} flex items-center justify-center text-sm font-medium ${color.text}`}>
                              {initial}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-zinc-900 truncate">{displayName}</div>
                              <div className="text-xs text-zinc-500 truncate">{email}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Role selector */}
                <div className="relative flex-shrink-0" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    ref={inviteRoleButtonRef}
                    type="button"
                    onClick={() => setIsInviteRoleMenuOpen(prev => !prev)}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                  >
                    {inviteRoleLabel}
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M5.5 7.5l4.5 4.5 4.5-4.5" />
                    </svg>
                  </button>
                  {isInviteRoleMenuOpen && (
                    <div
                      ref={inviteRoleMenuRef}
                      className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-zinc-200 bg-white shadow-xl py-1 z-50"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setInviteRole("viewer");
                          setIsInviteRoleMenuOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                      >
                        閲覧者
                        {inviteRole === "viewer" && (
                          <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInviteRole("editor");
                          setIsInviteRoleMenuOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 flex items-center justify-between"
                      >
                        編集者
                        {inviteRole === "editor" && (
                          <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {inviteError && (
                <div className="text-xs text-red-500">{inviteError}</div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end pt-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowInvitePanel(false);
                      setPendingInvites([]);
                      setInviteEmailInput("");
                      setInviteError(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSendInvites}
                    disabled={pendingInvites.length === 0 && !inviteEmailInput.trim()}
                    className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    招待
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

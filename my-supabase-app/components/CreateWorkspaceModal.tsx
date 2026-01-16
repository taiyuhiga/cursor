"use client";

import { useState, useRef, useEffect } from "react";

type WorkspaceType = "personal" | "team";

type CreateWorkspaceModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, type: WorkspaceType) => void;
};

export function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreate,
}: CreateWorkspaceModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setWorkspaceType(null);
      setWorkspaceName("");
      setInviteLink("");
      setCopied(false);
    }
  }, [isOpen]);

  // Focus name input when step 2 opens
  useEffect(() => {
    if (step === 2 && nameInputRef.current) {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [step]);

  // Generate invite link when team is selected
  useEffect(() => {
    if (workspaceType === "team" && step === 2) {
      // Generate a placeholder invite link (will be replaced with real one after creation)
      const randomId = Math.random().toString(36).substring(2, 10);
      setInviteLink(`${window.location.origin}/invite/${randomId}`);
    }
  }, [workspaceType, step]);

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  const handleTypeSelect = (type: WorkspaceType) => {
    setWorkspaceType(type);
    setStep(2);
  };

  const handleCreate = () => {
    if (!workspaceName.trim() || !workspaceType) return;
    onCreate(workspaceName.trim(), workspaceType);
    onClose();
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleBack = () => {
    setStep(1);
    setWorkspaceType(null);
    setWorkspaceName("");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
      >
        {step === 1 ? (
          <>
            {/* Step 1: Select type */}
            <div className="px-6 py-4 border-b border-zinc-200">
              <h2 className="text-lg font-semibold text-zinc-800">
                新しいワークスペースを作成
              </h2>
            </div>
            <div className="p-6 space-y-3">
              <button
                className="w-full p-4 rounded-lg border border-zinc-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left flex items-center gap-4"
                onClick={() => handleTypeSelect("personal")}
              >
                <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-zinc-800">個人で利用</div>
                  <div className="text-sm text-zinc-500">自分だけのワークスペース</div>
                </div>
              </button>
              <button
                className="w-full p-4 rounded-lg border border-zinc-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left flex items-center gap-4"
                onClick={() => handleTypeSelect("team")}
              >
                <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-zinc-800">チームで利用</div>
                  <div className="text-sm text-zinc-500">メンバーと共同作業</div>
                </div>
              </button>
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 flex justify-end">
              <button
                className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-800"
                onClick={onClose}
              >
                キャンセル
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Step 2: Enter name (and invite link for team) */}
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center gap-2">
              <button
                className="p-1 rounded hover:bg-zinc-100 text-zinc-500"
                onClick={handleBack}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-lg font-semibold text-zinc-800">
                {workspaceType === "team" ? "チーム" : "個人"}ワークスペースを作成
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  ワークスペース名
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && workspaceName.trim()) {
                      handleCreate();
                    }
                  }}
                  placeholder="My workspace"
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {workspaceType === "team" && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    招待リンク
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inviteLink}
                      readOnly
                      className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg bg-zinc-50 text-zinc-600 text-sm"
                    />
                    <button
                      onClick={handleCopyLink}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        copied
                          ? "bg-green-100 text-green-700"
                          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                      }`}
                    >
                      {copied ? (
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          コピー済み
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          コピー
                        </span>
                      )}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    このリンクを共有してメンバーを招待できます
                  </p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-zinc-200 flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-800"
                onClick={onClose}
              >
                キャンセル
              </button>
              <button
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleCreate}
                disabled={!workspaceName.trim()}
              >
                作成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

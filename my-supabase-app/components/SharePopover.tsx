"use client";

import { useState, useRef, useEffect } from "react";

type Permission = "full" | "edit" | "comment" | "view";

type SharedUser = {
  email: string;
  avatarUrl?: string;
  role: Permission;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  nodeName: string;
  nodeId: string;
  isPublic: boolean;
  onTogglePublic: (isPublic: boolean) => Promise<void>;
  onInvite: (email: string, role: Permission) => Promise<void>;
  onUpdatePermission: (email: string, role: Permission) => Promise<void>;
  onRemoveUser: (email: string) => Promise<void>;
  sharedUsers: SharedUser[];
};

export function SharePopover({
  isOpen,
  onClose,
  nodeName,
  nodeId,
  isPublic,
  onTogglePublic,
  onInvite,
  onUpdatePermission,
  onRemoveUser,
  sharedUsers,
}: Props) {
  const [activeTab, setActiveTab] = useState<"share" | "publish">("share");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Permission>("full");
  const [isCopied, setIsCopied] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const publicUrl = typeof window !== "undefined" 
    ? `${window.location.origin}/share/${nodeId}` 
    : `https://cursor-clone.com/share/${nodeId}`;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(publicUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    await onInvite(inviteEmail, inviteRole);
    setInviteEmail("");
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute top-10 right-4 z-[60] w-[420px] bg-white border border-zinc-200 rounded-xl shadow-xl animate-in fade-in zoom-in-95 duration-100 origin-top-right"
    >
      {/* タブ切り替え */}
      <div className="flex border-b border-zinc-100">
        <button
          onClick={() => setActiveTab("share")}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "share"
              ? "text-zinc-900 border-b-2 border-zinc-900"
              : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          共有
        </button>
        <button
          onClick={() => setActiveTab("publish")}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "publish"
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          Web公開 {isPublic && <span className="ml-1 w-2 h-2 inline-block rounded-full bg-blue-500" />}
        </button>
      </div>

      {activeTab === "share" ? (
        <div className="p-4 space-y-4">
          {/* 招待フォーム */}
          <div className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="メールアドレスを入力"
              className="flex-1 px-3 py-1.5 text-sm border border-zinc-200 rounded-md focus:outline-none focus:border-blue-500 bg-zinc-50 focus:bg-white transition-colors"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Permission)}
              className="text-xs border border-zinc-200 rounded-md px-2 bg-white text-zinc-600 focus:outline-none"
            >
              <option value="full">フルアクセス</option>
              <option value="edit">編集</option>
              <option value="comment">コメント</option>
              <option value="view">読み取り</option>
            </select>
            <button
              onClick={handleInvite}
              disabled={!inviteEmail.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              招待
            </button>
          </div>

          <div className="border-t border-zinc-100 my-2" />

          {/* ユーザーリスト */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center text-zinc-500 text-xs">
                  Me
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-900">自分（オーナー）</div>
                  <div className="text-xs text-zinc-500">{nodeName}</div>
                </div>
              </div>
              <div className="text-xs text-zinc-400">フルアクセス権限</div>
            </div>

            {sharedUsers.map((user, i) => (
              <div key={i} className="flex items-center justify-between group">
                <div className="flex items-center gap-2">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xs font-bold">
                      {user.email[0].toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-medium text-zinc-900">{user.email}</div>
                    <div className="text-xs text-zinc-500">招待済み</div>
                  </div>
                </div>
                
                {/* 権限変更ドロップダウン */}
                <div className="relative">
                  <button
                    onClick={() => setOpenDropdown(openDropdown === user.email ? null : user.email)}
                    className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 px-2 py-1 rounded transition-colors"
                  >
                    {user.role === "full" && "フルアクセス権限"}
                    {user.role === "edit" && "編集権限"}
                    {user.role === "comment" && "コメント権限"}
                    {user.role === "view" && "読み取り権限"}
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {openDropdown === user.email && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-zinc-200 rounded-lg shadow-xl z-[70] py-1 max-h-[300px] overflow-y-auto">
                      <div className="px-3 py-1 text-[10px] text-zinc-400 uppercase tracking-wider">権限を変更</div>
                      
                      <button
                        onClick={() => {
                          onUpdatePermission(user.email, "full");
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-zinc-50 flex items-center justify-between ${user.role === "full" ? "bg-blue-50" : ""}`}
                      >
                        <div>
                          <div className="text-sm font-medium text-zinc-800">フルアクセス権限</div>
                          <div className="text-xs text-zinc-500">編集、サジェスト、コメント、ほかのユーザーへの共有</div>
                        </div>
                        {user.role === "full" && <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </button>
                      
                      <button
                        onClick={() => {
                          onUpdatePermission(user.email, "edit");
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-zinc-50 flex items-center justify-between ${user.role === "edit" ? "bg-blue-50" : ""}`}
                      >
                        <div>
                          <div className="text-sm font-medium text-zinc-800">編集権限</div>
                          <div className="text-xs text-zinc-500">編集、サジェスト、コメント</div>
                        </div>
                        {user.role === "edit" && <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </button>
                      
                      <button
                        onClick={() => {
                          onUpdatePermission(user.email, "comment");
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-zinc-50 flex items-center justify-between ${user.role === "comment" ? "bg-blue-50" : ""}`}
                      >
                        <div>
                          <div className="text-sm font-medium text-zinc-800">コメント権限</div>
                          <div className="text-xs text-zinc-500">サジェストとコメント</div>
                        </div>
                        {user.role === "comment" && <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </button>
                      
                      <button
                        onClick={() => {
                          onUpdatePermission(user.email, "view");
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-zinc-50 flex items-center justify-between ${user.role === "view" ? "bg-blue-50" : ""}`}
                      >
                        <div>
                          <div className="text-sm font-medium text-zinc-800">読み取り権限</div>
                          <div className="text-xs text-zinc-500">閲覧のみ</div>
                        </div>
                        {user.role === "view" && <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </button>
                      
                      <div className="border-t border-zinc-100 my-1" />
                      
                      <button
                        onClick={() => {
                          onRemoveUser(user.email);
                          setOpenDropdown(null);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-500 text-sm"
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-100 my-2" />
          
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              <span>Web上でリンクを知る全ユーザー</span>
            </div>
            <button 
              onClick={() => handleCopyUrl()}
              className="text-zinc-400 hover:text-zinc-600"
            >
              {isCopied ? "コピーしました" : "リンクをコピー"}
            </button>
          </div>
        </div>
      ) : (
        /* Web公開タブ */
        <div className="p-4">
          <div className="flex items-center justify-center py-6">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto text-4xl">
                🌍
              </div>
              <div>
                <h3 className="text-lg font-semibold text-zinc-900">Publish to the web</h3>
                <p className="text-sm text-zinc-500 mt-1 max-w-[280px] mx-auto">
                  Web公開すると、URLを知っている人は誰でもこのページを閲覧できるようになります。
                </p>
              </div>
              
              {!isPublic ? (
                <button
                  onClick={() => onTogglePublic(true)}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 rounded-lg transition-colors"
                >
                  公開する
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 p-2 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <input 
                      readOnly 
                      value={publicUrl}
                      className="flex-1 bg-transparent text-sm text-zinc-600 outline-none"
                    />
                    <button
                      onClick={handleCopyUrl}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2"
                    >
                      {isCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm py-1">
                      <span className="text-zinc-600">検索エンジンへのインデックスを許可</span>
                      <div className="w-8 h-5 bg-zinc-200 rounded-full relative cursor-pointer">
                        <div className="w-3 h-3 bg-white rounded-full absolute top-1 left-1" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm py-1">
                      <span className="text-zinc-600">テンプレートとして複製を許可</span>
                      <div className="w-8 h-5 bg-blue-500 rounded-full relative cursor-pointer">
                        <div className="w-3 h-3 bg-white rounded-full absolute top-1 right-1" />
                      </div>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => onTogglePublic(false)}
                      className="text-sm text-red-500 hover:text-red-600 font-medium"
                    >
                      公開停止
                    </button>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-4 text-sm text-blue-500 hover:text-blue-600 font-medium"
                    >
                      サイトを表示
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


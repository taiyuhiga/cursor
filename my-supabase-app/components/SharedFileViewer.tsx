"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { getFileIcon } from "./fileIcons";
import { createClient } from "@/lib/supabase/client";
import dynamic from "next/dynamic";

// Dynamically import Monaco Editor to avoid SSR issues
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.default),
  { ssr: false }
);

type Props = {
  nodeId: string;
};

type NodeData = {
  node: {
    id: string;
    name: string;
    type: "file" | "folder";
    isPublic: boolean;
    publicAccessRole: "viewer" | "editor";
    createdAt: string;
  };
  path: string;
  content: string | null;
  signedUrl: string | null;
};

type MediaType = "image" | "video" | "audio" | "unknown";

function getMediaType(fileName: string): MediaType {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
  const videoExts = ["mp4", "webm", "ogg", "mov", "avi", "mkv"];
  const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac"];

  if (imageExts.includes(ext)) return "image";
  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";
  return "unknown";
}

function isMediaFile(fileName: string): boolean {
  return getMediaType(fileName) !== "unknown";
}

function getLanguageFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    go: "go",
    rs: "rust",
    c: "c",
    cpp: "cpp",
    h: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    swift: "swift",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    ps1: "powershell",
    dockerfile: "dockerfile",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
  };
  return languageMap[ext] || "plaintext";
}

export function SharedFileViewer({ nodeId }: Props) {
  const router = useRouter();
  const [nodeData, setNodeData] = useState<NodeData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<"not_found" | "access_denied" | "error">("error");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Login popup state
  const [showLoginPopup, setShowLoginPopup] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPasswordInput, setShowPasswordInput] = useState(false);

  // Resizable sidebar state
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(280);
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle resize
  const MIN_SIDEBAR_WIDTH = 0;
  const MIN_EDITOR_WIDTH = 200;

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const containerWidth = containerRect.width;

    if (isResizing === "left") {
      const newWidth = e.clientX - containerRect.left;
      // Max width = container width - right sidebar - min editor width - resize handles (2px)
      const maxLeftWidth = containerWidth - rightWidth - MIN_EDITOR_WIDTH - 2;
      setLeftWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxLeftWidth, newWidth)));
    } else if (isResizing === "right") {
      const newWidth = containerRect.right - e.clientX;
      // Max width = container width - left sidebar - min editor width - resize handles (2px)
      const maxRightWidth = containerWidth - leftWidth - MIN_EDITOR_WIDTH - 2;
      setRightWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxRightWidth, newWidth)));
    }
  }, [isResizing, leftWidth, rightWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    async function fetchNodeData() {
      try {
        const res = await fetch(`/api/public/node?nodeId=${nodeId}`);
        const data = await res.json();

        if (!res.ok) {
          if (res.status === 404) {
            setErrorType("not_found");
            setError(data.error || "コンテンツが見つかりません");
          } else if (res.status === 403) {
            setErrorType("access_denied");
            setError(data.error || "アクセスが制限されています");
          } else {
            setErrorType("error");
            setError(data.error || "エラーが発生しました");
          }
          return;
        }

        // Check if we should redirect (user has full access)
        if (data.redirectTo) {
          router.push(data.redirectTo);
          return;
        }

        setNodeData(data);
        setIsAuthenticated(data.isAuthenticated || false);
      } catch (err: any) {
        setErrorType("error");
        setError(err.message || "エラーが発生しました");
      } finally {
        setIsLoading(false);
      }
    }
    fetchNodeData();
  }, [nodeId, router]);

  const handleDownload = useCallback(async () => {
    if (!nodeData) return;

    if (nodeData.signedUrl) {
      const a = document.createElement("a");
      a.href = nodeData.signedUrl;
      a.download = nodeData.node.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else if (nodeData.content) {
      const blob = new Blob([nodeData.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nodeData.node.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [nodeData]);

  // Login handlers
  const handleGoogleLogin = async () => {
    const supabase = createClient();
    setIsGoogleLoading(true);
    setLoginError(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`,
        },
      });
      if (error) throw error;
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : "エラーが発生しました");
      setIsGoogleLoading(false);
    }
  };

  const handleEmailContinue = async () => {
    if (!loginEmail.trim()) {
      setLoginError("メールアドレスを入力してください");
      return;
    }
    setShowPasswordInput(true);
    setLoginError(null);
  };

  const handleEmailLogin = async () => {
    const supabase = createClient();
    setIsLoginLoading(true);
    setLoginError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      if (error) throw error;
      setShowLoginPopup(false);
      window.location.reload();
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : "ログインに失敗しました");
    } finally {
      setIsLoginLoading(false);
    }
  };

  const closeLoginPopup = () => {
    setShowLoginPopup(false);
    setLoginEmail("");
    setLoginPassword("");
    setLoginError(null);
    setShowPasswordInput(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="flex items-center gap-3 text-zinc-500">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>読み込み中...</span>
        </div>
      </div>
    );
  }

  if (errorType === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">コンテンツが見つかりません</h1>
          <p className="text-zinc-500">このリンクは無効か、コンテンツが削除された可能性があります。</p>
        </div>
      </div>
    );
  }

  if (errorType === "access_denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">アクセスが制限されています</h1>
          <p className="text-zinc-500 mb-4">このコンテンツを表示するにはログインが必要です。</p>
          <a
            href="/auth/login"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            ログイン
          </a>
        </div>
      </div>
    );
  }

  if (error || !nodeData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">エラーが発生しました</h1>
          <p className="text-zinc-500">{error || "コンテンツを読み込めませんでした。"}</p>
        </div>
      </div>
    );
  }

  const { node, path, content, signedUrl } = nodeData;
  const Icon = getFileIcon(node.name);
  const pathSegments = path.split("/");
  const mediaType = getMediaType(node.name);

  return (
    <div className="h-screen flex flex-col bg-zinc-100 overflow-hidden">
      {/* Sign up banner - only show for non-authenticated users with edit access */}
      {!isAuthenticated && nodeData.node.publicAccessRole === "editor" && (
        <div className="flex-shrink-0 bg-zinc-100 border-b border-zinc-200 px-4 py-2.5 flex items-center justify-center gap-4">
          <p className="text-sm text-zinc-600">
            Lovecatアカウントを持っている人なら誰でもこのページを編集できます。
          </p>
          <button
            onClick={() => setShowLoginPopup(true)}
            className="inline-flex items-center px-4 py-1.5 text-sm font-medium border border-zinc-300 rounded-md bg-white hover:bg-zinc-50 transition-colors whitespace-nowrap"
          >
            編集するにはサインアップまたはログインしてください
          </button>
        </div>
      )}

      {/* Login popup modal */}
      {showLoginPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={closeLoginPopup}
        >
          <div
            className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cancel button */}
            <button
              onClick={closeLoginPopup}
              className="absolute top-4 right-4 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              キャンセル
            </button>

            <div className="px-8 pt-12 pb-8">
              {/* Title */}
              <h2 className="text-2xl font-bold text-zinc-900 text-center mb-2">
                サインアップするか、ログインしてください
              </h2>
              <p className="text-sm text-zinc-500 text-center mb-8">
                他の機能を利用するには、アカウントを作成するか、ログインしてください。
              </p>

              {/* Google login button */}
              <button
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors mb-6 disabled:opacity-50"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                <span className="text-sm font-medium text-zinc-700">
                  {isGoogleLoading ? "ログイン中..." : "Googleアカウントでログインする"}
                </span>
              </button>

              {/* Divider */}
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-200" />
                </div>
              </div>

              {/* Email input section */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="メールアドレスを入力"
                    className="w-full px-4 py-3 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (showPasswordInput) {
                          handleEmailLogin();
                        } else {
                          handleEmailContinue();
                        }
                      }
                    }}
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    勤務先のメールアドレスを使用してチームメートと簡単に共同作業できます
                  </p>
                </div>

                {/* Password input (shown after email continue) */}
                {showPasswordInput && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                      パスワード
                    </label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="パスワードを入力"
                      className="w-full px-4 py-3 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleEmailLogin();
                        }
                      }}
                    />
                  </div>
                )}

                {/* Error message */}
                {loginError && (
                  <p className="text-sm text-red-500">{loginError}</p>
                )}

                {/* Continue/Login button */}
                <button
                  onClick={showPasswordInput ? handleEmailLogin : handleEmailContinue}
                  disabled={isLoginLoading}
                  className="w-full py-3 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 text-sm"
                >
                  {isLoginLoading ? "ログイン中..." : showPasswordInput ? "ログイン" : "続行"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main layout with sidebars */}
      <div ref={containerRef} className="flex-1 flex min-h-0">
        {/* Left sidebar placeholder (file tree area) */}
        <div
          className="flex-shrink-0 bg-zinc-100"
          style={{ width: leftWidth }}
        />

        {/* Left resize handle */}
        <div
          className="w-1 flex-shrink-0 bg-transparent hover:bg-blue-400 cursor-col-resize transition-colors"
          onMouseDown={() => setIsResizing("left")}
        />

        {/* Center content area */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-white">
          {/* Tab bar */}
          <div className="flex-shrink-0 flex items-center justify-between border-b border-zinc-200 bg-zinc-50 pr-2">
            <div className="flex items-center">
              <div className="flex items-center gap-2 px-3 py-2 bg-white border-t-2 border-blue-500">
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm text-zinc-900 truncate max-w-[200px]">{node.name}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 pr-2">
              {/* Download button */}
              <button
                onClick={handleDownload}
                className="p-1.5 rounded hover:bg-zinc-200 transition-colors"
                title="ダウンロード"
              >
                <svg
                  className="w-4 h-4 text-zinc-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 bg-white text-xs text-zinc-600 border-b border-zinc-100 overflow-x-auto">
            {pathSegments.map((segment, index) => {
              const isLast = index === pathSegments.length - 1;
              const SegmentIcon = isLast ? Icon : getFileIcon("folder");
              return (
                <span key={index} className="flex items-center gap-1 whitespace-nowrap">
                  {index > 0 && <span className="text-zinc-400 mx-0.5">{">"}</span>}
                  <SegmentIcon className="w-4 h-4 flex-shrink-0" />
                  <span className={isLast ? "text-zinc-900" : ""}>{segment}</span>
                </span>
              );
            })}
          </div>

          {/* Content area */}
          <div className="flex-1 min-h-0 overflow-hidden">
          {node.type === "folder" ? (
            <div className="h-full flex items-center justify-center text-zinc-500">
              <div className="text-center">
                <Icon className="w-16 h-16 mx-auto mb-4 text-zinc-300" />
                <p>フォルダの内容を表示するには、アプリにログインしてください。</p>
              </div>
            </div>
          ) : isMediaFile(node.name) ? (
            <div className="h-full flex items-center justify-center bg-zinc-900 p-4">
              {mediaType === "image" && signedUrl && (
                <img
                  src={signedUrl}
                  alt={node.name}
                  className="max-w-full max-h-full object-contain"
                />
              )}
              {mediaType === "video" && signedUrl && (
                <video
                  src={signedUrl}
                  controls
                  className="max-w-full max-h-full"
                />
              )}
              {mediaType === "audio" && signedUrl && (
                <div className="w-full max-w-md">
                  <audio src={signedUrl} controls className="w-full" />
                </div>
              )}
              {!signedUrl && (
                <div className="text-white text-center">
                  <p>メディアを読み込めませんでした。</p>
                </div>
              )}
            </div>
          ) : content !== null ? (
            <MonacoEditor
              height="100%"
              language={getLanguageFromFileName(node.name)}
              value={content}
              theme="vs"
              onMount={(editor) => {
                // Disable drag and drop completely
                editor.getDomNode()?.addEventListener("dragover", (e) => e.preventDefault(), true);
                editor.getDomNode()?.addEventListener("drop", (e) => e.preventDefault(), true);
              }}
              options={{
                readOnly: true,
                readOnlyMessage: { value: "" },
                domReadOnly: true,
                cursorWidth: 0,
                hideCursorInOverviewRuler: true,
                dropIntoEditor: { enabled: false },
                dragAndDrop: false,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineHeight: 20,
                letterSpacing: 0,
                fontFamily:
                  '"JetBrains Mono", "SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
                fontLigatures: false,
                fontWeight: "normal",
                lineNumbers: "on",
                renderLineHighlight: "none",
                folding: true,
                wordWrap: "on",
                selectionHighlight: false,
                occurrencesHighlight: "off",
                unicodeHighlight: {
                  ambiguousCharacters: false,
                  invisibleCharacters: false,
                },
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                parameterHints: { enabled: false },
                hover: { enabled: false },
                codeLens: false,
                lightbulb: { enabled: "off" },
                contextmenu: false,
              }}
            />
          ) : signedUrl ? (
            <div className="h-full flex items-center justify-center text-zinc-500">
              <div className="text-center">
                <Icon className="w-16 h-16 mx-auto mb-4 text-zinc-300" />
                <p className="mb-4">このファイルはプレビューできません。</p>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  ダウンロード
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-500">
              <div className="text-center">
                <Icon className="w-16 h-16 mx-auto mb-4 text-zinc-300" />
                <p>このファイルの内容を表示できません。</p>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* Right resize handle */}
        <div
          className="w-1 flex-shrink-0 bg-transparent hover:bg-blue-400 cursor-col-resize transition-colors"
          onMouseDown={() => setIsResizing("right")}
        />

        {/* Right sidebar placeholder (chat area) */}
        <div
          className="flex-shrink-0 bg-zinc-100"
          style={{ width: rightWidth }}
        />
      </div>
    </div>
  );
}

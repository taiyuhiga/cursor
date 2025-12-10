"use client";

import { useState } from "react";

type Props = {
  onClose: () => void;
  onCreate: (name: string) => void;
};

export function CreateWorkspaceDialog({ onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setIsLoading(true);
    await onCreate(name.trim());
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white border border-zinc-200 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <form onSubmit={handleSubmit}>
          {/* ヘッダー */}
          <div className="p-6 pb-4">
            <h2 className="text-xl font-semibold text-zinc-900">
              新しいワークスペースを作成
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              プロジェクトやチームごとにワークスペースを分けて管理できます。
            </p>
          </div>

          {/* フォーム */}
          <div className="px-6 pb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              ワークスペース名
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: チームプロジェクト"
              className="w-full px-4 py-3 border border-zinc-300 rounded-lg text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              autoFocus
              disabled={isLoading}
            />
          </div>

          {/* アイコン選択（将来の機能） */}
          <div className="px-6 pb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              アイコン
            </label>
            <div className="flex gap-2">
              {["🏠", "💼", "🚀", "📚", "🎨", "💡", "🔬", "🎯"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="w-10 h-10 rounded-lg border border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 flex items-center justify-center text-xl transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* フッター */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-zinc-50 border-t border-zinc-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200 rounded-lg transition-colors"
              disabled={isLoading}
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "作成中..." : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


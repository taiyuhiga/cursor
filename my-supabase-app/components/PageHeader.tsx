type Node = {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
};

type Props = {
  node: Node | null;
  isSaving?: boolean;
};

export function PageHeader({ node, isSaving = false }: Props) {
  if (!node) {
    return (
      <div className="h-[73px] px-6 flex items-center border-b border-zinc-200 bg-zinc-50 text-sm text-zinc-400">
        ファイルを選択するとここに詳細が表示されます
      </div>
    );
  }

  return (
    <div className="px-6 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
      <div>
        <div className="text-xs text-zinc-500 mb-0.5">Page</div>
        <div className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
          {node.name}
          {isSaving && (
            <span className="text-xs font-normal text-zinc-500 animate-pulse">
              Saving...
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <div className="flex flex-col items-end gap-0.5">
          <span>Created: {new Date(node.created_at).toLocaleDateString()}</span>
          <span>Model: Gemini 2.0 Flash</span>
        </div>
      </div>
    </div>
  );
}

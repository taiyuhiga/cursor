type Tab = {
  id: string;
  title: string;
};

type TabBarProps = {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

export function TabBar({ tabs, activeId, onSelect, onClose }: TabBarProps) {
  return (
    <div className="flex h-9 border-b border-zinc-200 bg-zinc-50 text-sm overflow-x-auto no-scrollbar">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={`
              group flex items-center gap-2 px-3 border-r border-zinc-200 min-w-[120px] max-w-[200px] cursor-pointer select-none relative
              ${
                isActive
                  ? "bg-white text-zinc-900"
                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-100/80"
              }
            `}
            onClick={() => onSelect(tab.id)}
          >
            {/* アクティブ時の上部ボーダー */}
            {isActive && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" />
            )}

            {/* ファイルアイコン（簡易） */}
            <span className={`text-xs ${isActive ? "text-blue-500" : "text-zinc-400"}`}>
              📄
            </span>

            <span className="truncate flex-1 text-xs">{tab.title}</span>
            
            <span
              className={`
                rounded p-0.5 hover:bg-zinc-200 transition-all
                ${isActive ? "opacity-100 text-zinc-500 hover:text-zinc-700" : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600"}
              `}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </span>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { Icons } from "./Icons";

type Activity = "explorer" | "search" | "git" | "ai" | "settings";

type Props = {
  activeActivity: Activity;
  onSelect: (activity: Activity) => void;
};

export function ActivityBar({ activeActivity, onSelect }: Props) {
  const topItems: { id: Activity; icon: keyof typeof Icons }[] = [
    { id: "explorer", icon: "Explorer" },
    { id: "search", icon: "Search" },
    { id: "git", icon: "Git" },
    { id: "ai", icon: "AI" },
  ];

  const bottomItems: { id: Activity; icon: keyof typeof Icons }[] = [
    { id: "settings", icon: "Settings" },
  ];

  const renderItem = (item: { id: Activity; icon: keyof typeof Icons }) => {
    const Icon = Icons[item.icon];
    const isActive = activeActivity === item.id;

    return (
      <button
        key={item.id}
        onClick={() => onSelect(item.id)}
        className={`w-12 h-12 flex items-center justify-center relative transition-colors ${
          isActive ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
        }`}
      >
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-100" />
        )}
        <Icon className="w-6 h-6" />
      </button>
    );
  };

  return (
    <div className="w-12 bg-zinc-900 border-r border-zinc-800 flex flex-col justify-between flex-shrink-0 z-10">
      <div className="flex flex-col">
        {topItems.map(renderItem)}
      </div>
      <div className="flex flex-col pb-2">
        {bottomItems.map(renderItem)}
        <button className="w-12 h-12 flex items-center justify-center text-zinc-500 hover:text-zinc-300">
          <Icons.User className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}


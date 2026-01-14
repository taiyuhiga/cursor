"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bug, Globe, LogOut, Mail, MessageSquare, Settings, Sparkles, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English (United States)" },
  { value: "fr-FR", label: "Français (France)" },
  { value: "de-DE", label: "Deutsch (Deutschland)" },
  { value: "hi-IN", label: "हिन्दी (भारत)" },
  { value: "id-ID", label: "Indonesia (Indonesia)" },
  { value: "it-IT", label: "Italiano (Italia)" },
  { value: "ja-JP", label: "日本語 (日本)" },
  { value: "ko-KR", label: "한국어 (대한민국)" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "es-419", label: "Español (Latinoamérica)" },
  { value: "es-ES", label: "Español (España)" },
];

type Props = {
  userEmail?: string;
  displayName?: string;
  planName?: string;
  onOpenSettings?: () => void;
};

export function AccountMenu({ userEmail, displayName, planName = "Plus", onOpenSettings }: Props) {
  const router = useRouter();
  const [selectedLanguage, setSelectedLanguage] = useState("ja-JP");

  useEffect(() => {
    const stored = localStorage.getItem("cursor_ui_language");
    if (stored && LANGUAGE_OPTIONS.some((option) => option.value === stored)) {
      setSelectedLanguage(stored);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("cursor_ui_language", selectedLanguage);
  }, [selectedLanguage]);

  const resolvedName = useMemo(() => {
    if (displayName && displayName.trim()) return displayName.trim();
    if (userEmail) return userEmail.split("@")[0];
    return "アカウント";
  }, [displayName, userEmail]);

  const avatarInitial = useMemo(() => {
    const initial = resolvedName.trim().charAt(0);
    return initial ? initial.toUpperCase() : "?";
  }, [resolvedName]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-full flex items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors hover:bg-zinc-100 data-[state=open]:bg-zinc-100 outline-none focus:outline-none focus-visible:outline-none"
          type="button"
        >
          <div className="h-8 w-8 rounded-full bg-zinc-200 text-zinc-600 flex items-center justify-center text-sm font-semibold">
            {avatarInitial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-800 truncate">
              {resolvedName}
            </div>
            <div className="text-xs text-zinc-500">
              {planName}
            </div>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl"
      >
        <DropdownMenuLabel className="px-3 py-2 font-normal">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-zinc-200 text-zinc-600 flex items-center justify-center text-base font-semibold">
              {avatarInitial}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 truncate">
                {resolvedName}
              </div>
              {userEmail && (
                <div className="text-xs text-zinc-500 truncate">{userEmail}</div>
              )}
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="my-2" />

        <DropdownMenuItem className="cursor-pointer" onSelect={() => onOpenSettings?.()}>
          <Settings className="h-4 w-4" />
          設定
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer">
            <Globe className="h-4 w-4" />
            言語
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl">
            {LANGUAGE_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                className="cursor-pointer justify-between"
                onSelect={() => setSelectedLanguage(option.value)}
              >
                <span>{option.label}</span>
                {selectedLanguage === option.value && (
                  <Check className="h-4 w-4 text-zinc-600" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator className="my-2" />

        <DropdownMenuItem className="cursor-pointer">
          <Sparkles className="h-4 w-4" />
          プランをアップグレード
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-2" />

        <DropdownMenuItem className="cursor-pointer">
          <Bug className="h-4 w-4" />
          バグを報告
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer">
          <MessageSquare className="h-4 w-4" />
          依頼・要望
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer">
          <Mail className="h-4 w-4" />
          お問い合わせ
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-2" />

        <DropdownMenuItem className="cursor-pointer" onSelect={handleLogout}>
          <LogOut className="h-4 w-4" />
          ログアウト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

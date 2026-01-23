"use client";

import { useParams } from "next/navigation";
import { SharedWorkspaceViewer } from "@/components/SharedWorkspaceViewer";

export function SharedWorkspaceViewerWrapper() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  if (!workspaceId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">エラー</h1>
          <p className="text-zinc-500">無効なリンクです。</p>
        </div>
      </div>
    );
  }

  return <SharedWorkspaceViewer workspaceId={workspaceId} />;
}

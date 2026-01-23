"use client";

import { useParams } from "next/navigation";
import { SharedFileViewer } from "@/components/SharedFileViewer";

export function SharedFileViewerWrapper() {
  const params = useParams();
  const nodeId = params.nodeId as string;

  if (!nodeId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">エラー</h1>
          <p className="text-zinc-500">無効なリンクです。</p>
        </div>
      </div>
    );
  }

  return <SharedFileViewer nodeId={nodeId} />;
}

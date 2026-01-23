import { Suspense } from "react";
import { SharedFileViewerWrapper } from "./SharedFileViewerWrapper";

function LoadingState() {
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

export default function SharePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SharedFileViewerWrapper />
    </Suspense>
  );
}

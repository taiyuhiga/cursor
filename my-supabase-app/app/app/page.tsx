import { Suspense } from "react";
import AppContent from "./AppContent";

type Props = {
  searchParams: Promise<{ workspace?: string }>;
};

export default async function AppPage({ searchParams }: Props) {
  const { workspace: workspaceId } = await searchParams;
  
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-white text-zinc-700 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-zinc-300 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-sm text-zinc-500">Loading...</span>
          </div>
        </div>
      }
    >
      <AppContent workspaceId={workspaceId} />
    </Suspense>
  );
}

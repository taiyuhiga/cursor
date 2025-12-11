import { Suspense } from "react";
import AppContent from "./AppContent";

export default function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-600" />
        </div>
      }
    >
      <AppContent searchParamsPromise={searchParams} />
    </Suspense>
  );
}

export default function Loading() {
  return (
    <div className="h-screen bg-zinc-950 text-zinc-300 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" />
        <span className="text-sm text-zinc-500">Loading...</span>
      </div>
    </div>
  );
}





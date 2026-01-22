"use client";

import { useState, useEffect } from "react";
import mammoth from "mammoth";

type WordViewerProps = {
  data: ArrayBuffer;
  fileName: string;
};

export function WordViewer({ data, fileName }: WordViewerProps) {
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    async function convertDocument() {
      try {
        setIsLoading(true);
        setError(null);

        const result = await mammoth.convertToHtml({ arrayBuffer: data });
        setHtml(result.value);

        // Collect any conversion warnings
        if (result.messages && result.messages.length > 0) {
          const warningMessages = result.messages
            .filter((m: { type: string }) => m.type === "warning")
            .map((m: { message: string }) => m.message);
          setWarnings(warningMessages);
        }
      } catch (err) {
        console.error("Word document parse error:", err);
        setError("Failed to parse Word document");
      } finally {
        setIsLoading(false);
      }
    }

    convertDocument();
  }, [data]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400">
        <div className="flex items-center gap-2">
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
          <span>Loading document...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500">
        <div className="text-center">
          <p className="mb-2">{error}</p>
          <p className="text-sm opacity-70">{fileName}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Warnings banner (if any) */}
      {warnings.length > 0 && (
        <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-700 text-sm">
          <span className="font-medium">Note:</span> Some formatting may not be
          preserved.
        </div>
      )}

      {/* Document content */}
      <div className="flex-1 overflow-auto p-6">
        <div
          className="max-w-3xl mx-auto prose prose-zinc prose-sm
            [&_table]:border-collapse [&_table]:w-full
            [&_td]:border [&_td]:border-zinc-300 [&_td]:p-2
            [&_th]:border [&_th]:border-zinc-300 [&_th]:p-2 [&_th]:bg-zinc-100
            [&_img]:max-w-full [&_img]:h-auto
            [&_p]:my-2 [&_h1]:mt-6 [&_h2]:mt-5 [&_h3]:mt-4
            [&_ul]:list-disc [&_ul]:pl-6
            [&_ol]:list-decimal [&_ol]:pl-6
            [&_li]:my-1"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

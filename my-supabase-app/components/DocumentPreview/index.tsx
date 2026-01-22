"use client";

import { useState, useEffect } from "react";
import {
  getDocumentType,
  isDocumentFile,
  getDocumentExtension,
  type DocumentType,
} from "./utils/documentTypes";
import { PDFViewer } from "./PDFViewer";
import { ExcelViewer } from "./ExcelViewer";
import { WordViewer } from "./WordViewer";
import { PowerPointViewer } from "./PowerPointViewer";

// Re-export utilities
export { isDocumentFile, getDocumentType } from "./utils/documentTypes";

type DocumentPreviewProps = {
  fileName: string;
  nodeId: string;
  onError?: (error: string) => void;
};

// Document data cache (in-memory only since ArrayBuffers are large)
const DOCUMENT_DATA_CACHE = new Map<string, ArrayBuffer>();
const DOCUMENT_DATA_INFLIGHT = new Map<string, Promise<ArrayBuffer>>();
const MAX_CACHE_ENTRIES = 10;

function pruneCache() {
  if (DOCUMENT_DATA_CACHE.size <= MAX_CACHE_ENTRIES) return;
  const firstKey = DOCUMENT_DATA_CACHE.keys().next().value as string | undefined;
  if (firstKey) {
    DOCUMENT_DATA_CACHE.delete(firstKey);
  }
}

async function fetchDocumentData(nodeId: string): Promise<ArrayBuffer> {
  // Check cache first
  const cached = DOCUMENT_DATA_CACHE.get(nodeId);
  if (cached) return cached;

  // Check for in-flight request
  const inFlight = DOCUMENT_DATA_INFLIGHT.get(nodeId);
  if (inFlight) return inFlight;

  // Fetch from API
  const promise = (async () => {
    const res = await fetch(`/api/storage/download?nodeId=${nodeId}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch document");
    }
    const arrayBuffer = await res.arrayBuffer();

    // Cache the result
    DOCUMENT_DATA_CACHE.set(nodeId, arrayBuffer);
    pruneCache();

    return arrayBuffer;
  })();

  DOCUMENT_DATA_INFLIGHT.set(nodeId, promise);
  promise.finally(() => {
    DOCUMENT_DATA_INFLIGHT.delete(nodeId);
  });

  return promise;
}

function LegacyFormatNotice({
  fileName,
  extension,
  onDownload,
}: {
  fileName: string;
  extension: string;
  onDownload: () => void;
}) {
  return (
    <div className="h-full flex items-center justify-center text-zinc-500">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-zinc-100 rounded-lg flex items-center justify-center">
          <svg
            className="w-8 h-8 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <p className="mb-2 text-zinc-600">
          Preview not available for .{extension} files
        </p>
        <p className="text-sm text-zinc-400 mb-4">
          This legacy format has limited browser support
        </p>
        <button
          onClick={onDownload}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Download to view
        </button>
      </div>
    </div>
  );
}

export function DocumentPreview({
  fileName,
  nodeId,
  onError,
}: DocumentPreviewProps) {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const documentType: DocumentType = getDocumentType(fileName);
  const extension = getDocumentExtension(fileName);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      if (documentType === "unknown") {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const arrayBuffer = await fetchDocumentData(nodeId);
        if (cancelled) return;

        setData(arrayBuffer);
      } catch (err: unknown) {
        if (cancelled) return;
        const errorMsg =
          err instanceof Error ? err.message : "Failed to load document";
        setError(errorMsg);
        onError?.(errorMsg);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadDocument();

    return () => {
      cancelled = true;
    };
  }, [nodeId, documentType, onError]);

  const handleDownload = () => {
    window.open(`/api/storage/download?nodeId=${nodeId}`, "_blank");
  };

  // Loading state
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

  // Error state
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500">
        <div className="text-center">
          <p className="mb-2">Failed to load document</p>
          <p className="text-sm opacity-70">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setIsLoading(true);
              DOCUMENT_DATA_CACHE.delete(nodeId);
              fetchDocumentData(nodeId)
                .then(setData)
                .catch((err) => {
                  const errorMsg =
                    err instanceof Error ? err.message : "Failed to load document";
                  setError(errorMsg);
                  onError?.(errorMsg);
                })
                .finally(() => setIsLoading(false));
            }}
            className="mt-4 px-4 py-2 bg-zinc-100 text-zinc-700 rounded hover:bg-zinc-200"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Legacy format notice
  if (documentType === "legacy") {
    return (
      <LegacyFormatNotice
        fileName={fileName}
        extension={extension}
        onDownload={handleDownload}
      />
    );
  }

  // Unknown format
  if (documentType === "unknown" || !data) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400">
        <p>This file type cannot be previewed</p>
      </div>
    );
  }

  // Render appropriate viewer
  switch (documentType) {
    case "pdf":
      return <PDFViewer data={data} fileName={fileName} />;
    case "excel":
      return <ExcelViewer data={data} fileName={fileName} />;
    case "word":
      return <WordViewer data={data} fileName={fileName} />;
    case "powerpoint":
      return <PowerPointViewer data={data} fileName={fileName} />;
    default:
      return (
        <div className="h-full flex items-center justify-center text-zinc-400">
          <p>This file type cannot be previewed</p>
        </div>
      );
  }
}

"use client";

import { useEffect, useState } from "react";
import { fileIcons } from "./fileIcons";

type MediaPreviewProps = {
  fileName: string;
  nodeId: string;
  onError?: (error: string) => void;
};

type MediaType = "image" | "video" | "audio" | "unknown";

type MediaCacheEntry = {
  url: string;
  expiresAt: number;
};

const MEDIA_URL_CACHE = new Map<string, MediaCacheEntry>();
const MEDIA_URL_INFLIGHT = new Map<string, Promise<string>>();
const SIGNED_URL_TTL_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;

function pruneMediaCache() {
  if (MEDIA_URL_CACHE.size <= MAX_CACHE_ENTRIES) return;
  const firstKey = MEDIA_URL_CACHE.keys().next().value as string | undefined;
  if (firstKey) MEDIA_URL_CACHE.delete(firstKey);
}

function getCachedMediaUrl(nodeId: string): string | null {
  const cached = MEDIA_URL_CACHE.get(nodeId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    MEDIA_URL_CACHE.delete(nodeId);
    return null;
  }
  return cached.url;
}

async function requestMediaUrl(nodeId: string): Promise<string> {
  const res = await fetch("/api/storage/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to get media URL");
  }
  if (!data.url) {
    throw new Error("Missing media URL");
  }
  return data.url as string;
}

async function fetchMediaUrl(nodeId: string): Promise<string> {
  const cached = getCachedMediaUrl(nodeId);
  if (cached) return cached;
  const inFlight = MEDIA_URL_INFLIGHT.get(nodeId);
  if (inFlight) return inFlight;

  const promise = requestMediaUrl(nodeId)
    .then((url) => {
      MEDIA_URL_CACHE.set(nodeId, {
        url,
        expiresAt: Date.now() + SIGNED_URL_TTL_MS,
      });
      pruneMediaCache();
      return url;
    })
    .finally(() => {
      MEDIA_URL_INFLIGHT.delete(nodeId);
    });

  MEDIA_URL_INFLIGHT.set(nodeId, promise);
  return promise;
}

export function prefetchMediaUrl(nodeId: string) {
  if (!nodeId) return;
  void fetchMediaUrl(nodeId).catch(() => {});
}

function getMediaType(fileName: string): MediaType {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"];
  const videoExtensions = ["mp4", "webm", "mov", "avi", "mkv", "m4v"];
  const audioExtensions = ["mp3", "wav", "ogg", "m4a", "flac", "aac"];

  if (imageExtensions.includes(ext)) return "image";
  if (videoExtensions.includes(ext)) return "video";
  if (audioExtensions.includes(ext)) return "audio";
  return "unknown";
}

function getFileIcon(fileName: string): React.ReactNode {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  const iconMap: Record<string, keyof typeof fileIcons> = {
    mp3: "Audio",
    wav: "Audio",
    ogg: "Audio",
    m4a: "Audio",
    flac: "Audio",
    aac: "Audio",
    mp4: "Video",
    webm: "Video",
    mov: "Video",
    avi: "Video",
    mkv: "Video",
    m4v: "Video",
    png: "Image",
    jpg: "Image",
    jpeg: "Image",
    gif: "Image",
    webp: "Image",
    bmp: "Image",
    ico: "Image",
    svg: "Image",
  };

  const iconKey = iconMap[ext];
  if (iconKey && fileIcons[iconKey]) {
    const IconComponent = fileIcons[iconKey];
    return <IconComponent className="w-5 h-5" />;
  }

  return <fileIcons.File className="w-5 h-5" />;
}

export function MediaPreview({ fileName, nodeId, onError }: MediaPreviewProps) {
  const initialUrl = getCachedMediaUrl(nodeId);
  const [mediaUrl, setMediaUrl] = useState<string | null>(initialUrl);
  const [isLoading, setIsLoading] = useState(!initialUrl);
  const [error, setError] = useState<string | null>(null);

  const mediaType = getMediaType(fileName);

  useEffect(() => {
    let cancelled = false;

    if (!nodeId || mediaType === "unknown") {
      setMediaUrl(null);
      setIsLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setError(null);

    const cached = getCachedMediaUrl(nodeId);
    if (cached) {
      setMediaUrl(cached);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setMediaUrl(null);
    setIsLoading(true);

    fetchMediaUrl(nodeId)
      .then((url) => {
        if (cancelled) return;
        setMediaUrl(url);
      })
      .catch((err: any) => {
        if (cancelled) return;
        const errorMsg = err?.message || "Failed to load media";
        setError(errorMsg);
        onError?.(errorMsg);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nodeId, mediaType, onError]);

  if (mediaType === "unknown") {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400">
        <p>This file type cannot be previewed</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-4 py-2 flex items-center gap-2">
        <span className="flex-shrink-0">
          {getFileIcon(fileName)}
        </span>
        <span className="text-zinc-600 text-sm truncate">
          {fileName}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
        {isLoading ? (
          <div className="text-zinc-400">
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
              <span>Loading...</span>
            </div>
          </div>
        ) : error ? (
          <div className="text-red-500 text-center">
            <p className="mb-2">Failed to load media</p>
            <p className="text-sm opacity-70">{error}</p>
          </div>
        ) : mediaUrl ? (
          <>
            {mediaType === "image" && (
              <img
                src={mediaUrl}
                alt={fileName}
                className="max-w-full max-h-full object-contain"
              />
            )}

            {mediaType === "video" && (
              <video
                src={mediaUrl}
                controls
                className="max-w-full max-h-full"
                style={{ maxHeight: "calc(100vh - 150px)" }}
              >
                Your browser does not support the video tag.
              </video>
            )}

            {mediaType === "audio" && (
              <div className="bg-zinc-200 rounded-full p-1 shadow-md">
                <audio
                  src={mediaUrl}
                  controls
                  style={{ minWidth: "300px" }}
                >
                  Your browser does not support the audio tag.
                </audio>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

// Helper function to check if a file is a media file
export function isMediaFile(fileName: string): boolean {
  return getMediaType(fileName) !== "unknown";
}

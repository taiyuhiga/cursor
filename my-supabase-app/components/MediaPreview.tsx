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
const REFRESH_MARGIN_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;
const STORAGE_CACHE_KEY = "cursor_media_url_cache_v1";

let storageCacheLoaded = false;
let storageCache: Record<string, MediaCacheEntry> = {};

function normalizeEntry(value: any): MediaCacheEntry | null {
  if (!value || typeof value !== "object") return null;
  const url = typeof value.url === "string" ? value.url : null;
  const expiresAt = typeof value.expiresAt === "number" ? value.expiresAt : null;
  if (!url || !expiresAt) return null;
  return { url, expiresAt };
}

function loadStorageCache() {
  if (storageCacheLoaded) return;
  storageCacheLoaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const now = Date.now();
    for (const [key, value] of Object.entries(parsed)) {
      const entry = normalizeEntry(value);
      if (entry && entry.expiresAt > now) {
        storageCache[key] = entry;
      }
    }
  } catch {
    storageCache = {};
  }
}

function persistStorageCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(storageCache));
  } catch {
    // Ignore storage errors (quota, disabled, etc.)
  }
}

function pruneStorageCache() {
  loadStorageCache();
  const now = Date.now();
  let changed = false;
  for (const [key, value] of Object.entries(storageCache)) {
    const entry = normalizeEntry(value);
    if (!entry || entry.expiresAt <= now) {
      delete storageCache[key];
      changed = true;
    }
  }
  const keys = Object.keys(storageCache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    const excess = keys.length - MAX_CACHE_ENTRIES;
    for (let i = 0; i < excess; i += 1) {
      delete storageCache[keys[i]];
      changed = true;
    }
  }
  if (changed) persistStorageCache();
}

function getStorageEntry(nodeId: string): MediaCacheEntry | null {
  loadStorageCache();
  const entry = normalizeEntry(storageCache[nodeId]);
  if (!entry) {
    if (storageCache[nodeId]) {
      delete storageCache[nodeId];
      persistStorageCache();
    }
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    delete storageCache[nodeId];
    persistStorageCache();
    return null;
  }
  return entry;
}

function setStorageEntry(nodeId: string, entry: MediaCacheEntry) {
  loadStorageCache();
  storageCache[nodeId] = entry;
  persistStorageCache();
  pruneStorageCache();
}

function deleteStorageEntry(nodeId: string) {
  loadStorageCache();
  if (!storageCache[nodeId]) return;
  delete storageCache[nodeId];
  persistStorageCache();
}

function pruneMediaCache() {
  if (MEDIA_URL_CACHE.size <= MAX_CACHE_ENTRIES) return;
  const firstKey = MEDIA_URL_CACHE.keys().next().value as string | undefined;
  if (!firstKey) return;
  MEDIA_URL_CACHE.delete(firstKey);
  deleteStorageEntry(firstKey);
}

function getCachedMediaEntry(nodeId: string): MediaCacheEntry | null {
  const cached = MEDIA_URL_CACHE.get(nodeId);
  if (!cached) {
    const stored = getStorageEntry(nodeId);
    if (!stored) return null;
    MEDIA_URL_CACHE.set(nodeId, stored);
    pruneMediaCache();
    return stored;
  }
  if (cached.expiresAt <= Date.now()) {
    MEDIA_URL_CACHE.delete(nodeId);
    deleteStorageEntry(nodeId);
    return null;
  }
  return cached;
}

function getCachedMediaUrl(nodeId: string): string | null {
  const cached = getCachedMediaEntry(nodeId);
  return cached ? cached.url : null;
}

function shouldRefreshSoon(entry: MediaCacheEntry) {
  return entry.expiresAt - Date.now() <= REFRESH_MARGIN_MS;
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
  const cachedEntry = getCachedMediaEntry(nodeId);
  if (cachedEntry) {
    if (shouldRefreshSoon(cachedEntry)) {
      void refreshMediaUrl(nodeId);
    }
    return cachedEntry.url;
  }
  const inFlight = MEDIA_URL_INFLIGHT.get(nodeId);
  if (inFlight) return inFlight;

  const promise = refreshMediaUrl(nodeId);

  MEDIA_URL_INFLIGHT.set(nodeId, promise);
  return promise;
}

async function refreshMediaUrl(nodeId: string): Promise<string> {
  const inFlight = MEDIA_URL_INFLIGHT.get(nodeId);
  if (inFlight) return inFlight;

  const promise = requestMediaUrl(nodeId)
    .then((url) => {
      const entry = { url, expiresAt: Date.now() + SIGNED_URL_TTL_MS };
      MEDIA_URL_CACHE.set(nodeId, entry);
      setStorageEntry(nodeId, entry);
      pruneMediaCache();
      return url;
    })
    .finally(() => {
      MEDIA_URL_INFLIGHT.delete(nodeId);
    });

  MEDIA_URL_INFLIGHT.set(nodeId, promise);
  return promise;
}

export function prefetchMediaUrl(nodeId: string): Promise<void> {
  if (!nodeId) return Promise.resolve();
  return fetchMediaUrl(nodeId).then(() => {}).catch(() => {});
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

    const cachedEntry = getCachedMediaEntry(nodeId);
    if (cachedEntry) {
      setMediaUrl(cachedEntry.url);
      setIsLoading(false);
      if (shouldRefreshSoon(cachedEntry)) {
        void refreshMediaUrl(nodeId).catch(() => {});
      }
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

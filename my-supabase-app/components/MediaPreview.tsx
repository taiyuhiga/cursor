"use client";

import { useEffect, useState } from "react";
import { fileIcons } from "./fileIcons";

type MediaPreviewProps = {
  fileName: string;
  nodeId: string;
  onError?: (error: string) => void;
};

type MediaType = "image" | "video" | "audio" | "unknown";

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
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mediaType = getMediaType(fileName);

  useEffect(() => {
    const fetchMediaUrl = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Get signed URL from the storage download API
        const res = await fetch("/api/storage/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to get media URL");
        }

        setMediaUrl(data.url);
      } catch (err: any) {
        const errorMsg = err.message || "Failed to load media";
        setError(errorMsg);
        onError?.(errorMsg);
      } finally {
        setIsLoading(false);
      }
    };

    if (nodeId && mediaType !== "unknown") {
      fetchMediaUrl();
    } else {
      setIsLoading(false);
    }
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

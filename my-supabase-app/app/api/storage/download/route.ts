import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildLegacyStoragePath, buildStoragePath } from "@/lib/storage/path";

type NodeInfo = {
  id: string;
  name: string;
  project_id: string;
};

type StorageEntry = {
  name?: string;
  created_at?: string | null;
  updated_at?: string | null;
  last_accessed_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

function extractStoragePath(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^storage:(\S+)/);
  return match ? match[1] : null;
}

function getCandidatePaths(node: NodeInfo, text: string) {
  const candidates: string[] = [];

  const extractedPath = extractStoragePath(text);
  if (extractedPath) {
    candidates.push(extractedPath);
  }

  candidates.push(buildStoragePath(node.project_id, node.id));
  candidates.push(buildLegacyStoragePath(node.project_id, node.id, node.name));

  return Array.from(new Set(candidates));
}

function getEntryTimestamp(entry: StorageEntry) {
  const raw =
    entry.updated_at ||
    entry.created_at ||
    entry.last_accessed_at ||
    entry.metadata?.lastModified ||
    entry.metadata?.last_modified ||
    null;
  const time = typeof raw === "string" || typeof raw === "number" ? Date.parse(String(raw)) : NaN;
  return Number.isNaN(time) ? null : time;
}

async function resolveFromUploads(supabase: any, uploadsPrefix: string) {
  const { data: listData, error: listError } = await supabase.storage
    .from("files")
    .list(uploadsPrefix);

  if (listError || !listData || listData.length === 0) {
    return null;
  }

  if (listData.length === 1 && listData[0]?.name) {
    return `${uploadsPrefix}/${listData[0].name}`;
  }

  const withTimestamps = listData
    .map((entry: StorageEntry) => {
      if (entry?.name === "uploads") return null;
      const time = getEntryTimestamp(entry);
      return time ? { entry, time } : null;
    })
    .filter(Boolean) as Array<{ entry: StorageEntry; time: number }>;

  if (withTimestamps.length === 0) {
    return null;
  }

  withTimestamps.sort((a, b) => b.time - a.time);
  return `${uploadsPrefix}/${withTimestamps[0].entry.name}`;
}

async function resolveFromList(
  supabase: any,
  node: NodeInfo
) {
  const prefix = `${node.project_id}/${node.id}`;
  const { data: listData, error: listError } = await supabase.storage
    .from("files")
    .list(prefix);

  if (listError || !listData || listData.length === 0) {
    return null;
  }

  const blobEntry = listData.find((entry: any) => entry?.name === "blob");
  if (blobEntry) {
    return `${prefix}/blob`;
  }

  if (listData.length === 1) {
    const entryName = listData[0]?.name;
    if (entryName && entryName !== "uploads") {
      return `${prefix}/${entryName}`;
    }
  }

  const withTimestamps = listData
    .map((entry: StorageEntry) => {
      const time = getEntryTimestamp(entry);
      return time ? { entry, time } : null;
    })
    .filter(Boolean) as Array<{ entry: StorageEntry; time: number }>;

  if (withTimestamps.length === 0) {
    const uploadPath = await resolveFromUploads(supabase, `${prefix}/uploads`);
    if (uploadPath) {
      return uploadPath;
    }
    console.warn("Storage list has multiple entries but no timestamps available.", {
      prefix,
      candidates: listData.map((entry: any) => entry?.name).filter(Boolean),
    });
    return null;
  }

  withTimestamps.sort((a, b) => b.time - a.time);
  return `${prefix}/${withTimestamps[0].entry.name}`;
}

async function fetchStorageObject(
  supabase: any,
  storagePath: string
) {
  const { data, error } = await supabase.storage
    .from("files")
    .createSignedUrl(storagePath, 60);

  if (error || !data?.signedUrl) {
    return null;
  }

  const separator = data.signedUrl.includes("?") ? "&" : "?";
  const url = `${data.signedUrl}${separator}t=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  return { arrayBuffer, contentType };
}

export async function GET(req: NextRequest) {
  try {
    noStore();
    const supabase = await createClient();
    const { searchParams } = new URL(req.url);
    const nodeId = searchParams.get("nodeId");

    if (!nodeId) {
      return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    }

    // Get the node info first
    const { data: node, error: nodeError } = await supabase
      .from("nodes")
      .select("id, name, project_id")
      .eq("id", nodeId)
      .maybeSingle();

    if (nodeError || !node) {
      return NextResponse.json({ error: `Node not found: ${nodeError?.message || "unknown"}` }, { status: 404 });
    }

    // Get the storage path from file_contents
    const { data: content } = await supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", nodeId)
      .maybeSingle();

    const text = content?.text || "";

    const candidates = getCandidatePaths(node, text);
    let storagePath: string | null = null;
    let fileData: { arrayBuffer: ArrayBuffer; contentType: string } | null = null;

    for (const candidate of candidates) {
      const data = await fetchStorageObject(supabase, candidate);
      if (data) {
        storagePath = candidate;
        fileData = data;
        break;
      }
    }

    if (!fileData) {
      const fallbackPath = await resolveFromList(supabase, node);
      if (fallbackPath) {
        const data = await fetchStorageObject(supabase, fallbackPath);
        if (data) {
          storagePath = fallbackPath;
          fileData = data;
        }
      }
    }

    if (!fileData || !storagePath) {
      return NextResponse.json({ error: "Failed to resolve storage path" }, { status: 404 });
    }

    // Return the file with properly encoded filename for non-ASCII characters
    const encodedFilename = encodeURIComponent(node.name);
    return new NextResponse(fileData.arrayBuffer, {
      headers: {
        "Content-Type": fileData.contentType,
        "Content-Disposition": `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Get signed URL for viewing/streaming
export async function POST(req: NextRequest) {
  try {
    noStore();
    const supabase = await createClient();
    const { nodeId } = await req.json();

    if (!nodeId) {
      return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    }

    // Get the node info first
    const { data: node, error: nodeError } = await supabase
      .from("nodes")
      .select("id, name, project_id")
      .eq("id", nodeId)
      .maybeSingle();

    if (nodeError || !node) {
      return NextResponse.json({ error: `Node not found: ${nodeError?.message || "unknown"}` }, { status: 404 });
    }

    // Get the storage path from file_contents
    const { data: content } = await supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", nodeId)
      .maybeSingle();

    const text = content?.text || "";

    const candidates = getCandidatePaths(node, text);
    let signedUrl: { signedUrl: string } | null = null;

    for (const candidate of candidates) {
      const { data, error } = await supabase.storage
        .from("files")
        .createSignedUrl(candidate, 86400);
      if (!error && data) {
        signedUrl = data;
        break;
      }
    }

    if (!signedUrl) {
      const fallbackPath = await resolveFromList(supabase, node);
      if (fallbackPath) {
        const { data, error } = await supabase.storage
          .from("files")
          .createSignedUrl(fallbackPath, 86400);
        if (!error && data) {
          signedUrl = data;
        }
      }
    }

    if (!signedUrl) {
      return NextResponse.json({ error: "Failed to resolve storage path" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      url: signedUrl.signedUrl,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

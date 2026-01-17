import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type StorageEntry = {
  name?: string;
  created_at?: string | null;
  updated_at?: string | null;
  last_accessed_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

function parseStoragePath(text: string | null | undefined) {
  if (!text || !text.startsWith("storage:")) {
    return null;
  }
  return text.slice("storage:".length);
}

function getTimestamp(entry: StorageEntry) {
  const raw =
    entry.updated_at ||
    entry.created_at ||
    entry.last_accessed_at ||
    (entry.metadata as any)?.lastModified ||
    (entry.metadata as any)?.last_modified ||
    null;
  const time = raw ? Date.parse(String(raw)) : NaN;
  return Number.isNaN(time) ? null : time;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function POST(req: NextRequest) {
  const workerToken = process.env.GC_WORKER_TOKEN;
  if (!workerToken) {
    return NextResponse.json({ error: "GC_WORKER_TOKEN is not set" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer || bearer !== workerToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keepCount = Number.parseInt(process.env.GC_KEEP_COUNT || "3", 10);
  const batchSize = Number.parseInt(process.env.GC_BATCH_SIZE || "50", 10);
  const now = new Date();
  const nowIso = now.toISOString();

  const supabase = createAdminClient();

  const { data: jobs, error: jobsError } = await supabase
    .from("gc_jobs")
    .select("id, node_id, project_id, attempts, status, run_after")
    .eq("status", "queued")
    .lte("run_after", nowIso)
    .order("updated_at", { ascending: true })
    .limit(batchSize);

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  const results: Array<{ id: string; status: string; message?: string }> = [];

  for (const job of jobs || []) {
    const { data: locked, error: lockError } = await supabase
      .from("gc_jobs")
      .update({
        status: "running",
        attempts: (job.attempts || 0) + 1,
        updated_at: nowIso,
      })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id, node_id, project_id, attempts")
      .maybeSingle();

    if (lockError || !locked) {
      results.push({ id: job.id, status: "skipped", message: "lock failed" });
      continue;
    }

    const nodeId = locked.node_id as string;
    const projectId = locked.project_id as string;
    const prefix = `${projectId}/${nodeId}/uploads`;

    const { data: contentRow, error: contentError } = await supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", nodeId)
      .maybeSingle();

    if (contentError) {
      await supabase
        .from("gc_jobs")
        .update({
          status: "error",
          last_error: contentError.message,
          updated_at: nowIso,
          run_after: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq("id", job.id);
      results.push({ id: job.id, status: "error", message: contentError.message });
      continue;
    }

    const currentPath = parseStoragePath(contentRow?.text);

    const { data: listData, error: listError } = await supabase.storage
      .from("files")
      .list(prefix);

    if (listError) {
      await supabase
        .from("gc_jobs")
        .update({
          status: "error",
          last_error: listError.message,
          updated_at: nowIso,
          run_after: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq("id", job.id);
      results.push({ id: job.id, status: "error", message: listError.message });
      continue;
    }

    if (!listData || listData.length === 0) {
      await supabase
        .from("gc_jobs")
        .update({ status: "done", last_error: null, updated_at: nowIso })
        .eq("id", job.id);
      results.push({ id: job.id, status: "done" });
      continue;
    }

    const keepNames = new Set<string>();
    if (currentPath && currentPath.startsWith(`${prefix}/`)) {
      keepNames.add(currentPath.slice(prefix.length + 1));
    }

    const withTimes = (listData as StorageEntry[])
      .filter((entry) => entry?.name)
      .map((entry) => {
        const time = getTimestamp(entry);
        return time ? { name: entry.name as string, time } : null;
      })
      .filter(Boolean) as Array<{ name: string; time: number }>;

    if (withTimes.length === 0 && keepNames.size === 0) {
      await supabase
        .from("gc_jobs")
        .update({
          status: "done",
          last_error: "No timestamps available; skipped deletion",
          updated_at: nowIso,
        })
        .eq("id", job.id);
      results.push({ id: job.id, status: "done", message: "no timestamps" });
      continue;
    }

    withTimes.sort((a, b) => b.time - a.time);
    for (const item of withTimes.slice(0, Math.max(keepCount, 0))) {
      keepNames.add(item.name);
    }

    const deletePaths = (listData as StorageEntry[])
      .map((entry) => entry?.name)
      .filter((name): name is string => !!name && !keepNames.has(name))
      .map((name) => `${prefix}/${name}`);

    if (deletePaths.length > 0) {
      for (const group of chunk(deletePaths, 100)) {
        const { error: removeError } = await supabase.storage
          .from("files")
          .remove(group);
        if (removeError) {
          await supabase
            .from("gc_jobs")
            .update({
              status: "error",
              last_error: removeError.message,
              updated_at: nowIso,
              run_after: new Date(Date.now() + 60_000).toISOString(),
            })
            .eq("id", job.id);
          results.push({ id: job.id, status: "error", message: removeError.message });
          continue;
        }
      }
    }

    await supabase
      .from("gc_jobs")
      .update({ status: "done", last_error: null, updated_at: nowIso })
      .eq("id", job.id);
    results.push({ id: job.id, status: "done" });
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    results,
  });
}

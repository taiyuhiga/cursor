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
  const maxAttempts = Number.parseInt(process.env.GC_MAX_ATTEMPTS || "5", 10);
  const backoffBaseSeconds = Number.parseInt(
    process.env.GC_BACKOFF_BASE_SECONDS || "30",
    10,
  );
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
    const startedAt = Date.now();
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
    const attempts = locked.attempts || 0;

    const logEvent = (payload: Record<string, unknown>) => {
      console.log(JSON.stringify(payload));
    };
    const makeSummary = (summary: {
      current_storage_path: string | null;
      prefix: string;
      list_count: number;
      kept_count: number;
      deleted_count: number;
      note?: string;
    }) => summary;

    const finalizeError = async (
      phase: string,
      message: string,
      summary?: ReturnType<typeof makeSummary>,
    ) => {
      const shouldRetry = attempts < maxAttempts;
      const backoffSeconds = backoffBaseSeconds * Math.max(1, attempts);
      const nextRun = new Date(Date.now() + backoffSeconds * 1000).toISOString();
      await supabase
        .from("gc_jobs")
        .update({
          status: shouldRetry ? "queued" : "error",
          last_error: message,
          last_error_phase: phase,
          last_summary: summary ?? null,
          duration_ms: Date.now() - startedAt,
          updated_at: nowIso,
          ...(shouldRetry ? { run_after: nextRun } : {}),
        })
        .eq("id", job.id);
      logEvent({
        event: "gc_job_error",
        job_id: job.id,
        node_id: nodeId,
        project_id: projectId,
        phase,
        message,
        attempts,
        retrying: shouldRetry,
        duration_ms: Date.now() - startedAt,
        summary,
      });
      results.push({ id: job.id, status: shouldRetry ? "queued" : "error", message });
    };

    logEvent({
      event: "gc_job_start",
      job_id: job.id,
      node_id: nodeId,
      project_id: projectId,
      attempts,
      keep_count: keepCount,
      batch_size: batchSize,
      prefix,
    });

    const { data: contentRow, error: contentError } = await supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", nodeId)
      .maybeSingle();

    if (contentError) {
      await finalizeError("fetch_current", contentError.message);
      continue;
    }

    const currentPath = parseStoragePath(contentRow?.text);

    const { data: listData, error: listError } = await supabase.storage
      .from("files")
      .list(prefix);

    if (listError) {
      await finalizeError("list", listError.message, {
        current_storage_path: currentPath,
        prefix,
        list_count: 0,
        kept_count: 0,
        deleted_count: 0,
      });
      continue;
    }

    if (!listData || listData.length === 0) {
      const summary = makeSummary({
        current_storage_path: currentPath,
        prefix,
        list_count: 0,
        kept_count: 0,
        deleted_count: 0,
      });
      await supabase
        .from("gc_jobs")
        .update({
          status: "done",
          last_error: null,
          last_error_phase: null,
          last_summary: summary,
          duration_ms: Date.now() - startedAt,
          updated_at: nowIso,
        })
        .eq("id", job.id);
      logEvent({
        event: "gc_job_done",
        job_id: job.id,
        node_id: nodeId,
        project_id: projectId,
        duration_ms: Date.now() - startedAt,
        summary,
      });
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
      const summary = makeSummary({
        current_storage_path: currentPath,
        prefix,
        list_count: listData.length,
        kept_count: 0,
        deleted_count: 0,
        note: "no_timestamps",
      });
      await supabase
        .from("gc_jobs")
        .update({
          status: "done",
          last_error: "No timestamps available; skipped deletion",
          last_error_phase: "timestamp",
          last_summary: summary,
          duration_ms: Date.now() - startedAt,
          updated_at: nowIso,
        })
        .eq("id", job.id);
      logEvent({
        event: "gc_job_done",
        job_id: job.id,
        node_id: nodeId,
        project_id: projectId,
        duration_ms: Date.now() - startedAt,
        summary,
      });
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
          await finalizeError("delete", removeError.message, {
            current_storage_path: currentPath,
            prefix,
            list_count: listData.length,
            kept_count: keepNames.size,
            deleted_count: deletePaths.length,
          });
          continue;
        }
      }
    }

    const summary = makeSummary({
      current_storage_path: currentPath,
      prefix,
      list_count: listData.length,
      kept_count: keepNames.size,
      deleted_count: deletePaths.length,
    });
    await supabase
      .from("gc_jobs")
      .update({
        status: "done",
        last_error: null,
        last_error_phase: null,
        last_summary: summary,
        duration_ms: Date.now() - startedAt,
        updated_at: nowIso,
      })
      .eq("id", job.id);
    logEvent({
      event: "gc_job_done",
      job_id: job.id,
      node_id: nodeId,
      project_id: projectId,
      duration_ms: Date.now() - startedAt,
      summary,
    });
    results.push({ id: job.id, status: "done" });
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    results,
  });
}

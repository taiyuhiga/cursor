import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function enqueueGcJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
  projectId: string,
) {
  const now = new Date().toISOString();
  const client = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient()
    : supabase;
  const { error } = await client
    .from("gc_jobs")
    .upsert(
      {
        node_id: nodeId,
        project_id: projectId,
        status: "queued",
        run_after: now,
        attempts: 0,
        updated_at: now,
        last_error: null,
      },
      { onConflict: "node_id" },
    );
  if (error) {
    console.warn("gc_jobs enqueue failed", error.message);
  }
}

// Confirm that an upload was successful and save the storage reference
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { nodeId, storagePath, expectedVersion } = await req.json();

    if (!nodeId || !storagePath) {
      return NextResponse.json({
        error: "nodeId and storagePath are required"
      }, { status: 400 });
    }
    if (typeof expectedVersion !== "number") {
      return NextResponse.json({
        error: "expectedVersion must be a number"
      }, { status: 400 });
    }

    const { data: node, error: nodeError } = await supabase
      .from("nodes")
      .select("id, project_id")
      .eq("id", nodeId)
      .maybeSingle();

    if (nodeError || !node) {
      return NextResponse.json({
        error: `Node not found: ${nodeError?.message || "unknown"}`
      }, { status: 404 });
    }

    const expectedPrefix = `${node.project_id}/${nodeId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      return NextResponse.json({
        error: "storagePath does not match node/project"
      }, { status: 400 });
    }

    // Verify the file exists in storage
    const { data: fileData, error: fileError } = await supabase.storage
      .from("files")
      .list(storagePath.split("/").slice(0, -1).join("/"));

    const fileName = storagePath.split("/").pop();
    const fileExists = fileData?.some(f => f.name === fileName);

    if (fileError || !fileExists) {
      // File doesn't exist - rollback the node
      await supabase.from("nodes").delete().eq("id", nodeId);
      return NextResponse.json({
        error: "File upload not confirmed - file not found in storage"
      }, { status: 400 });
    }

    const nextVersion = expectedVersion + 1;

    // Optimistic lock: update only if version matches
    const { data: updated, error: updateError } = await supabase
      .from("file_contents")
      .update({
        text: `storage:${storagePath}`,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("node_id", nodeId)
      .eq("version", expectedVersion)
      .select("version")
      .maybeSingle();

    if (updateError) {
      // Rollback storage object only
      await supabase.storage.from("files").remove([storagePath]);
      return NextResponse.json({
        error: `Failed to save content reference: ${updateError.message}`
      }, { status: 500 });
    }

    if (!updated) {
      if (expectedVersion === 0) {
        const { data: inserted, error: insertError } = await supabase
          .from("file_contents")
          .insert({
            node_id: nodeId,
            text: `storage:${storagePath}`,
            version: nextVersion,
          })
          .select("version")
          .single();

        if (insertError) {
          return NextResponse.json({
            error: "Upload conflict - content already updated"
          }, { status: 409 });
        }

        try {
          await enqueueGcJob(supabase, nodeId, node.project_id);
        } catch {
          // GC enqueue failure should not block uploads.
        }

        return NextResponse.json({
          success: true,
          nodeId: nodeId,
          version: inserted.version,
        });
      }

      return NextResponse.json({
        error: "Upload conflict - content already updated"
      }, { status: 409 });
    }

    try {
      await enqueueGcJob(supabase, nodeId, node.project_id);
    } catch {
      // GC enqueue failure should not block uploads.
    }

    return NextResponse.json({
      success: true,
      nodeId: nodeId,
      version: updated.version,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

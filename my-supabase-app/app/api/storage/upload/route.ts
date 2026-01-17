import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { buildUploadStoragePath } from "@/lib/storage/path";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    let formData;
    try {
      formData = await req.formData();
    } catch (formError: any) {
      return NextResponse.json({
        error: `Failed to parse FormData: ${formError.message}`
      }, { status: 400 });
    }

    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;
    const parentIdStr = formData.get("parentId") as string | null;
    const fileName = formData.get("fileName") as string | null;

    // Convert empty string to null for parentId
    const parentId = parentIdStr && parentIdStr.trim() !== "" ? parentIdStr : null;

    if (!file || !projectId || !fileName) {
      return NextResponse.json({
        error: `Missing required fields. file: ${!!file}, projectId: ${!!projectId}, fileName: ${!!fileName}`
      }, { status: 400 });
    }

    // Create the node first
    const { data: node, error: nodeError } = await supabase
      .from("nodes")
      .insert({
        project_id: projectId,
        type: "file",
        name: fileName,
        parent_id: parentId,
      })
      .select()
      .single();

    if (nodeError) {
      return NextResponse.json({ error: `Failed to create node: ${nodeError.message}` }, { status: 500 });
    }

    // Upload to Supabase Storage
    const uploadId = crypto.randomUUID();
    const storagePath = buildUploadStoragePath(projectId, node.id, uploadId);

    // Convert file to ArrayBuffer for reliable upload
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("files")
      .upload(storagePath, arrayBuffer, {
        cacheControl: "0",
        upsert: true,
        contentType: file.type || "application/octet-stream",
      });

    if (uploadError) {
      // Rollback - delete the node
      await supabase.from("nodes").delete().eq("id", node.id);
      return NextResponse.json({ error: `Failed to upload file: ${uploadError.message}` }, { status: 500 });
    }

    // Store the storage path in file_contents (prefixed with "storage:" to identify it)
    const { error: contentError } = await supabase
      .from("file_contents")
      .insert({
        node_id: node.id,
        text: `storage:${storagePath}`,
        version: 1,
      });

    if (contentError) {
      // Rollback
      await supabase.storage.from("files").remove([storagePath]);
      await supabase.from("nodes").delete().eq("id", node.id);
      return NextResponse.json({ error: `Failed to save content reference: ${contentError.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      nodeId: node.id,
      storagePath: storagePath,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

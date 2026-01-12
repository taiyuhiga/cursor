import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildStoragePath } from "@/lib/storage/path";

// Create a signed upload URL for direct client-to-Supabase uploads
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { projectId, parentId, fileName, contentType } = await req.json();

    if (!projectId || !fileName) {
      return NextResponse.json({
        error: "projectId and fileName are required"
      }, { status: 400 });
    }

    // Create the node first
    const { data: node, error: nodeError } = await supabase
      .from("nodes")
      .insert({
        project_id: projectId,
        type: "file",
        name: fileName,
        parent_id: parentId || null,
      })
      .select()
      .single();

    if (nodeError) {
      return NextResponse.json({
        error: `Failed to create node: ${nodeError.message}`
      }, { status: 500 });
    }

    // Create the storage path
    const storagePath = buildStoragePath(projectId, node.id, fileName);

    // Create a signed upload URL (valid for 5 minutes)
    const { data: signedUrl, error: urlError } = await supabase.storage
      .from("files")
      .createSignedUploadUrl(storagePath);

    if (urlError) {
      // Rollback - delete the node
      await supabase.from("nodes").delete().eq("id", node.id);
      return NextResponse.json({
        error: `Failed to create upload URL: ${urlError.message}`
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      nodeId: node.id,
      storagePath: storagePath,
      uploadUrl: signedUrl.signedUrl,
      token: signedUrl.token,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

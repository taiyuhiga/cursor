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

    // Check for existing file with same name and parent
    let existingFileQuery = supabase
      .from("nodes")
      .select("id")
      .eq("project_id", projectId)
      .eq("type", "file")
      .eq("name", fileName);

    if (parentId) {
      existingFileQuery = existingFileQuery.eq("parent_id", parentId);
    } else {
      existingFileQuery = existingFileQuery.is("parent_id", null);
    }

    const { data: existingFile } = await existingFileQuery.maybeSingle();

    let node;
    if (existingFile) {
      // Use existing file node
      node = existingFile;
    } else {
      // Create the node first
      const { data: newNode, error: nodeError } = await supabase
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
      node = newNode;
    }

    // Create the storage path
    const storagePath = buildStoragePath(projectId, node.id, fileName);

    // Create a signed upload URL (valid for 5 minutes)
    const { data: signedUrl, error: urlError } = await supabase.storage
      .from("files")
      .createSignedUploadUrl(storagePath);

    if (urlError) {
      // Rollback - delete the node only if we created it
      if (!existingFile) {
        await supabase.from("nodes").delete().eq("id", node.id);
      }
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

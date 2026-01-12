import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildStoragePath } from "@/lib/storage/path";

export async function GET(req: NextRequest) {
  try {
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

    let storagePath: string;

    if (text.startsWith("storage:")) {
      // Storage reference exists
      storagePath = text.replace("storage:", "");
    } else {
      // Try to find file directly in storage using convention: projectId/nodeId/fileName
      storagePath = buildStoragePath(node.project_id, node.id, node.name);
    }

    // Get the file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("files")
      .download(storagePath);

    if (downloadError) {
      return NextResponse.json({ error: `Failed to download: ${downloadError.message}` }, { status: 500 });
    }

    // Return the file
    return new NextResponse(fileData, {
      headers: {
        "Content-Type": fileData.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${node.name}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Get signed URL for viewing/streaming
export async function POST(req: NextRequest) {
  try {
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

    let storagePath: string;

    if (text.startsWith("storage:")) {
      // Storage reference exists
      storagePath = text.replace("storage:", "");
    } else {
      // Try to find file directly in storage using convention: projectId/nodeId/fileName
      storagePath = buildStoragePath(node.project_id, node.id, node.name);
    }

    // Create a signed URL (valid for 1 hour)
    const { data: signedUrl, error: urlError } = await supabase.storage
      .from("files")
      .createSignedUrl(storagePath, 3600);

    if (urlError) {
      return NextResponse.json({ error: `Failed to create URL: ${urlError.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      url: signedUrl.signedUrl,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

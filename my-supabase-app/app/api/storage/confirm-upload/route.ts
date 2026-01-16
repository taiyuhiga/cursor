import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Confirm that an upload was successful and save the storage reference
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { nodeId, storagePath } = await req.json();

    if (!nodeId || !storagePath) {
      return NextResponse.json({
        error: "nodeId and storagePath are required"
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

    // Store the storage path in file_contents (upsert for replace)
    const { error: contentError } = await supabase
      .from("file_contents")
      .upsert({
        node_id: nodeId,
        text: `storage:${storagePath}`,
      }, { onConflict: "node_id" });

    if (contentError) {
      // Rollback storage object only
      await supabase.storage.from("files").remove([storagePath]);
      return NextResponse.json({
        error: `Failed to save content reference: ${contentError.message}`
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      nodeId: nodeId,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

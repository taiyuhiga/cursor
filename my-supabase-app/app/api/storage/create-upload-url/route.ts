import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { buildUploadStoragePath } from "@/lib/storage/path";

// Create a signed upload URL for direct client-to-Supabase uploads
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { projectId, parentId, fileName, contentType } = await req.json();
    const envReady = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/68f24dc3-f94d-493b-8034-e2c7e7c843e1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/storage/create-upload-url/route.ts:POST:entry',message:'create-upload-url entry',data:{envReady,projectIdPresent:!!projectId,parentIdPresent:!!parentId,fileNameLength:typeof fileName === 'string' ? fileName.length : null,contentTypePresent:!!contentType},timestamp:Date.now(),sessionId:'debug-session',runId:'ci-500-pre',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

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

    const { data: existingFile, error: existingFileError } = await existingFileQuery.maybeSingle();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/68f24dc3-f94d-493b-8034-e2c7e7c843e1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/storage/create-upload-url/route.ts:POST:existingFile',message:'existing file lookup',data:{existingFileFound:!!existingFile,existingFileError:existingFileError?.message ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'ci-500-pre',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion

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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/68f24dc3-f94d-493b-8034-e2c7e7c843e1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/storage/create-upload-url/route.ts:POST:nodeInsert',message:'node insert result',data:{nodeCreated:!!newNode,nodeError:nodeError?.message ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'ci-500-pre',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion

      if (nodeError) {
        return NextResponse.json({
          error: `Failed to create node: ${nodeError.message}`
        }, { status: 500 });
      }
      node = newNode;
    }

    if (!node?.id) {
      console.error("create-upload-url: node id missing", {
        projectId,
        parentId,
        fileName,
        existingFile,
        node,
      });
      return NextResponse.json({
        error: "Failed to resolve node id for storage path"
      }, { status: 500 });
    }

    const { data: contentRow } = await supabase
      .from("file_contents")
      .select("version")
      .eq("node_id", node.id)
      .maybeSingle();
    const currentVersion = typeof contentRow?.version === "number" ? contentRow.version : 0;

    // Create a unique storage path for this upload (no delete/upsert needed)
    const uploadId = crypto.randomUUID();
    const storagePath = buildUploadStoragePath(projectId, node.id, uploadId);

    // Create a signed upload URL (valid for 5 minutes)
    const { data: signedUrl, error: urlError } = await supabase.storage
      .from("files")
      .createSignedUploadUrl(storagePath, {
        upsert: false,
        ...(contentType ? { contentType } : {}),
      });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/68f24dc3-f94d-493b-8034-e2c7e7c843e1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/storage/create-upload-url/route.ts:POST:createSignedUploadUrl',message:'createSignedUploadUrl result',data:{storagePath,hasSignedUrl:!!signedUrl,urlError:urlError?.message ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'ci-500-pre',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion

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
      uploadId: uploadId,
      currentVersion,
    });
  } catch (error: any) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/68f24dc3-f94d-493b-8034-e2c7e7c843e1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/storage/create-upload-url/route.ts:POST:catch',message:'create-upload-url error',data:{errorName:error?.name ?? null,errorMessage:error?.message ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'ci-500-pre',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

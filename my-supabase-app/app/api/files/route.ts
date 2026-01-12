import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ヘルパー: パスから親フォルダIDを取得・作成（mkdir -p 的な処理）
async function ensureParentFolders(supabase: any, projectId: string, path: string): Promise<string | null> {
  const parts = path.split("/");
  if (parts.length <= 1) return null; // ルート直下

  const folderNames = parts.slice(0, -1); // ファイル名を除くフォルダ部分
  let currentParentId: string | null = null;

  for (const folderName of folderNames) {
    // フォルダを探す
    let query = supabase
      .from("nodes")
      .select("id")
      .eq("project_id", projectId)
      .eq("type", "folder")
      .eq("name", folderName);

    if (currentParentId) {
      query = query.eq("parent_id", currentParentId);
    } else {
      query = query.is("parent_id", null);
    }

    const { data: existingFolder } = await query.maybeSingle();

    if (existingFolder) {
      currentParentId = existingFolder.id;
    } else {
      // なければ作成
      const insertRes: any = await supabase
        .from("nodes")
        .insert({
          project_id: projectId,
          type: "folder",
          name: folderName,
          parent_id: currentParentId,
        })
        .select("id")
        .single();

      if (insertRes.error) throw new Error(`Failed to create folder '${folderName}': ${insertRes.error.message}`);
      if (!insertRes.data) throw new Error(`Failed to create folder '${folderName}'`);
      currentParentId = insertRes.data.id;
    }
  }

  return currentParentId;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  let body;
  try {
    body = await req.json();
  } catch (parseError: any) {
    return NextResponse.json({
      error: `Failed to parse request body: ${parseError.message}. The file may be too large.`
    }, { status: 400 });
  }

  const { action, path, content, id, newName, projectId } = body;

  // projectIdが必須の操作の場合はチェック
  if ((action === "create_file" || action === "create_folder") && !projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    let result;
    
    switch (action) {
      case "create_file": {
        // 親フォルダを確保（なければ作成）
        const parentId = await ensureParentFolders(supabase, projectId, path);
        const fileName = path.split("/").pop()!;

        // ノード作成
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

        if (nodeError) throw new Error(`Failed to create file: ${nodeError.message}`);

        // コンテンツ作成
        const { error: contentError } = await supabase
          .from("file_contents")
          .insert({
            node_id: node.id,
            text: content || "",
          });

        if (contentError) throw new Error(`Failed to create file content: ${contentError.message}`);

        result = { success: true, nodeId: node.id };
        break;
      }
      
      case "create_folder": {
        // フォルダ作成（パス全体をフォルダとして作成）
        // ensureParentFolders + 最後の要素を作る
        const parentId = await ensureParentFolders(supabase, projectId, path + "/dummy");
        result = { success: true, nodeId: parentId };
        break;
      }
      
      case "delete_node": {
        const { error: delError } = await supabase.from("nodes").delete().eq("id", id);
        if (delError) throw delError;
        result = { success: true };
        break;
      }
      
      case "rename_node": {
        const { error } = await supabase
          .from("nodes")
          .update({ name: newName })
          .eq("id", id);
        if (error) throw new Error(error.message);
        result = { success: true };
        break;
      }
      
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

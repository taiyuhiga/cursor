import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ヘルパー: パスから親フォルダIDを取得・作成（mkdir -p 的な処理）
async function ensureParentFolders(supabase: any, projectId: string, path: string): Promise<string | null> {
  const parts = path.split("/");
  if (parts.length <= 1) return null; // ルート直下

  const folderNames = parts.slice(0, -1); // ファイル名を除くフォルダ部分
  let currentParentId: string | null = null;

  for (const folderName of folderNames) {
    const findFolderId = async () => {
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
      return existingFolder?.id ?? null;
    };

    const existingId = await findFolderId();
    if (existingId) {
      currentParentId = existingId;
      continue;
    }

    // なければ作成（競合時は再取得）
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

    if (insertRes.error) {
      if (insertRes.error.code === "23505") {
        const retryId = await findFolderId();
        if (retryId) {
          currentParentId = retryId;
          continue;
        }
      }
      throw new Error(`Failed to create folder '${folderName}': ${insertRes.error.message}`);
    }
    if (!insertRes.data) throw new Error(`Failed to create folder '${folderName}'`);
    currentParentId = insertRes.data.id;
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

  const { action, path, content, id, newName, projectId, parentId: explicitParentId } = body;

  // projectIdが必須の操作の場合はチェック
  if ((action === "create_file" || action === "create_folder") && !projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    let result;
    
    switch (action) {
      case "create_file": {
        // 明示的なparentIdが渡された場合はそれを使用、なければパスから推測
        const parentId = explicitParentId !== undefined
          ? explicitParentId
          : await ensureParentFolders(supabase, projectId, path);
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
        const folderName = path.split("/").pop()!;

        // 明示的なparentIdが渡された場合はそれを使用、なければパスから推測
        const parentId = explicitParentId !== undefined
          ? explicitParentId
          : await ensureParentFolders(supabase, projectId, path);

        // フォルダを作成
        const { data: folder, error: folderError } = await supabase
          .from("nodes")
          .insert({
            project_id: projectId,
            type: "folder",
            name: folderName,
            parent_id: parentId,
          })
          .select()
          .single();

        if (folderError) throw new Error(`Failed to create folder: ${folderError.message}`);
        result = { success: true, nodeId: folder.id };
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

      case "move_node": {
        const { newParentId } = body;
        const { error } = await supabase
          .from("nodes")
          .update({ parent_id: newParentId })
          .eq("id", id);
        if (error) throw new Error(error.message);
        result = { success: true };
        break;
      }

      case "copy_node": {
        const { newParentId } = body;

        // Get source node
        const { data: sourceNode, error: sourceError } = await supabase
          .from("nodes")
          .select("*")
          .eq("id", id)
          .single();

        if (sourceError || !sourceNode) {
          throw new Error("Source node not found");
        }

        // Helper function to recursively copy nodes
        const copyNodeRecursive = async (
          node: any,
          targetParentId: string | null
        ): Promise<string> => {
          // Generate a unique name if copying to the same folder
          let newName = node.name;
          if (node.parent_id === targetParentId) {
            // Check if name already ends with " - コピー" pattern
            const copyPattern = / - コピー( \(\d+\))?$/;
            if (copyPattern.test(newName)) {
              // Extract base name and increment counter
              const baseName = newName.replace(copyPattern, "");
              let counter = 2;

              // Find existing copies and get the next number
              const { data: existingNodes } = await supabase
                .from("nodes")
                .select("name")
                .eq("parent_id", targetParentId)
                .like("name", `${baseName} - コピー%`);

              if (existingNodes && existingNodes.length > 0) {
                const numbers = existingNodes.map((n: any) => {
                  const match = n.name.match(/ - コピー \((\d+)\)$/);
                  return match ? parseInt(match[1], 10) : 1;
                });
                counter = Math.max(...numbers) + 1;
              }
              newName = `${baseName} - コピー (${counter})`;
            } else {
              newName = `${newName} - コピー`;
            }
          }

          // Create new node
          const { data: newNode, error: createError } = await supabase
            .from("nodes")
            .insert({
              project_id: node.project_id,
              type: node.type,
              name: newName,
              parent_id: targetParentId,
            })
            .select()
            .single();

          if (createError) throw new Error(`Failed to copy: ${createError.message}`);

          // If it's a file, copy the content
          if (node.type === "file") {
            const { data: content } = await supabase
              .from("file_contents")
              .select("text")
              .eq("node_id", node.id)
              .single();

            if (content) {
              await supabase.from("file_contents").insert({
                node_id: newNode.id,
                text: content.text,
              });
            }
          }

          // If it's a folder, recursively copy children
          if (node.type === "folder") {
            const { data: children } = await supabase
              .from("nodes")
              .select("*")
              .eq("parent_id", node.id);

            if (children) {
              for (const child of children) {
                await copyNodeRecursive(child, newNode.id);
              }
            }
          }

          return newNode.id;
        };

        const newNodeId = await copyNodeRecursive(sourceNode, newParentId);
        result = { success: true, nodeId: newNodeId };
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

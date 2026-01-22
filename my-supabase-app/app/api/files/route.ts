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

        // 既存ファイルを確認
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

        if (existingFile) {
          // 既存ファイルがあればコンテンツを更新
          const { error: updateError } = await supabase
            .from("file_contents")
            .upsert({
              node_id: existingFile.id,
              text: content || "",
            });

          if (updateError) throw new Error(`Failed to update file content: ${updateError.message}`);
          result = { success: true, nodeId: existingFile.id };
          break;
        }

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

        // 既存フォルダーを確認
        let existingQuery = supabase
          .from("nodes")
          .select("id")
          .eq("project_id", projectId)
          .eq("type", "folder")
          .eq("name", folderName);

        if (parentId) {
          existingQuery = existingQuery.eq("parent_id", parentId);
        } else {
          existingQuery = existingQuery.is("parent_id", null);
        }

        const { data: existingFolder } = await existingQuery.maybeSingle();

        if (existingFolder) {
          // 既存フォルダーがあればそのIDを返す
          result = { success: true, nodeId: existingFolder.id };
          break;
        }

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

        if (folderError) {
          // 競合エラーの場合は再度取得を試みる
          if (folderError.code === "23505") {
            const { data: retryFolder } = await existingQuery.maybeSingle();
            if (retryFolder) {
              result = { success: true, nodeId: retryFolder.id };
              break;
            }
          }
          throw new Error(`Failed to create folder: ${folderError.message}`);
        }
        result = { success: true, nodeId: folder.id };
        break;
      }
      
      case "delete_node": {
        // Helper function to recursively delete a node and all its children
        const deleteNodeRecursive = async (nodeId: string): Promise<void> => {
          // First, get all children of this node
          const { data: children, error: childrenError } = await supabase
            .from("nodes")
            .select("id")
            .eq("parent_id", nodeId);

          if (childrenError) throw childrenError;

          // Recursively delete all children
          if (children && children.length > 0) {
            for (const child of children) {
              await deleteNodeRecursive(child.id);
            }
          }

          // Delete storage file if this is a file with storage reference
          const { data: contentRow } = await supabase
            .from("file_contents")
            .select("text")
            .eq("node_id", nodeId)
            .maybeSingle();
          const storagePath = typeof contentRow?.text === "string" && contentRow.text.startsWith("storage:")
            ? contentRow.text.replace("storage:", "")
            : null;
          if (storagePath) {
            await supabase.storage.from("files").remove([storagePath]);
          }

          // Delete file_contents if this is a file
          await supabase.from("file_contents").delete().eq("node_id", nodeId);

          // Now delete the node itself
          const { error: delError } = await supabase.from("nodes").delete().eq("id", nodeId);
          if (delError) throw delError;
        };

        await deleteNodeRecursive(id);
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

        const isUniqueNameViolation = (error: any) => {
          if (!error) return false;
          if (error.code === "23505") return true;
          const message = typeof error.message === "string" ? error.message : "";
          return message.toLowerCase().includes("duplicate key value") ||
            message.toLowerCase().includes("unique constraint");
        };

        const splitNameParts = (name: string, isFile: boolean) => {
          let baseName: string;
          let extension: string;

          if (isFile) {
            const lastDotIndex = name.lastIndexOf(".");
            if (lastDotIndex > 0) {
              baseName = name.substring(0, lastDotIndex);
              extension = name.substring(lastDotIndex);
            } else {
              baseName = name;
              extension = "";
            }
          } else {
            baseName = name;
            extension = "";
          }

          const copyPattern = / copy( \d+)?$/;
          const baseWithoutCopy = baseName.replace(copyPattern, "");
          return { baseWithoutCopy, extension };
        };

        const buildCopyName = (baseWithoutCopy: string, extension: string, counter: number) => {
          if (counter === 1) {
            return `${baseWithoutCopy} copy${extension}`;
          }
          return `${baseWithoutCopy} copy ${counter}${extension}`;
        };

        const getExistingNames = async (targetParentId: string | null, projectId: string) => {
          let query = supabase.from("nodes").select("name").eq("project_id", projectId);
          if (targetParentId === null) {
            query = query.is("parent_id", null);
          } else {
            query = query.eq("parent_id", targetParentId);
          }
          const { data } = await query;
          return (data || []).map((entry: any) => entry.name as string);
        };

        const getNextCopyCounter = (existingNames: string[], baseWithoutCopy: string, extension: string) => {
          if (!existingNames.length) return 1;
          const escapedBase = baseWithoutCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedExt = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

          const copyNames = existingNames.filter((name: string) => {
            if (extension) {
              return name === `${baseWithoutCopy}${extension}` ||
                name === `${baseWithoutCopy} copy${extension}` ||
                name.match(new RegExp(`^${escapedBase} copy \\d+${escapedExt}$`));
            }
            return name === baseWithoutCopy ||
              name === `${baseWithoutCopy} copy` ||
              name.match(new RegExp(`^${escapedBase} copy \\d+$`));
          });

          if (copyNames.length === 0) return 1;

          const numbers = copyNames.map((name: string) => {
            const nameWithoutExt = extension ? name.replace(new RegExp(escapedExt + "$"), "") : name;
            if (nameWithoutExt === baseWithoutCopy) {
              return 0;
            }
            const match = nameWithoutExt.match(/ copy( (\d+))?$/);
            if (match) {
              return match[2] ? parseInt(match[2], 10) : 1;
            }
            return 0;
          });

          return Math.max(...numbers) + 1;
        };

        const insertCopyNode = async (node: any, targetParentId: string | null) => {
          const isFile = node.type === "file";
          const { baseWithoutCopy, extension } = splitNameParts(node.name, isFile);
          let useCopyName = node.parent_id === targetParentId;
          let counter = 0;
          let candidateName = node.name;
          let existingNames: string[] | null = null;

          if (useCopyName) {
            existingNames = await getExistingNames(targetParentId, node.project_id);
            counter = getNextCopyCounter(existingNames, baseWithoutCopy, extension);
            candidateName = buildCopyName(baseWithoutCopy, extension, counter);
          }

          let attempts = 0;
          const maxAttempts = 50;

          while (attempts < maxAttempts) {
            const { data: newNode, error: createError } = await supabase
              .from("nodes")
              .insert({
                project_id: node.project_id,
                type: node.type,
                name: candidateName,
                parent_id: targetParentId,
              })
              .select()
              .single();

            if (!createError && newNode) {
              return { newNode, finalName: candidateName };
            }

            if (!isUniqueNameViolation(createError)) {
              throw new Error(`Failed to copy: ${createError?.message || "Unknown error"}`);
            }

            attempts += 1;
            if (!useCopyName) {
              useCopyName = true;
              existingNames = await getExistingNames(targetParentId, node.project_id);
              counter = getNextCopyCounter(existingNames, baseWithoutCopy, extension);
            } else {
              counter += 1;
            }
            candidateName = buildCopyName(baseWithoutCopy, extension, counter);
          }

          throw new Error("Failed to generate a unique copy name");
        };

        // Helper function to recursively copy nodes
        const copyNodeRecursive = async (
          node: any,
          targetParentId: string | null
        ): Promise<string> => {
          const { newNode, finalName } = await insertCopyNode(node, targetParentId);

          // If it's a file, copy the content
          if (node.type === "file") {
            const { data: content } = await supabase
              .from("file_contents")
              .select("text")
              .eq("node_id", node.id)
              .single();

            if (content) {
              let newText = content.text;

              // If it's a storage reference, copy the actual file in storage
              if (content.text && content.text.startsWith("storage:")) {
                const originalPath = content.text.replace("storage:", "");
                const newPath = `${node.project_id}/${newNode.id}/${finalName}`;

                // Copy file in storage
                const { error: copyError } = await supabase.storage
                  .from("files")
                  .copy(originalPath, newPath);

                if (!copyError) {
                  newText = `storage:${newPath}`;
                }
                // If copy fails, keep the original reference (shared file)
              }

              await supabase.from("file_contents").insert({
                node_id: newNode.id,
                text: newText,
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

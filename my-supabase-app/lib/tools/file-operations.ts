import { createClient } from "@/lib/supabase/server";

export async function createFile(name: string, content: string = "") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  // デフォルトのプロジェクトを取得（簡易実装）
  // 本来はコンテキストからprojectIdを受け取るべきだが、
  // 今はシングルプロジェクト前提で、ユーザーの最初のプロジェクトを探す
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!workspace) throw new Error("Workspace not found");

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("workspace_id", workspace.id)
    .single();

  if (!project) throw new Error("Project not found");

  // ファイル作成（nodesテーブル）
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      project_id: project.id,
      type: "file",
      name: name,
      parent_id: null, // ルートに作成（フォルダ対応は後で）
    })
    .select()
    .single();

  if (nodeError) throw new Error(`Failed to create file node: ${nodeError.message}`);

  // コンテンツ作成（file_contentsテーブル）
  const { error: contentError } = await supabase
    .from("file_contents")
    .insert({
      node_id: node.id,
      text: content,
    });

  if (contentError) throw new Error(`Failed to create file content: ${contentError.message}`);

  return { success: true, fileName: name, nodeId: node.id };
}

export async function listFiles() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  // プロジェクト取得（同上）
  const { data: workspace } = await supabase.from("workspaces").select("id").eq("owner_id", user.id).single();
  if (!workspace) throw new Error("Workspace not found");
  const { data: project } = await supabase.from("projects").select("id").eq("workspace_id", workspace.id).single();
  if (!project) throw new Error("Project not found");

  const { data: nodes } = await supabase
    .from("nodes")
    .select("id, name, type")
    .eq("project_id", project.id);

  return nodes || [];
}


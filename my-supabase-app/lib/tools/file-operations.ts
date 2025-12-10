import { createClient } from "@/lib/supabase/server";

// ヘルパー: 現在のユーザーのプロジェクトIDを取得
async function getProject(supabase: any) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

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

  return project;
}

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
      const { data: newFolder, error } = await supabase
        .from("nodes")
        .insert({
          project_id: projectId,
          type: "folder",
          name: folderName,
          parent_id: currentParentId,
        })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to create folder '${folderName}': ${error.message}`);
      currentParentId = newFolder.id;
    }
  }

  return currentParentId;
}

// ヘルパー: パスからノードを検索
async function findNodeByPath(supabase: any, projectId: string, path: string) {
  const parts = path.split("/");
  const fileName = parts[parts.length - 1];
  
  // 親フォルダIDを取得（なければnull）
  // 注意: ここではフォルダが存在することを前提に検索する簡易版
  // 厳密にはパスを上から辿る必要があるが、簡易的に「名前と親ID」で探す
  // （同名ファイルが別フォルダにある場合に対応するため、ensureParentFoldersのロジックを使って親IDを特定する必要がある）
  
  // 簡易実装: パス解析は重いので、まずは親フォルダ特定ロジックを流用して親IDを探す
  // ただし ensureParentFolders は「なければ作る」ので、検索用には「なければエラー」にする必要があるが
  // ここでは ensureParentFolders を使って親IDを特定してしまう（検索ついでにフォルダ補完されてもまあ良いとする）
  // 厳密な検索用には別途ロジックが必要だが、一旦これで。
  
  // 修正: 検索だけでフォルダを作りたくない場合は、別途ロジックが必要。
  // ここでは簡易的に「名前」だけで検索し、候補が複数あればパスでフィルタリングするアプローチをとるか、
  // 真面目にトップダウンで検索するか。
  
  // 真面目に検索
  let currentParentId: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const partName = parts[i];
    const isLast = i === parts.length - 1;
    
    let query = supabase
      .from("nodes")
      .select("id, type")
      .eq("project_id", projectId)
      .eq("name", partName);

    if (currentParentId) {
      query = query.eq("parent_id", currentParentId);
    } else {
      query = query.is("parent_id", null);
    }

    const { data: node } = await query.maybeSingle();
    
    if (!node) return null; // パスが存在しない
    if (isLast) return node; // 目的のノード発見
    currentParentId = node.id;
  }
  return null;
}

// ファイル作成（パス対応）
export async function createFile(path: string, content: string = "") {
  const supabase = await createClient();
  const project = await getProject(supabase);
  
  // 親フォルダを確保（なければ作成）
  const parentId = await ensureParentFolders(supabase, project.id, path);
  const fileName = path.split("/").pop()!;

  // 同名ファイルチェック
  let query = supabase
    .from("nodes")
    .select("id")
    .eq("project_id", project.id)
    .eq("name", fileName)
    .eq("type", "file");
    
  if (parentId) {
    query = query.eq("parent_id", parentId);
  } else {
    query = query.is("parent_id", null);
  }
  
  const { data: existing } = await query.maybeSingle();

  if (existing) {
    throw new Error(`File '${path}' already exists. Use update_file instead.`);
  }

  // ノード作成
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .insert({
      project_id: project.id,
      type: "file",
      name: fileName,
      parent_id: parentId,
    })
    .select()
    .single();

  if (nodeError) throw new Error(`Failed to create file node: ${nodeError.message}`);

  // コンテンツ作成
  const { error: contentError } = await supabase
    .from("file_contents")
    .insert({
      node_id: node.id,
      text: content,
    });

  if (contentError) throw new Error(`Failed to create file content: ${contentError.message}`);

  return { success: true, fileName: path, nodeId: node.id, action: "created" };
}

// ファイル更新（パス対応）
export async function updateFile(path: string, content: string) {
  const supabase = await createClient();
  const project = await getProject(supabase);

  const node = await findNodeByPath(supabase, project.id, path);
  if (!node || node.type !== "file") throw new Error(`File '${path}' not found.`);

  const { error: updateError } = await supabase
    .from("file_contents")
    .update({ text: content })
    .eq("node_id", node.id);

  if (updateError) throw new Error(`Failed to update file content: ${updateError.message}`);

  return { success: true, fileName: path, nodeId: node.id, action: "updated" };
}

// ファイル削除（パス対応）
export async function deleteFile(path: string) {
  const supabase = await createClient();
  const project = await getProject(supabase);

  const node = await findNodeByPath(supabase, project.id, path);
  if (!node) throw new Error(`Node '${path}' not found.`);

  const { error } = await supabase
    .from("nodes")
    .delete()
    .eq("id", node.id);

  if (error) throw new Error(`Failed to delete node: ${error.message}`);

  return { success: true, fileName: path, action: "deleted" };
}

// フォルダ作成（明示的）
export async function createFolder(path: string) {
  const supabase = await createClient();
  const project = await getProject(supabase);
  
  // ensureParentFolders は最後の要素の親までを作るので、
  // path自体も含めて作りたい場合は少し工夫が必要だが、
  // ensureParentFoldersの実装を見ると、パスの親フォルダ群を作るもの。
  // ここでは「指定パスそのもの」を作りたい。
  
  // 実は ensureParentFolders は「パスの最後の要素（ファイル名想定）」の親までを作る。
  // フォルダ作成の場合は「パス全体」をフォルダとして作りたい。
  // なので、ダミーのファイル名をつけて ensureParentFolders を呼ぶ裏技が使えるが、
  // 真面目に実装する。
  
  const parentId = await ensureParentFolders(supabase, project.id, path + "/dummy"); // ダミーをつけて親（＝作りたいフォルダ）を作らせる
  
  return { success: true, folderName: path, action: "created" };
}

// ファイル一覧（パス付きで返す）
export async function listFiles() {
  const supabase = await createClient();
  const project = await getProject(supabase);

  const { data: nodes } = await supabase
    .from("nodes")
    .select("id, name, type, parent_id")
    .eq("project_id", project.id);

  if (!nodes) return [];

  // 親IDからパスを構築する
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const getPath = (node: any): string => {
    if (!node.parent_id) return node.name;
    const parent = nodeMap.get(node.parent_id);
    return parent ? `${getPath(parent)}/${node.name}` : node.name;
  };

  return nodes.map(n => ({
    ...n,
    path: getPath(n)
  })).sort((a, b) => a.path.localeCompare(b.path));
}

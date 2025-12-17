import { createClient } from "@/lib/supabase/server";

// ヘルパー: 現在のユーザーのプロジェクトIDを取得
async function getProject(supabase: any, projectId?: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  // 明示的な projectId が指定されている場合はそれを優先
  if (projectId) {
    const { data: project, error } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();

    if (error || !project) throw new Error("Project not found");
    return project;
  }

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
export async function createFile(path: string, content: string = "", projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);
  
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
export async function updateFile(path: string, content: string, projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);

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
export async function deleteFile(path: string, projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);

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
export async function createFolder(path: string, projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);
  
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
export async function listFiles(projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);

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

// ファイル読み取り
export async function readFile(path: string, projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);

  const node = await findNodeByPath(supabase, project.id, path);
  if (!node) throw new Error(`File '${path}' not found.`);
  if (node.type !== "file") throw new Error(`'${path}' is not a file.`);

  const { data: content } = await supabase
    .from("file_contents")
    .select("text")
    .eq("node_id", node.id)
    .single();

  return {
    path,
    content: content?.text || "",
  };
}

// ディレクトリ一覧
export async function listDirectory(path: string, projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);

  let parentId: string | null = null;

  // パスが空でない場合、そのディレクトリを探す
  if (path && path !== "" && path !== "/") {
    const node = await findNodeByPath(supabase, project.id, path);
    if (!node) throw new Error(`Directory '${path}' not found.`);
    if (node.type !== "folder") throw new Error(`'${path}' is not a directory.`);
    parentId = node.id;
  }

  // 子ノードを取得
  let query = supabase
    .from("nodes")
    .select("id, name, type")
    .eq("project_id", project.id);

  if (parentId) {
    query = query.eq("parent_id", parentId);
  } else {
    query = query.is("parent_id", null);
  }

  const { data: children } = await query;

  return {
    path: path || "/",
    entries: (children || []).map(c => ({
      name: c.name,
      type: c.type,
    })).sort((a, b) => {
      // フォルダを先に、その後ファイルを名前順で
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    }),
  };
}

// Grep検索（ファイル内容検索）
export async function grep(pattern: string, searchPath?: string, projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);

  // 全ファイルの内容を取得
  const allFiles = await listFiles(project.id);
  const fileNodes = allFiles.filter(f => f.type === "file");

  // パスフィルタリング
  const filteredFiles = searchPath 
    ? fileNodes.filter(f => f.path.startsWith(searchPath))
    : fileNodes;

  const results: Array<{
    path: string;
    lineNumber: number;
    line: string;
  }> = [];

  // 各ファイルで検索
  for (const file of filteredFiles) {
    const { data: content } = await supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", file.id)
      .single();

    if (!content?.text) continue;

    const lines = content.text.split("\n");
    const regex = new RegExp(pattern, "gi");

    lines.forEach((line: string, index: number) => {
      if (regex.test(line)) {
        results.push({
          path: file.path,
          lineNumber: index + 1,
          line: line.trim(),
        });
      }
      regex.lastIndex = 0; // リセット
    });
  }

  return {
    pattern,
    matchCount: results.length,
    results: results.slice(0, 50), // 最大50件
  };
}

// ファイル名検索（あいまい検索）
export async function fileSearch(query: string, projectId?: string) {
  const allFiles = await listFiles(projectId);
  
  const queryLower = query.toLowerCase();
  const matches = allFiles.filter(f => 
    f.name.toLowerCase().includes(queryLower) ||
    f.path.toLowerCase().includes(queryLower)
  );

  return {
    query,
    results: matches.map(f => ({
      path: f.path,
      type: f.type,
    })).slice(0, 20), // 最大20件
  };
}

// ファイル部分編集（検索と置換）
export async function editFile(path: string, search: string, replace: string, projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);

  const node = await findNodeByPath(supabase, project.id, path);
  if (!node || node.type !== "file") throw new Error(`File '${path}' not found.`);

  // 現在の内容を取得
  const { data: contentData } = await supabase
    .from("file_contents")
    .select("text")
    .eq("node_id", node.id)
    .single();

  if (!contentData) throw new Error(`File content not found for '${path}'.`);

  const currentContent = contentData.text || "";
  
  // 検索文字列が存在するか確認
  if (!currentContent.includes(search)) {
    throw new Error(`Search string not found in '${path}'.`);
  }

  // 置換実行
  const newContent = currentContent.replace(search, replace);

  // 更新
  const { error } = await supabase
    .from("file_contents")
    .update({ text: newContent })
    .eq("node_id", node.id);

  if (error) throw new Error(`Failed to update file: ${error.message}`);

  return {
    success: true,
    path,
    action: "edited",
    replacements: 1,
  };
}

// コードベース検索（簡易セマンティック検索）
export async function codebaseSearch(query: string, filePattern?: string, projectId?: string) {
  const supabase = await createClient();
  const project = await getProject(supabase, projectId);

  const allFiles = await listFiles(project.id);
  let fileNodes = allFiles.filter(f => f.type === "file");

  // ファイルパターンでフィルタリング
  if (filePattern) {
    const pattern = filePattern.replace("*", ".*");
    const regex = new RegExp(pattern);
    fileNodes = fileNodes.filter(f => regex.test(f.path));
  }

  const results: Array<{
    path: string;
    relevantSnippet: string;
    score: number;
  }> = [];

  const queryTerms = query.toLowerCase().split(/\s+/);

  for (const file of fileNodes) {
    const { data: content } = await supabase
      .from("file_contents")
      .select("text")
      .eq("node_id", file.id)
      .single();

    if (!content?.text) continue;

    const contentLower = content.text.toLowerCase();
    
    // スコア計算（単純なキーワードマッチング）
    let score = 0;
    for (const term of queryTerms) {
      const matches = (contentLower.match(new RegExp(term, "g")) || []).length;
      score += matches;
    }

    if (score > 0) {
      // 関連するスニペットを抽出
      const lines = content.text.split("\n");
      let bestSnippet = "";
      let bestLineScore = 0;

      for (let i = 0; i < lines.length; i++) {
        const lineLower = lines[i].toLowerCase();
        let lineScore = 0;
        for (const term of queryTerms) {
          if (lineLower.includes(term)) lineScore++;
        }
        if (lineScore > bestLineScore) {
          bestLineScore = lineScore;
          // 前後2行を含める
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);
          bestSnippet = lines.slice(start, end).join("\n");
        }
      }

      results.push({
        path: file.path,
        relevantSnippet: bestSnippet.slice(0, 500),
        score,
      });
    }
  }

  // スコア順でソート
  results.sort((a, b) => b.score - a.score);

  return {
    query,
    resultCount: results.length,
    results: results.slice(0, 10), // 最大10件
  };
}

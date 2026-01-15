import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppLayout from "./AppLayout";

type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  role: string;
};

type Node = {
  id: string;
  project_id: string;
  parent_id: string | null;
  type: "file" | "folder";
  name: string;
  created_at: string;
};

type Props = {
  searchParamsPromise: Promise<{ workspace?: string }>;
};

export default async function AppContent({ searchParamsPromise }: Props) {
  const searchParams = await searchParamsPromise;
  const workspaceId = searchParams.workspace;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // ユーザーが所属する全てのワークスペースを取得
  const { data: membershipData } = await supabase
    .from("workspace_members")
    .select(`
      role,
      workspace:workspaces (
        id,
        name,
        owner_id,
        created_at
      )
    `)
    .eq("user_id", user.id);

  // ワークスペース一覧を整形
  const workspaces: Workspace[] = (membershipData || [])
    .filter((m: any) => m.workspace)
    .map((m: any) => ({
      ...m.workspace,
      role: m.role,
    }));

  // URLで指定されたワークスペースを選択、なければ最初のワークスペース
  let currentWorkspace: Workspace | null = null;
  
  if (workspaceId) {
    currentWorkspace = workspaces.find(w => w.id === workspaceId) || null;
  }
  
  // 指定されたワークスペースがない場合は最初のものを使用
  if (!currentWorkspace) {
    currentWorkspace = workspaces[0] || null;
  }

  if (!currentWorkspace) {
    // デフォルトワークスペースを作成
    const { data: newWorkspace, error: wsError } = await supabase
      .from("workspaces")
      .insert({
        name: `${user.email?.split("@")[0] || "My"}'s Workspace`,
        owner_id: user.id,
      })
      .select("*")
      .single();

    if (wsError) {
      console.error("Error creating workspace:", wsError);
      return <div>Error creating workspace: {wsError.message}</div>;
    }

    // ownerをメンバーに追加
    await supabase.from("workspace_members").insert({
      workspace_id: newWorkspace!.id,
      user_id: user.id,
      role: "owner",
    });

    const createdWorkspace: Workspace = {
      ...newWorkspace!,
      role: "owner",
    };
    currentWorkspace = createdWorkspace;
    workspaces.push(createdWorkspace);
  }

  if (!currentWorkspace) {
    return <div>Error: no workspace available</div>;
  }
  const ensuredWorkspace: Workspace = currentWorkspace;

  // 現在のワークスペースのプロジェクトを取得 or 作成
  // 複数存在しても最新を使う。maybeSingleだと複数件でエラーになり、
  // 毎回新規プロジェクトが作られてしまうため。
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, created_at")
    .eq("workspace_id", ensuredWorkspace.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (projectsError) {
    console.error("Error fetching projects:", projectsError);
    return <div>Error fetching project: {projectsError.message}</div>;
  }

  let projectId = projects?.[0]?.id;

  if (!projectId) {
    const { data: newProject, error: projError } = await supabase
      .from("projects")
      .insert({
        name: "Default Project",
        workspace_id: ensuredWorkspace.id,
      })
      .select("*")
      .single();

    if (projError) {
      console.error("Error creating project:", projError);
      return <div>Error creating project: {projError.message}</div>;
    }

    projectId = newProject!.id;

    // サンプルファイル1個作る
    const { data: node, error: nodeError } = await supabase
      .from("nodes")
      .insert({
        project_id: projectId,
        parent_id: null,
        type: "file",
        name: "Welcome.md",
      })
      .select("*")
      .single();

    if (nodeError) {
      console.error("Error creating node:", nodeError);
      return <div>Error creating node: {nodeError.message}</div>;
    }

    await supabase.from("file_contents").insert({
      node_id: node!.id,
      text: `# Welcome to ${ensuredWorkspace.name}! 👋\n\nこれはサンプルファイルです。\n\n好きに編集してください！`,
    });
  }

  // Pre-fetch nodes for faster initial load
  const { data: initialNodes } = await supabase
    .from("nodes")
    .select("*")
    .eq("project_id", projectId!)
    .order("parent_id", { ascending: true, nullsFirst: true })
    .order("type", { ascending: false })
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(1000);

  return (
    <AppLayout
      projectId={projectId!}
      workspaces={workspaces}
      currentWorkspace={ensuredWorkspace}
      userEmail={user.email || ""}
      initialNodes={(initialNodes as Node[]) || []}
    />
  );
}

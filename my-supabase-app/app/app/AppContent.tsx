import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppLayout from "./AppLayout";

export default async function AppContent() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // ユーザーのデフォルトworkspaceを取得 or 作成
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();

  let workspaceId = workspace?.id;

  if (!workspaceId) {
    // なければ作る
    const { data: newWorkspace, error: wsError } = await supabase
      .from("workspaces")
      .insert({
        name: "My Workspace",
        owner_id: user.id,
      })
      .select("*")
      .single();

    if (wsError) {
      console.error("Error creating workspace:", wsError);
      return <div>Error creating workspace: {wsError.message}</div>;
    }

    workspaceId = newWorkspace!.id;

    // ownerをメンバーに追加
    await supabase.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      role: "owner",
    });
  }

  // プロジェクトも同様に1つデフォルト作る
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  let projectId = project?.id;

  if (!projectId) {
    const { data: newProject, error: projError } = await supabase
      .from("projects")
      .insert({
        name: "First Project",
        workspace_id: workspaceId,
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
        name: "main.md",
      })
      .select("*")
      .single();

    if (nodeError) {
      console.error("Error creating node:", nodeError);
      return <div>Error creating node: {nodeError.message}</div>;
    }

    await supabase.from("file_contents").insert({
      node_id: node!.id,
      text: "# はじめまして\n\nこれはサンプルファイルです。\n\n好きに編集してください！",
    });
  }

  // この projectId を渡して、クライアント側でツリー＆エディタを表示させる
  return <AppLayout projectId={projectId!} />;
}


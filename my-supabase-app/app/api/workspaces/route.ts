import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 新規ワークスペース作成
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, isTeam } = await req.json();

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    // ワークスペース作成
    const { data: workspace, error: wsError } = await supabase
      .from("workspaces")
      .insert({
        name: name.trim(),
        owner_id: user.id,
      })
      .select("*")
      .single();

    if (wsError) throw wsError;

    // オーナーをメンバーに追加
    const { error: memberError } = await supabase
      .from("workspace_members")
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: "owner",
      });

    if (memberError) throw memberError;

    // デフォルトプロジェクト作成
    const { data: project, error: projError } = await supabase
      .from("projects")
      .insert({
        name: "Default Project",
        workspace_id: workspace.id,
      })
      .select("*")
      .single();

    if (projError) throw projError;

    // ウェルカムファイル作成
    const { data: node, error: nodeError } = await supabase
      .from("nodes")
      .insert({
        project_id: project.id,
        parent_id: null,
        type: "file",
        name: "Welcome.md",
      })
      .select("*")
      .single();

    if (nodeError) throw nodeError;

    await supabase.from("file_contents").insert({
      node_id: node.id,
      text: `# Welcome to ${workspace.name}! 👋\n\nこのワークスペースへようこそ！\n\n新しいファイルを作成して始めましょう。`,
    });

    return NextResponse.json({ workspace, project });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ワークスペース名変更
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId, name } = await req.json();

  if (!workspaceId || !name || typeof name !== "string") {
    return NextResponse.json({ error: "workspaceId and name are required" }, { status: 400 });
  }

  try {
    // Check if user is owner or admin
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    // First check if workspace exists and user is owner
    const { data: existingWorkspace } = await supabase
      .from("workspaces")
      .select("id, owner_id")
      .eq("id", workspaceId)
      .maybeSingle();

    if (!existingWorkspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Update workspace name (include owner_id condition for RLS)
    const { error: updateError, count } = await supabase
      .from("workspaces")
      .update({ name: name.trim() })
      .eq("id", workspaceId)
      .eq("owner_id", existingWorkspace.owner_id);

    if (updateError) throw updateError;

    // Return success with updated name
    return NextResponse.json({
      workspace: {
        id: workspaceId,
        name: name.trim(),
        owner_id: existingWorkspace.owner_id
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ワークスペース削除
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    // Check if user is owner
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("owner_id")
      .eq("id", workspaceId)
      .single();

    if (!workspace || workspace.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the owner can delete the workspace" }, { status: 403 });
    }

    // Delete workspace (cascade will handle related data)
    const { error } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", workspaceId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ワークスペース一覧取得
export async function GET() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: memberships, error } = await supabase
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

    if (error) throw error;

    const workspaces = (memberships || [])
      .filter((m: any) => m.workspace)
      .map((m: any) => ({
        ...m.workspace,
        role: m.role,
      }));

    return NextResponse.json({ workspaces });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}





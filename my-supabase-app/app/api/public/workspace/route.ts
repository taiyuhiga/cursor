import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Node = {
  id: string;
  name: string;
  type: "file" | "folder";
  parent_id: string | null;
  created_at: string;
};

// GET: Fetch public workspace info and file tree
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Get workspace info
  const { data: workspace, error: workspaceError } = await supabase
    .from("projects")
    .select("id, name, is_public, created_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceError || !workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Check user authentication
  const { data: { user } } = await supabase.auth.getUser();
  const isAuthenticated = !!user;

  // Check if workspace is public
  if (!workspace.is_public) {
    if (!user) {
      return NextResponse.json({ error: "This workspace is not public" }, { status: 403 });
    }
    // If authenticated, check if user has access to this workspace
    const { data: membership } = await supabase
      .from("project_members")
      .select("id")
      .eq("project_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // User has full access - redirect to app
    return NextResponse.json({ redirectTo: `/app?workspace=${workspaceId}` });
  }

  // Get all nodes in the workspace
  const { data: nodes, error: nodesError } = await supabase
    .from("nodes")
    .select("id, name, type, parent_id, created_at")
    .eq("project_id", workspaceId)
    .order("type", { ascending: false }) // folders first
    .order("name", { ascending: true });

  if (nodesError) {
    return NextResponse.json({ error: "Failed to fetch files" }, { status: 500 });
  }

  return NextResponse.json({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      isPublic: workspace.is_public,
      createdAt: workspace.created_at,
    },
    nodes: nodes || [],
    isAuthenticated,
  });
}

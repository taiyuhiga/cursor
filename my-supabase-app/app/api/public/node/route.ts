import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildStoragePath, buildLegacyStoragePath } from "@/lib/storage/path";

type NodeInfo = {
  id: string;
  name: string;
  type: "file" | "folder";
  project_id: string;
  parent_id: string | null;
  is_public: boolean;
  public_access_role: "viewer" | "editor" | null;
  created_at: string;
};

function extractStoragePath(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/storage:\s*([^\s]+)/);
  if (!match) return null;
  return match[1].replace(/^["']|["']$/g, "");
}

function getCandidatePaths(node: { project_id: string; id: string; name: string }, text: string) {
  const candidates: string[] = [];
  const extractedPath = extractStoragePath(text);
  if (extractedPath) {
    candidates.push(extractedPath);
  }
  candidates.push(buildStoragePath(node.project_id, node.id));
  candidates.push(buildLegacyStoragePath(node.project_id, node.id, node.name));
  return Array.from(new Set(candidates));
}

// GET: Fetch public node info and content
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const nodeId = searchParams.get("nodeId");

  if (!nodeId) {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const canUseAdmin = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const adminClient = canUseAdmin ? createAdminClient() : null;
  const storageClient = adminClient || supabase;

  // Check user authentication first
  const { data: { user } } = await supabase.auth.getUser();
  const isAuthenticated = !!user;

  // Get node info using admin client to bypass RLS (to check if node exists at all)
  let node: NodeInfo | null = null;
  const queryClient = adminClient || supabase;

  // First try with public_access_role column
  const { data: nodeWithRole, error: errorWithRole } = await queryClient
    .from("nodes")
    .select("id, name, type, project_id, parent_id, is_public, public_access_role, created_at")
    .eq("id", nodeId)
    .maybeSingle();

  if (!errorWithRole && nodeWithRole) {
    node = nodeWithRole as NodeInfo;
  } else {
    // Fallback: query without public_access_role (column may not exist)
    const { data: nodeWithoutRole, error: errorWithoutRole } = await queryClient
      .from("nodes")
      .select("id, name, type, project_id, parent_id, is_public, created_at")
      .eq("id", nodeId)
      .maybeSingle();

    if (!errorWithoutRole && nodeWithoutRole) {
      node = { ...nodeWithoutRole, public_access_role: "viewer" } as NodeInfo;
    }
  }

  // Node truly doesn't exist
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  // Node exists but is not public - check access
  if (!node.is_public) {
    if (!user) {
      // Not logged in - redirect to login
      return NextResponse.json({
        error: "このコンテンツを表示するにはログインが必要です",
        requiresAuth: true
      }, { status: 403 });
    }

    // Check if user has access via workspace membership
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", node.project_id)
      .eq("user_id", user.id)
      .maybeSingle();

    // Check if user has access via node_shares (case-insensitive email match)
    // Use admin client to bypass RLS for checking share access
    const userEmail = user.email?.toLowerCase() || "";
    const { data: share } = await queryClient
      .from("node_shares")
      .select("id, role")
      .eq("node_id", nodeId)
      .eq("shared_with_email", userEmail)
      .maybeSingle();

    if (!membership && !share) {
      return NextResponse.json({
        error: "アクセス権がありません",
        isAuthenticated: true
      }, { status: 403 });
    }

    // User has access - redirect to app if workspace member
    if (membership) {
      return NextResponse.json({ redirectTo: `/app?open=${nodeId}` });
    }

    // User has shared access - continue to show content
  }

  // Get file content if it's a file
  // Use admin client to bypass RLS for public/shared files
  let content: string | null = null;
  let signedUrl: string | null = null;
  const dbClient = adminClient || supabase;

  if (node.type === "file") {
    const { data: fileContent } = await dbClient
      .from("file_contents")
      .select("text")
      .eq("node_id", nodeId)
      .maybeSingle();

    const text = fileContent?.text || "";

    // Check if it's a storage reference
    if (text.startsWith("storage:") || text.trim() === "") {
      // Get signed URL for the file
      const candidates = getCandidatePaths(node, text);

      for (const candidate of candidates) {
        const { data, error } = await storageClient.storage
          .from("files")
          .createSignedUrl(candidate, 3600); // 1 hour expiry

        if (!error && data?.signedUrl) {
          signedUrl = data.signedUrl;
          break;
        }
      }

      // Try resolving from list if candidates didn't work
      if (!signedUrl) {
        const prefix = `${node.project_id}/${node.id}`;
        const { data: listData } = await storageClient.storage
          .from("files")
          .list(prefix);

        if (listData && listData.length > 0) {
          const blobEntry = listData.find((entry: any) => entry?.name === "blob");
          const targetEntry = blobEntry || listData[0];
          if (targetEntry?.name) {
            const path = `${prefix}/${targetEntry.name}`;
            const { data, error } = await storageClient.storage
              .from("files")
              .createSignedUrl(path, 3600);
            if (!error && data?.signedUrl) {
              signedUrl = data.signedUrl;
            }
          }
        }
      }
    } else {
      // Text content
      content = text;
    }
  }

  // Build breadcrumb path
  const pathSegments: string[] = [node.name];
  let currentParentId = node.parent_id;

  while (currentParentId) {
    const { data: parentNode } = await supabase
      .from("nodes")
      .select("name, parent_id")
      .eq("id", currentParentId)
      .maybeSingle();

    if (!parentNode) break;
    pathSegments.unshift(parentNode.name);
    currentParentId = parentNode.parent_id;
  }

  return NextResponse.json({
    node: {
      id: node.id,
      name: node.name,
      type: node.type,
      isPublic: node.is_public,
      publicAccessRole: node.public_access_role || "viewer",
      createdAt: node.created_at,
    },
    path: pathSegments.join("/"),
    content,
    signedUrl,
    isAuthenticated,
  });
}

// POST: Save content for public node (requires authentication and editor access)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nodeId, content } = body;

  if (!nodeId) {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  if (content === undefined) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const canUseAdmin = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const adminClient = canUseAdmin ? createAdminClient() : null;
  const queryClient = adminClient || supabase;

  // Check user authentication
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // Get node info
  const { data: node, error: nodeError } = await queryClient
    .from("nodes")
    .select("id, name, type, project_id, is_public, public_access_role")
    .eq("id", nodeId)
    .maybeSingle();

  if (nodeError || !node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  // Check if user has edit access
  let canEdit = false;

  // Check if public with editor role
  if (node.is_public && node.public_access_role === "editor") {
    canEdit = true;
  }

  // Check workspace membership
  if (!canEdit) {
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("id, role")
      .eq("workspace_id", node.project_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membership) {
      canEdit = true;
    }
  }

  // Check node_shares
  if (!canEdit) {
    const userEmail = user.email?.toLowerCase() || "";
    const { data: share } = await queryClient
      .from("node_shares")
      .select("id, role")
      .eq("node_id", nodeId)
      .eq("shared_with_email", userEmail)
      .maybeSingle();

    if (share && share.role === "editor") {
      canEdit = true;
    }
  }

  if (!canEdit) {
    return NextResponse.json({ error: "編集権限がありません" }, { status: 403 });
  }

  // Save content
  const dbClient = adminClient || supabase;
  const { error: updateError } = await dbClient
    .from("file_contents")
    .upsert({
      node_id: nodeId,
      text: content,
    }, {
      onConflict: "node_id",
    });

  if (updateError) {
    console.error("Failed to save content:", updateError);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

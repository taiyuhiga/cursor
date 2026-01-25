import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const body = await req.json();
  const { action, nodeId, email, role, isPublic, shareId } = body;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    switch (action) {
      case "invite": {
        if (!nodeId || !email) {
          return NextResponse.json({ error: "nodeId and email are required" }, { status: 400 });
        }

        // Check if user already has access
        const { data: existingShare, error: checkError } = await supabase
          .from("node_shares")
          .select("id")
          .eq("node_id", nodeId)
          .eq("shared_with_email", email.toLowerCase())
          .single();

        // If error is not "no rows", it's a real error (like table doesn't exist)
        if (checkError && checkError.code !== "PGRST116") {
          console.error("Check existing share error:", checkError);
          return NextResponse.json({
            error: checkError.message || "Database error",
            code: checkError.code,
            hint: checkError.hint,
          }, { status: 500 });
        }

        if (existingShare) {
          return NextResponse.json({ error: "このユーザーは既にアクセス権を持っています" }, { status: 400 });
        }

        // Look up user by email in profiles
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, email, display_name")
          .eq("email", email.toLowerCase())
          .single();

        // Create share record
        const { data: share, error: insertError } = await supabase
          .from("node_shares")
          .insert({
            node_id: nodeId,
            shared_with_email: email.toLowerCase(),
            shared_with_user_id: profile?.id || null,
            role: role || "viewer",
            created_by: user.id,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Insert error:", insertError);
          return NextResponse.json({
            error: insertError.message || "Failed to create share",
            code: insertError.code,
            details: insertError.details,
            hint: insertError.hint,
          }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          share: {
            id: share.id,
            email: share.shared_with_email,
            role: share.role,
            displayName: profile?.display_name || share.shared_with_email.split("@")[0],
            userId: share.shared_with_user_id,
          },
        });
      }

      case "remove": {
        if (!shareId) {
          return NextResponse.json({ error: "shareId is required" }, { status: 400 });
        }

        const { error } = await supabase
          .from("node_shares")
          .delete()
          .eq("id", shareId)
          .eq("created_by", user.id);

        if (error) throw error;

        return NextResponse.json({ success: true });
      }

      case "update_role": {
        if (!shareId || !role) {
          return NextResponse.json({ error: "shareId and role are required" }, { status: 400 });
        }

        const { error } = await supabase
          .from("node_shares")
          .update({ role })
          .eq("id", shareId)
          .eq("created_by", user.id);

        if (error) throw error;

        return NextResponse.json({ success: true, role });
      }

      case "toggle_public": {
        if (!nodeId) {
          return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
        }

        // First update is_public
        const { error: publicError } = await supabase
          .from("nodes")
          .update({ is_public: isPublic })
          .eq("id", nodeId);

        if (publicError) throw publicError;

        // Try to update public_access_role if provided (column may not exist)
        if (body.publicAccessRole) {
          try {
            await supabase
              .from("nodes")
              .update({ public_access_role: body.publicAccessRole })
              .eq("id", nodeId);
          } catch {
            // Ignore error if column doesn't exist
          }
        }

        return NextResponse.json({ success: true, isPublic, publicAccessRole: body.publicAccessRole });
      }

      case "update_public_role": {
        if (!nodeId || !body.publicAccessRole) {
          return NextResponse.json({ error: "nodeId and publicAccessRole are required" }, { status: 400 });
        }

        // Try to update (column may not exist)
        try {
          const { error } = await supabase
            .from("nodes")
            .update({ public_access_role: body.publicAccessRole })
            .eq("id", nodeId);

          if (error) {
            // If column doesn't exist, just return success (it will default to viewer)
            return NextResponse.json({ success: true, publicAccessRole: body.publicAccessRole });
          }
        } catch {
          // Ignore error if column doesn't exist
        }

        return NextResponse.json({ success: true, publicAccessRole: body.publicAccessRole });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error: unknown) {
    // Handle Supabase error objects which have a different structure
    const supabaseError = error as { message?: string; code?: string; details?: string };
    const message = supabaseError?.message || (error instanceof Error ? error.message : "Unknown error");
    const details = supabaseError?.details || supabaseError?.code || "";
    console.error("Share API error:", { message, details, error });
    return NextResponse.json({ error: message, details }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const nodeId = searchParams.get("nodeId");

  if (!nodeId) {
    return NextResponse.json({ error: "Node ID is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get node info including is_public and public_access_role
  // Try with public_access_role first, fallback without it
  let node: { is_public: boolean; public_access_role?: string } | null = null;

  const { data: nodeWithRole, error: errorWithRole } = await supabase
    .from("nodes")
    .select("is_public, public_access_role")
    .eq("id", nodeId)
    .single();

  if (!errorWithRole && nodeWithRole) {
    node = nodeWithRole;
  } else {
    // Fallback: query without public_access_role (column may not exist)
    const { data: nodeWithoutRole } = await supabase
      .from("nodes")
      .select("is_public")
      .eq("id", nodeId)
      .single();

    if (nodeWithoutRole) {
      node = { ...nodeWithoutRole, public_access_role: "viewer" };
    }
  }

  // Get shared users for this node
  const { data: shares } = await supabase
    .from("node_shares")
    .select(`
      id,
      shared_with_email,
      shared_with_user_id,
      role,
      created_at
    `)
    .eq("node_id", nodeId)
    .order("created_at", { ascending: true });

  const sharesList = shares || [];
  const sharedUserIds = Array.from(
    new Set(
      sharesList
        .map((share) => share.shared_with_user_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  let profileNameById = new Map<string, string>();
  if (sharedUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", sharedUserIds);
    profileNameById = new Map(
      (profiles || [])
        .filter((profile) => Boolean(profile?.id))
        .map((profile) => [profile.id as string, profile.display_name || ""])
    );
  }

  const sharedUsers = sharesList.map((share) => {
    const fallbackName = share.shared_with_email.split("@")[0];
    const displayName = share.shared_with_user_id
      ? profileNameById.get(share.shared_with_user_id) || fallbackName
      : fallbackName;

    return {
      id: share.id,
      email: share.shared_with_email,
      displayName,
      role: share.role,
      userId: share.shared_with_user_id,
    };
  });

  return NextResponse.json({
    isPublic: node?.is_public ?? false,
    publicAccessRole: node?.public_access_role ?? "viewer",
    sharedUsers,
  });
}

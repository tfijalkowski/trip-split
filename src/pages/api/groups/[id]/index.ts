export const prerender = false;

import type { APIRoute } from "astro";

interface PatchGroupBody {
  is_locked?: unknown;
}

export const PATCH: APIRoute = async (context) => {
  const { user, supabase } = context.locals;

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const groupId = context.params.id;
  if (!groupId) {
    return new Response(JSON.stringify({ error: "Group ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: PatchGroupBody;
  try {
    body = (await context.request.json()) as PatchGroupBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body.is_locked !== "boolean") {
    return new Response(JSON.stringify({ error: "is_locked must be a boolean" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: groupRow, error: selectError } = await supabase
    .from("groups")
    .select("created_by")
    .eq("id", groupId)
    .single();

  if (selectError) {
    return new Response(JSON.stringify({ error: "Group not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (groupRow.created_by !== user.id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: updated, error: updateError } = await supabase
    .from("groups")
    .update({
      is_locked: body.is_locked,
      locked_at: body.is_locked ? new Date().toISOString() : null,
    })
    .eq("id", groupId)
    .select("is_locked, locked_at")
    .single();

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

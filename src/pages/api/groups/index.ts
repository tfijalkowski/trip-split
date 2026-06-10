export const prerender = false;

import type { APIRoute } from "astro";

interface CreateGroupBody {
  name?: unknown;
  description?: unknown;
}

export const POST: APIRoute = async (context) => {
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

  let body: CreateGroupBody;
  try {
    body = (await context.request.json()) as CreateGroupBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const name = (typeof body.name === "string" ? body.name : "").trim();
  const description = (typeof body.description === "string" ? body.description : "").trim() || null;

  if (!name) {
    return new Response(JSON.stringify({ error: "Group name is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const groupId = crypto.randomUUID();
  const { error: groupError } = await supabase
    .from("groups")
    .insert({ id: groupId, name, description, created_by: user.id });

  if (groupError) {
    return new Response(JSON.stringify({ error: groupError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error: memberError } = await supabase.from("group_members").insert({ group_id: groupId, user_id: user.id });

  if (memberError) {
    return new Response(JSON.stringify({ error: "Failed to add you as a member" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ id: groupId }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};

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

  const { data: groupId, error: createError } = (await supabase.rpc("create_group" as never, {
    p_name: name,
    p_description: description,
  })) as { data: string | null; error: import("@supabase/supabase-js").PostgrestError | null };

  if (createError || !groupId) {
    return new Response(JSON.stringify({ error: createError?.message ?? "Failed to create group" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ id: groupId }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};

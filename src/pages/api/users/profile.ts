export const prerender = false;

import type { APIRoute } from "astro";

interface UpdateProfileBody {
  display_name?: unknown;
}

export const PATCH: APIRoute = async (context) => {
  try {
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

    let body: UpdateProfileBody;
    try {
      body = (await context.request.json()) as UpdateProfileBody;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { display_name } = body;

    if (typeof display_name !== "string") {
      return new Response(JSON.stringify({ error: "display_name is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const trimmed = display_name.trim();

    if (trimmed.length === 0 || trimmed.length > 50) {
      return new Response(JSON.stringify({ error: "Display name must be between 1 and 50 characters." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: rows, error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed })
      .eq("id", user.id)
      .select("display_name");

    if (error) {
      return new Response(JSON.stringify({ error: "Failed to update display name" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!rows.length) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ display_name: trimmed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

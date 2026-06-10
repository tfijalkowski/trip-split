export const prerender = false;

import type { APIRoute } from "astro";

interface ExpenseParticipantBody {
  user_id: unknown;
  amount_owed: unknown;
}

interface CreateExpenseBody {
  description?: unknown;
  amount_grosze?: unknown;
  paid_by?: unknown;
  expense_date?: unknown;
  participants?: unknown;
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

  const groupId = context.params.id;
  if (!groupId) {
    return new Response(JSON.stringify({ error: "Group ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: CreateExpenseBody;
  try {
    body = (await context.request.json()) as CreateExpenseBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  const amount_grosze = body.amount_grosze;
  const paid_by = typeof body.paid_by === "string" ? body.paid_by : "";
  const expense_date = typeof body.expense_date === "string" ? body.expense_date : null;
  const rawParticipants = body.participants;

  if (!description) {
    return new Response(JSON.stringify({ error: "Description is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (description.length > 255) {
    return new Response(JSON.stringify({ error: "Description must be 255 characters or fewer" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof amount_grosze !== "number" || !Number.isInteger(amount_grosze) || amount_grosze <= 0) {
    return new Response(JSON.stringify({ error: "amount_grosze must be a positive integer" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(rawParticipants) || rawParticipants.length === 0) {
    return new Response(JSON.stringify({ error: "At least one participant is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const participants = rawParticipants as ExpenseParticipantBody[];

  const invalidAmount = participants.find(
    (p) => typeof p.amount_owed !== "number" || !Number.isInteger(p.amount_owed) || p.amount_owed < 0,
  );
  if (invalidAmount) {
    return new Response(
      JSON.stringify({ error: "Each participant amount_owed must be a non-negative integer (grosze)" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const participantSum = participants.reduce((sum, p) => {
    return sum + (typeof p.amount_owed === "number" ? p.amount_owed : 0);
  }, 0);

  if (participantSum !== amount_grosze) {
    return new Response(
      JSON.stringify({
        error: `Participant amounts sum (${participantSum}) must equal total amount (${amount_grosze})`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { data: allMembers } = await supabase.from("group_members").select("user_id").eq("group_id", groupId);

  const memberUserIds = new Set((allMembers ?? []).map((m: { user_id: string }) => m.user_id));

  if (!paid_by || !memberUserIds.has(paid_by)) {
    return new Response(JSON.stringify({ error: "paid_by must be a group member" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const invalidParticipant = participants.find((p) => typeof p.user_id !== "string" || !memberUserIds.has(p.user_id));
  if (invalidParticipant) {
    return new Response(JSON.stringify({ error: "All participants must be group members" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: expenseId, error: rpcError } = (await supabase.rpc("create_expense" as never, {
    p_group_id: groupId,
    p_description: description,
    p_amount: amount_grosze,
    p_paid_by: paid_by,
    p_expense_date: expense_date,
    p_participants: participants,
  })) as { data: string | null; error: import("@supabase/supabase-js").PostgrestError | null };

  if (rpcError || !expenseId) {
    return new Response(JSON.stringify({ error: rpcError?.message ?? "Failed to create expense" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ expense_id: expenseId }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};

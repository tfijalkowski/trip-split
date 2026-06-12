import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase.browser";
import type { ExpenseWithParticipants, MemberBalance, GroupMember } from "@/types";
import { Button } from "@/components/ui/button";
import { BalancePanel } from "./BalancePanel";
import { ExpenseTable } from "./ExpenseTable";
import { AddExpenseSheet } from "./AddExpenseSheet";
import { SettlementLockBanner } from "./SettlementLockBanner";

let _supabase: ReturnType<typeof createBrowserClient> | null = null;
function getClient() {
  return (_supabase ??= createBrowserClient());
}

interface Props {
  groupId: string;
  initialExpenses: ExpenseWithParticipants[];
  initialBalances: MemberBalance[];
  members: GroupMember[];
  currentUserId: string;
  isGroupLocked: boolean;
  lockedAt: string | null;
  isCreator: boolean;
  creatorName: string | null;
}

export default function GroupExpensesIsland({
  groupId,
  initialExpenses,
  initialBalances,
  members,
  currentUserId,
  isGroupLocked,
  lockedAt,
  isCreator,
  creatorName,
}: Props) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [balances, setBalances] = useState(initialBalances);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [groupLocked, setGroupLocked] = useState(isGroupLocked);
  const [groupLockedAt, setGroupLockedAt] = useState(lockedAt);

  const refetch = useCallback(async () => {
    const client = getClient();
    const [{ data: expenseRows }, { data: balanceRows }] = await Promise.all([
      client
        .from("expenses")
        .select("*, expense_participants(*)")
        .eq("group_id", groupId)
        .order("expense_date", { ascending: false }),
      client.from("member_balances").select("*").eq("group_id", groupId),
    ]);
    if (expenseRows) setExpenses(expenseRows as ExpenseWithParticipants[]);
    if (balanceRows) setBalances(balanceRows as MemberBalance[]);
  }, [groupId]);

  useEffect(() => {
    let mounted = true;
    const client = getClient();

    type Channel = ReturnType<typeof client.channel>;
    let expensesChannel: Channel | null = null;
    let groupChannel: Channel | null = null;

    void (async () => {
      // Realtime channels are stamped with the current access token at .subscribe() time
      // and the resulting realtime.subscription row's claims_role is fixed for the channel's
      // lifetime. Wait for the user JWT before subscribing or RLS will drop every event.
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData.session) client.realtime.setAuth(sessionData.session.access_token);
      if (!mounted) return;

      expensesChannel = client
        .channel(`expenses:${groupId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "expenses", filter: `group_id=eq.${groupId}` },
          (payload) => {
            console.log("[Realtime expenses]", payload.eventType);
            if (mounted) void refetch();
          },
        )
        .subscribe((status, err) => {
          if (err) console.error("[Realtime expenses] subscribe", status, err);
        });

      groupChannel = client
        .channel(`group:${groupId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` },
          (payload) => {
            console.log("[Realtime group]", payload.eventType);
            const newRow = payload.new as { is_locked: boolean; locked_at: string | null };
            setGroupLocked(newRow.is_locked);
            setGroupLockedAt(newRow.locked_at);
            if (newRow.is_locked && mounted) setSheetOpen(false);
          },
        )
        .subscribe((status, err) => {
          if (err) console.error("[Realtime group] subscribe", status, err);
        });
    })();

    return () => {
      mounted = false;
      if (expensesChannel) void client.removeChannel(expensesChannel);
      if (groupChannel) void client.removeChannel(groupChannel);
    };
  }, [groupId, refetch]);

  async function handleToggleLock() {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: !groupLocked }),
    });
    if (res.ok) {
      const data = (await res.json()) as { is_locked: boolean; locked_at: string | null };
      setGroupLocked(data.is_locked);
      setGroupLockedAt(data.locked_at ?? null);
    } else {
      console.error("[lock toggle] failed", res.status);
    }
  }

  return (
    <div className="space-y-4">
      {groupLocked && <SettlementLockBanner lockedAt={groupLockedAt} creatorName={creatorName} />}
      <BalancePanel balances={balances} members={members} />
      <div className="flex justify-end gap-2">
        {isCreator && (
          <Button variant="outline" onClick={handleToggleLock}>
            {groupLocked ? "Unlock settlement" : "Lock settlement"}
          </Button>
        )}
        <Button
          disabled={groupLocked}
          onClick={() => {
            setSheetOpen(true);
          }}
        >
          Add expense
        </Button>
      </div>
      <ExpenseTable expenses={expenses} members={members} />
      <AddExpenseSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        groupId={groupId}
        members={members}
        currentUserId={currentUserId}
        onSuccess={refetch}
      />
    </div>
  );
}

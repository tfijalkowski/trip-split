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

    const channel = client
      .channel(`expenses:${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter: `group_id=eq.${groupId}` },
        (payload) => {
          console.log("[Realtime event]", payload);
          if (mounted) void refetch();
        },
      )
      .subscribe((status, err) => {
        if (import.meta.env.DEV) console.log("[Realtime]", status, err ?? "");
        else if (err) console.error("[Realtime]", status, err);
      });

    const groupChannel = client
      .channel(`group:${groupId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "groups", filter: `id=eq.${groupId}` },
        (payload) => {
          const newLocked = payload.new.is_locked as boolean;
          const newLockedAt = payload.new.locked_at as string | null;
          setGroupLocked(newLocked);
          setGroupLockedAt(newLockedAt);
          if (newLocked && mounted) setSheetOpen(false);
        },
      )
      .subscribe((status, err) => {
        if (import.meta.env.DEV) console.log("[Realtime group]", status, err ?? "");
        else if (err) console.error("[Realtime group]", status, err);
      });

    return () => {
      mounted = false;
      void client.removeChannel(channel);
      void client.removeChannel(groupChannel);
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

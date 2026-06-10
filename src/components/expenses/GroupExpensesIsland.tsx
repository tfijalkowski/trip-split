import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase.browser";
import type { ExpenseWithParticipants, MemberBalance, GroupMember } from "@/types";
import { Button } from "@/components/ui/button";
import { BalancePanel } from "./BalancePanel";
import { ExpenseTable } from "./ExpenseTable";
import { AddExpenseSheet } from "./AddExpenseSheet";

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
}

export default function GroupExpensesIsland({
  groupId,
  initialExpenses,
  initialBalances,
  members,
  currentUserId,
}: Props) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [balances, setBalances] = useState(initialBalances);
  const [sheetOpen, setSheetOpen] = useState(false);

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
        () => {
          if (mounted) void refetch();
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      void client.removeChannel(channel);
    };
  }, [groupId, refetch]);

  return (
    <div className="space-y-4">
      <BalancePanel balances={balances} members={members} />
      <div className="flex justify-end">
        <Button
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

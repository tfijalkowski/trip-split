import type { ExpenseWithParticipants, GroupMember } from "@/types";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Props {
  expense: ExpenseWithParticipants | null;
  members: GroupMember[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ExpenseDetailSheet({ expense, members, open, onOpenChange }: Props) {
  const memberMap = new Map(members.map((m) => [m.user_id, m]));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {expense && (
          <>
            <SheetHeader>
              <SheetTitle className="text-white">{expense.description}</SheetTitle>
              <SheetDescription className="sr-only">Expense details</SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Date</span>
                <span className="text-white/80">{(expense.expense_date ?? expense.created_at).slice(0, 10)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Total amount</span>
                <span className="font-medium text-white">{(expense.amount / 100).toFixed(2)} PLN</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Paid by</span>
                <span className="text-white/80">
                  {(() => {
                    const m = memberMap.get(expense.paid_by);
                    return m?.display_name ?? m?.email ?? expense.paid_by;
                  })()}
                </span>
              </div>
              <div className="border-t border-white/10 pt-4">
                <p className="mb-3 text-xs font-semibold tracking-wide text-white/50 uppercase">Split</p>
                <div className="space-y-2">
                  {expense.expense_participants.map((p) => {
                    const m = memberMap.get(p.user_id);
                    return (
                      <div key={p.id} className="flex justify-between text-sm">
                        <span className="text-white/80">{m?.display_name ?? m?.email ?? p.user_id}</span>
                        <span className="text-white/60">{(p.amount_owed / 100).toFixed(2)} PLN</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

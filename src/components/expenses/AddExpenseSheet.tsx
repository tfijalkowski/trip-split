import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";
import type { GroupMember } from "@/types";

const baseSchema = z.object({
  description: z.string().min(1, "Description is required").max(255),
  amount: z.number().positive("Amount must be positive"),
  expense_date: z.string().optional(),
  paid_by: z.uuid(),
  split_mode: z.enum(["equal", "percentage", "custom"]),
});

type FormValues = z.infer<typeof baseSchema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
  members: GroupMember[];
  currentUserId: string;
  onSuccess: () => void;
}

export function AddExpenseSheet({ open, onOpenChange, groupId, members, currentUserId, onSuccess }: Props) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { split_mode: "equal", paid_by: currentUserId },
  });

  const splitMode = watch("split_mode");

  const [participantIds, setParticipantIds] = useState<Set<string>>(() => new Set(members.map((m) => m.user_id)));
  const [percentages, setPercentages] = useState<Record<string, string>>({});
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const toggleParticipant = (userId: string) => {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const onSubmit = async (data: FormValues) => {
    setServerError(null);

    const result = baseSchema.safeParse(data);
    if (!result.success) {
      setServerError(result.error.issues[0]?.message ?? "Validation error");
      return;
    }

    const selected = members.filter((m) => participantIds.has(m.user_id));
    if (selected.length === 0) {
      setServerError("At least one participant is required");
      return;
    }

    const totalGrosze = Math.round(data.amount * 100);
    let participants: { user_id: string; amount_owed: number }[] = [];

    if (data.split_mode === "equal") {
      const n = selected.length;
      const floor = Math.floor(totalGrosze / n);
      const remainder = totalGrosze - floor * n;
      participants = selected.map((m, i) => ({
        user_id: m.user_id,
        amount_owed: i === 0 ? floor + remainder : floor,
      }));
    } else if (data.split_mode === "percentage") {
      const pcts = selected.map((m) => {
        const v = parseFloat(percentages[m.user_id] ?? "0");
        return Number.isNaN(v) ? 0 : v;
      });
      const pctSum = pcts.reduce((a, b) => a + b, 0);
      if (Math.abs(pctSum - 100) > 0.01) {
        setServerError(`Percentages must sum to 100% (currently ${pctSum.toFixed(2)}%)`);
        return;
      }
      const rawAmounts = pcts.map((pct) => Math.floor((totalGrosze * pct) / 100));
      const rawSum = rawAmounts.reduce((a, b) => a + b, 0);
      const adjustment = totalGrosze - rawSum;
      participants = selected.map((m, i) => ({
        user_id: m.user_id,
        amount_owed: i === 0 ? rawAmounts[i] + adjustment : rawAmounts[i],
      }));
    } else {
      const amounts = selected.map((m) => {
        const v = parseFloat(customAmounts[m.user_id] ?? "0");
        return Math.round((Number.isNaN(v) ? 0 : v) * 100);
      });
      const amountSum = amounts.reduce((a, b) => a + b, 0);
      if (amountSum !== totalGrosze) {
        setServerError(
          `Custom amounts sum (${(amountSum / 100).toFixed(2)} PLN) must equal total (${(totalGrosze / 100).toFixed(2)} PLN)`,
        );
        return;
      }
      participants = selected.map((m, i) => ({ user_id: m.user_id, amount_owed: amounts[i] }));
    }

    try {
      const res = await fetch(`/api/groups/${groupId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: data.description,
          amount_grosze: totalGrosze,
          paid_by: data.paid_by,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          expense_date: data.expense_date || null,
          participants,
        }),
      });

      if (res.status === 423) {
        setServerError("Settlement was locked while you were filling this out");
        return;
      }

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setServerError(body.error ?? "Failed to create expense");
        return;
      }

      onSuccess();
      onOpenChange(false);
      reset();
      setParticipantIds(new Set(members.map((m) => m.user_id)));
      setPercentages({});
      setCustomAmounts({});
    } catch {
      setServerError("Network error");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add expense</SheetTitle>
          <SheetDescription>Fill in the details and choose how to split.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4 px-4 pb-4">
          <div>
            <label className="text-foreground/70 mb-1 block text-sm">Description</label>
            <input
              {...register("description", { required: "Description is required" })}
              className="border-border bg-background text-foreground w-full rounded border px-3 py-2 text-sm"
              placeholder="Dinner at restaurant"
            />
          </div>

          <div>
            <label className="text-foreground/70 mb-1 block text-sm">Amount (PLN)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              {...register("amount", { required: true, valueAsNumber: true, min: 0.01 })}
              className="border-border bg-background text-foreground w-full rounded border px-3 py-2 text-sm"
              placeholder="25.00"
            />
          </div>

          <div>
            <label className="text-foreground/70 mb-1 block text-sm">Date (optional)</label>
            <input
              type="date"
              {...register("expense_date")}
              className="border-border bg-background text-foreground w-full rounded border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-foreground/70 mb-1 block text-sm">Paid by</label>
            <select
              {...register("paid_by")}
              className="border-border bg-background text-foreground w-full rounded border px-3 py-2 text-sm"
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name ?? m.email}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-foreground/70 mb-1 block text-sm">Split</label>
            <select
              {...register("split_mode")}
              className="border-border bg-background text-foreground w-full rounded border px-3 py-2 text-sm"
            >
              <option value="equal">Equal</option>
              <option value="percentage">Percentage</option>
              <option value="custom">Custom amount</option>
            </select>
          </div>

          <div>
            <label className="text-foreground/70 mb-2 block text-sm">Participants</label>
            <div className="space-y-2">
              {members.map((m) => {
                const included = participantIds.has(m.user_id);
                return (
                  <div key={m.user_id} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => {
                        toggleParticipant(m.user_id);
                      }}
                      className="rounded"
                    />
                    <span className="text-foreground/80 flex-1 text-sm">{m.display_name ?? m.email}</span>
                    {splitMode === "percentage" && included && (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={percentages[m.user_id] ?? ""}
                        onChange={(e) => {
                          setPercentages((p) => ({ ...p, [m.user_id]: e.target.value }));
                        }}
                        className="border-border bg-background text-foreground w-20 rounded border px-2 py-1 text-sm"
                        placeholder="%"
                      />
                    )}
                    {splitMode === "custom" && included && (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customAmounts[m.user_id] ?? ""}
                        onChange={(e) => {
                          setCustomAmounts((p) => ({ ...p, [m.user_id]: e.target.value }));
                        }}
                        className="border-border bg-background text-foreground w-24 rounded border px-2 py-1 text-sm"
                        placeholder="PLN"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <ServerError message={serverError} />

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Adding…" : "Add expense"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

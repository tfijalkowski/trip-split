interface Props {
  lockedAt: string | null;
  creatorName: string | null;
}

export function SettlementLockBanner({ lockedAt, creatorName }: Props) {
  const name = creatorName ?? "the group creator";
  const dateStr = lockedAt ? ` on ${new Date(lockedAt).toISOString().slice(0, 10)}` : "";

  return (
    <div className="w-full rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
      Settlement locked by {name}
      {dateStr}
    </div>
  );
}

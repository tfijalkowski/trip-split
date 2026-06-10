import type { MemberBalance, GroupMember } from "@/types";

interface Props {
  balances: MemberBalance[];
  members: GroupMember[];
}

function formatPLN(grosze: number): string {
  const sign = grosze > 0 ? "+" : grosze < 0 ? "−" : "";
  return `${sign}${(Math.abs(grosze) / 100).toFixed(2)} PLN`;
}

export function BalancePanel({ balances, members }: Props) {
  const balanceMap = new Map(balances.map((b) => [b.user_id, b]));

  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
      <p className="mb-3 text-xs font-semibold tracking-wide text-white/50 uppercase">Balances</p>
      <ul className="flex flex-col gap-2">
        {members.map((m) => {
          const net = balanceMap.get(m.user_id)?.net_balance ?? 0;
          const label = m.display_name ?? m.email;
          const colorClass = net > 0 ? "text-green-400" : net < 0 ? "text-red-400" : "text-white/50";
          return (
            <li key={m.user_id} className="flex items-center justify-between text-sm">
              <span className="text-white/80">{label}</span>
              <span className={colorClass}>{formatPLN(net)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

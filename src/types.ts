export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string;
  is_locked: boolean;
  locked_at: string | null;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  display_name: string | null;
  email: string;
  created_at: string;
}

export interface Expense {
  id: string;
  group_id: string;
  description: string;
  amount: number;
  paid_by: string;
  expense_date: string | null;
  created_at: string;
}

export interface ExpenseParticipant {
  id: string;
  expense_id: string;
  user_id: string;
  amount_owed: number;
}

export type ExpenseWithParticipants = Expense & { expense_participants: ExpenseParticipant[] };

export interface MemberBalance {
  user_id: string;
  group_id: string;
  total_owed: number;
  total_paid: number;
  net_balance: number;
}

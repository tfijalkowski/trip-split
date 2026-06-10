export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string;
  is_locked: boolean;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
}

export interface GroupWithMembers extends Group {
  members: {
    user_id: string;
    profiles: {
      display_name: string | null;
      email: string;
    } | null;
  }[];
}

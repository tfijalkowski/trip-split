import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function makeAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInClient(email: string, password: string) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Sign-in failed for ${email}: ${error?.message}`);
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function createTestUser(admin: ReturnType<typeof makeAdmin>, email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "Test1234!",
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  return data.user.id;
}

async function createGroupWithMembers(admin: ReturnType<typeof makeAdmin>, createdBy: string, memberIds: string[]) {
  const { data: group, error: groupError } = await admin
    .from("groups")
    .insert({ name: "test-group", created_by: createdBy })
    .select("id")
    .single();
  if (groupError || !group) throw new Error(`group insert failed: ${groupError?.message}`);

  const { error: memberError } = await admin
    .from("group_members")
    .insert(memberIds.map((user_id) => ({ group_id: group.id, user_id })));
  if (memberError) throw new Error(`group_members insert failed: ${memberError?.message}`);

  return group.id as string;
}

async function deleteGroupAndUsers(admin: ReturnType<typeof makeAdmin>, groupId: string, userIds: string[]) {
  await admin.from("groups").delete().eq("id", groupId);
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

describe("member_balances — balance correctness", () => {
  // Scenario A: 1 000 grosze equal split (Alice pays, Alice + Bob each owe 500)
  describe("1 000 grosze equal split", () => {
    const admin = makeAdmin();
    let aliceId: string;
    let bobId: string;
    let groupId: string;
    let supabaseAsAlice: Awaited<ReturnType<typeof signInClient>>;

    const ALICE_EMAIL = `test-alice-balance-1000-${Date.now()}@test.local`;
    const BOB_EMAIL = `test-bob-balance-1000-${Date.now()}@test.local`;

    beforeAll(async () => {
      aliceId = await createTestUser(admin, ALICE_EMAIL);
      bobId = await createTestUser(admin, BOB_EMAIL);
      supabaseAsAlice = await signInClient(ALICE_EMAIL, "Test1234!");
      groupId = await createGroupWithMembers(admin, aliceId, [aliceId, bobId]);

      // Oracle: Alice pays 1 000 grosze, equal split → Alice owes 500, Bob owes 500
      const { error } = await supabaseAsAlice.rpc("create_expense", {
        p_group_id: groupId,
        p_description: "test expense",
        p_amount: 1000,
        p_paid_by: aliceId,
        p_participants: [
          { user_id: aliceId, amount_owed: 500 },
          { user_id: bobId, amount_owed: 500 },
        ],
      });
      if (error) throw new Error(`create_expense failed: ${error.message}`);
    });

    afterAll(async () => {
      await deleteGroupAndUsers(admin, groupId, [aliceId, bobId]);
    });

    it("zero-sum invariant: sum of all net_balances is 0", async () => {
      const { data, error } = await supabaseAsAlice
        .from("member_balances")
        .select("net_balance")
        .eq("group_id", groupId);
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      const sum = data!.reduce((acc, row) => acc + (row.net_balance as number), 0);
      expect(sum).toBe(0);
    });

    it("individual balance values match oracle formula (total_paid − total_owed)", async () => {
      const { data, error } = await supabaseAsAlice
        .from("member_balances")
        .select("user_id, net_balance")
        .eq("group_id", groupId);
      expect(error).toBeNull();
      const alice = data!.find((r) => r.user_id === aliceId);
      const bob = data!.find((r) => r.user_id === bobId);
      // Alice: paid 1000, owed 500 → net = +500
      // Bob:   paid 0,    owed 500 → net = −500
      expect(alice!.net_balance).toBe(500);
      expect(bob!.net_balance).toBe(-500);
    });
  });

  // Scenario B: 101 grosze equal split (prime → rounding gives first participant the extra grosze)
  describe("101 grosze rounding edge (prime total, 2 participants)", () => {
    const admin = makeAdmin();
    let aliceId: string;
    let bobId: string;
    let groupId: string;
    let supabaseAsAlice: Awaited<ReturnType<typeof signInClient>>;

    const ALICE_EMAIL = `test-alice-balance-101-${Date.now()}@test.local`;
    const BOB_EMAIL = `test-bob-balance-101-${Date.now()}@test.local`;

    beforeAll(async () => {
      aliceId = await createTestUser(admin, ALICE_EMAIL);
      bobId = await createTestUser(admin, BOB_EMAIL);
      supabaseAsAlice = await signInClient(ALICE_EMAIL, "Test1234!");
      groupId = await createGroupWithMembers(admin, aliceId, [aliceId, bobId]);

      // Oracle (AddExpenseSheet.tsx:73-80 rounding rule):
      //   floor = Math.floor(101 / 2) = 50
      //   remainder = 101 - 50*2 = 1
      //   first participant (Alice, i=0) → 50 + 1 = 51
      //   second participant (Bob,   i=1) → 50
      const { error } = await supabaseAsAlice.rpc("create_expense", {
        p_group_id: groupId,
        p_description: "rounding test expense",
        p_amount: 101,
        p_paid_by: aliceId,
        p_participants: [
          { user_id: aliceId, amount_owed: 51 },
          { user_id: bobId, amount_owed: 50 },
        ],
      });
      if (error) throw new Error(`create_expense failed: ${error.message}`);
    });

    afterAll(async () => {
      await deleteGroupAndUsers(admin, groupId, [aliceId, bobId]);
    });

    it("floor + remainder goes to first participant; sum remains 0", async () => {
      const { data, error } = await supabaseAsAlice
        .from("member_balances")
        .select("user_id, net_balance")
        .eq("group_id", groupId);
      expect(error).toBeNull();
      const alice = data!.find((r) => r.user_id === aliceId);
      const bob = data!.find((r) => r.user_id === bobId);
      // Alice: paid 101, owed 51 → net = +50
      // Bob:   paid 0,   owed 50 → net = −50
      expect(alice!.net_balance).toBe(50);
      expect(bob!.net_balance).toBe(-50);
      expect(alice!.net_balance + bob!.net_balance).toBe(0);
    });
  });
});

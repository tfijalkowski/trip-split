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

// ──────────────────────────────────────────────────────────────────────────────

describe("expenses + member_balances — non-member isolation", () => {
  const admin = makeAdmin();
  let aliceId: string;
  let charlieId: string;
  let groupId: string;
  let supabaseAsAlice: Awaited<ReturnType<typeof signInClient>>;
  let supabaseAsCharlie: Awaited<ReturnType<typeof signInClient>>;

  const ts = Date.now();
  const ALICE_EMAIL = `test-alice-rls-${ts}@test.local`;
  const CHARLIE_EMAIL = `test-charlie-rls-${ts}@test.local`;

  beforeAll(async () => {
    aliceId = await createTestUser(admin, ALICE_EMAIL);
    charlieId = await createTestUser(admin, CHARLIE_EMAIL);

    [supabaseAsAlice, supabaseAsCharlie] = await Promise.all([
      signInClient(ALICE_EMAIL, "Test1234!"),
      signInClient(CHARLIE_EMAIL, "Test1234!"),
    ]);

    // Create group and add Alice only — Charlie is intentionally absent
    const { data: group, error: groupError } = await admin
      .from("groups")
      .insert({ name: "rls-test-group", created_by: aliceId })
      .select("id")
      .single();
    if (groupError || !group) throw new Error(`group insert failed: ${groupError?.message}`);
    groupId = group.id as string;

    const { error: memberError } = await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: aliceId });
    if (memberError) throw new Error(`group_members insert failed: ${memberError?.message}`);

    // Insert one expense as Alice (1 000 grosze, Alice owes 1 000)
    const { error: expenseError } = await supabaseAsAlice.rpc("create_expense", {
      p_group_id: groupId,
      p_description: "rls isolation test expense",
      p_amount: 1000,
      p_paid_by: aliceId,
      p_participants: [{ user_id: aliceId, amount_owed: 1000 }],
    });
    if (expenseError) throw new Error(`create_expense failed: ${expenseError.message}`);
  });

  afterAll(async () => {
    // Delete group (cascades expenses, expense_participants, group_members)
    await admin.from("groups").delete().eq("id", groupId);
    // Delete test users
    await admin.auth.admin.deleteUser(aliceId);
    await admin.auth.admin.deleteUser(charlieId);
  });

  it("non-member sees 0 rows in expenses", async () => {
    const { data, error } = await supabaseAsCharlie
      .from("expenses")
      .select("*")
      .eq("group_id", groupId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("non-member sees 0 rows in member_balances", async () => {
    const { data, error } = await supabaseAsCharlie
      .from("member_balances")
      .select("*")
      .eq("group_id", groupId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("non-member sees 0 rows in groups table", async () => {
    const { data, error } = await supabaseAsCharlie
      .from("groups")
      .select("*")
      .eq("id", groupId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("member (Alice) sees the expense — proves group setup is valid, not vacuously empty", async () => {
    const { data, error } = await supabaseAsAlice
      .from("expenses")
      .select("*")
      .eq("group_id", groupId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

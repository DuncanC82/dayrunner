import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

/** Verify the caller's JWT and that they belong to the operator. Returns user id or throws a Response. */
export async function requireMember(req: Request, operatorId: string): Promise<string> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw json({ error: "missing auth" }, 401);
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: { user }, error } = await anon.auth.getUser();
  if (error || !user) throw json({ error: "invalid auth" }, 401);
  const { data } = await admin().from("memberships").select("role").eq("user_id", user.id).eq("operator_id", operatorId).maybeSingle();
  if (!data) throw json({ error: "not a member of this operator" }, 403);
  return user.id;
}

export async function audit(operatorId: string, actor: string, action: string, entity?: string, entityId?: string, detail?: unknown) {
  await admin().from("audit_log").insert({ operator_id: operatorId, actor, action, entity, entity_id: entityId, detail });
}

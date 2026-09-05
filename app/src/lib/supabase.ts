import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://tylttoheoazyvbuixrrk.supabase.co";
export const SUPABASE_ANON = "sb_publishable_YtPWHlhEtmjBi3dEt-xMIg_MeIitBSS";
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export async function callFn<T = any>(name: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON, Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${name} failed (${r.status})`);
  return j as T;
}

export const fnUrl = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;

export const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

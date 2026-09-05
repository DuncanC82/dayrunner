import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Operator = { id: string; name: string; timezone: string; voice: string; stop_order: string[]; settings: any };
type Ctx = { session: Session | null; operator: Operator | null; role: string | null; loading: boolean; refresh: () => Promise<void> };
const C = createContext<Ctx>({ session: null, operator: null, role: null, loading: true, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadOperator(s: Session | null) {
    if (!s) { setOperator(null); setRole(null); return; }
    const { data: m } = await supabase.from("memberships").select("operator_id, role").eq("user_id", s.user.id).limit(1).maybeSingle();
    if (!m) { setOperator(null); return; }
    const { data: op } = await supabase.from("operators").select("*").eq("id", m.operator_id).single();
    setOperator(op as Operator); setRole(m.role);
  }
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); await loadOperator(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => { setSession(s); await loadOperator(s); setLoading(false); });
    return () => sub.subscription.unsubscribe();
  }, []);
  return <C.Provider value={{ session, operator, role, loading, refresh: () => loadOperator(session) }}>{children}</C.Provider>;
}
export const useAuth = () => useContext(C);

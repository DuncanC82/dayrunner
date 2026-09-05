import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Auth({ mode }: { mode: "signin" | "signup" }) {
  const nav = useNavigate();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { operator_name: name } } });
        if (error) throw error;
        if (data.session) nav("/app"); else setMsg("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; nav("/app");
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function magic() { setBusy(true); setErr(null); const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } }); setBusy(false); if (error) setErr(error.message); else setMsg("Magic link sent. Check your email."); }

  return (
    <div className="land" style={{ maxWidth: 440 }}>
      <nav className="nav"><Link to="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>DayRunner</Link></nav>
      <div className="panel">
        <h2>{mode === "signup" ? "Create your workspace" : "Sign in"}</h2>
        <form onSubmit={submit}>
          {mode === "signup" && <><label>Operator name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Remarkables Day Tours" required /></>}
          <label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          {err && <div className="notice err">{err}</div>}{msg && <div className="notice">{msg}</div>}
          <div className="bar"><button disabled={busy}>{mode === "signup" ? "Create workspace" : "Sign in"}</button>{mode === "signin" && <button type="button" className="ghost" disabled={busy || !email} onClick={magic}>Email me a magic link</button>}</div>
        </form>
        <p className="small muted">{mode === "signup" ? <>Already have a workspace? <Link to="/signin">Sign in</Link></> : <>New here? <Link to="/signup">Create a workspace</Link></>}</p>
      </div>
    </div>
  );
}

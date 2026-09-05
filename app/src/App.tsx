import { HashRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { supabase } from "./lib/supabase";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Day from "./pages/Day";
import Setup from "./pages/Setup";
import Connectors from "./pages/Connectors";
import Import from "./pages/Import";
import Guide from "./pages/Guide";
import Tour from "./pages/Tour";

function Shell() {
  const { session, operator, loading } = useAuth();
  if (loading) return <div className="main muted">Loading…</div>;
  if (!session) return <Navigate to="/signin" replace />;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">DayRunner</div>
        <div className="op">{operator?.name ?? "Setting up…"}</div>
        <NavLink to="/app" end>Day</NavLink><NavLink to="/app/tours">Tours</NavLink><NavLink to="/app/guide">Run sheet</NavLink><NavLink to="/app/import">Import CSV</NavLink><NavLink to="/app/setup">Setup</NavLink><NavLink to="/app/connectors">Connectors</NavLink>
        <div className="foot"><a href="#" onClick={(e) => { e.preventDefault(); supabase.auth.signOut(); }}>Sign out</a><br />{session.user.email}</div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider><HashRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<Auth mode="signin" />} /><Route path="/signup" element={<Auth mode="signup" />} />
        <Route path="/app" element={<Shell />}>
          <Route index element={<Day />} /><Route path="guide" element={<Guide />} /><Route path="tours" element={<Tour />} /><Route path="tours/:id" element={<Tour />} /><Route path="import" element={<Import />} /><Route path="setup" element={<Setup />} /><Route path="connectors" element={<Connectors />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter></AuthProvider>
  );
}

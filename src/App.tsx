import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { StoreProvider, useStore } from "./lib/store";
import { supabase } from "./lib/supabase";
import { localRepo } from "./lib/repo/local";
import { cloudRepo } from "./lib/repo/cloud";
import type { AllData, Repo } from "./lib/repo/types";
import Today from "./pages/Today";
import Log from "./pages/Log";
import Login from "./pages/Login";
import { IconChart, IconChat, IconDumbbell, IconHome, IconPlus } from "./components/Icons";

const Coach = lazy(() => import("./pages/Coach"));
const Progress = lazy(() => import("./pages/Progress"));
const Workouts = lazy(() => import("./pages/Workouts"));
const WorkoutNew = lazy(() => import("./pages/Workouts").then((m) => ({ default: m.WorkoutNew })));
const Settings = lazy(() => import("./pages/Settings"));

function Nav() {
  return (
    <nav className="nav" aria-label="Principal">
      <div className="nav-inner">
        <NavLink to="/" end><IconHome />Hoy</NavLink>
        <NavLink to="/progreso"><IconChart />Progreso</NavLink>
        <NavLink to="/registrar" className="plus" aria-label="Registrar comida"><span className="p"><IconPlus /></span></NavLink>
        <NavLink to="/entrenos"><IconDumbbell />Entrenos</NavLink>
        <NavLink to="/coach"><IconChat />Coach</NavLink>
      </div>
    </nav>
  );
}

/** Marca como "abierto" el nudge que trajo a la usuaria (?ev=...) y escucha al service worker */
function EventTracker() {
  const loc = useLocation();
  const nav = useNavigate();
  const { actions } = useStore();
  useEffect(() => {
    const ev = new URLSearchParams(loc.search).get("ev");
    if (ev) actions.respondEvent(ev, "opened");
  }, [loc.search, actions]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "navigate" && typeof e.data.url === "string") nav(e.data.url);
      if (e.data?.type === "event-response" && e.data.eventId) actions.respondEvent(e.data.eventId, e.data.response);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [nav, actions]);
  return null;
}

function Shell() {
  return (
    <>
      <EventTracker />
      <main className="app">
        <Suspense fallback={<div className="center"><span className="spinner" /></div>}>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/registrar" element={<Log />} />
            <Route path="/coach" element={<Coach />} />
            <Route path="/progreso" element={<Progress />} />
            <Route path="/entrenos" element={<Workouts />} />
            <Route path="/entrenos/nuevo" element={<WorkoutNew />} />
            <Route path="/ajustes" element={<Settings />} />
            <Route path="*" element={<Today />} />
          </Routes>
        </Suspense>
      </main>
      <Nav />
    </>
  );
}

function Loader({ repo }: { repo: Repo }) {
  const [data, setData] = useState<AllData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    repo.loadAll().then(setData).catch((e) => setErr(e.message ?? String(e)));
  }, [repo]);
  if (err) return <div className="app center"><div><p>No pude cargar tus datos.</p><p className="faint">{err}</p><button className="btn" onClick={() => location.reload()}>Reintentar</button></div></div>;
  if (!data) return <div className="app center"><span className="spinner" /></div>;
  return (
    <StoreProvider repo={repo} initial={data}>
      <Shell />
    </StoreProvider>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  const [repo, setRepo] = useState<Repo | null>(supabase ? null : localRepo());

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (supabase && session) setRepo((r) => (r && r.mode === "cloud" ? r : cloudRepo(supabase!, session.user.id)));
  }, [session]);

  if (supabase && session === undefined) return <div className="app center"><span className="spinner" /></div>;
  if (supabase && !session) return <Login />;
  return <BrowserRouter>{repo && <Loader repo={repo} />}</BrowserRouter>;
}

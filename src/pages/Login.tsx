import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMsg(null);
    const { error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) setMsg(error.message);
    else if (mode === "up") setMsg("Cuenta creada. Si tu proyecto pide confirmar el email, revisá tu correo. Después cerrá el registro en Supabase (Auth → Sign In / Providers).");
  };

  return (
    <div className="app">
      <div className="center">
        <form onSubmit={submit} className="card" style={{ width: "100%", maxWidth: 380, textAlign: "left" }}>
          <h1 style={{ fontSize: 22, marginTop: 0 }}>Coach</h1>
          <p className="faint" style={{ marginTop: 0 }}>Nutrición + entrenamiento. Privado, un solo usuario.</p>
          <div className="stack">
            <label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="field"><span>Contraseña</span><input type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
            <button className="btn primary block" disabled={busy}>{busy ? <span className="spinner" /> : mode === "in" ? "Entrar" : "Crear cuenta"}</button>
            {msg && <div className="banner">{msg}</div>}
            <button type="button" className="btn ghost block sm" onClick={() => setMode(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "Primera vez: crear cuenta" : "Ya tengo cuenta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

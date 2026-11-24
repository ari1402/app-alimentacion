import { useEffect, useRef, useState } from "react";
import { type ChatMessage, type Meal, negotiateExtra, simulateWorkoutChange, slotLabel, totalsOf } from "@core";
import { useStore } from "../lib/store";
import { AIUnavailable, coachAI, type CoachReply } from "../lib/ai";
import { uid } from "../lib/uid";

const QUICK = [
  "¿Puedo comer un alfajor ahora?",
  "Hoy no llego a entrenar, ¿lo muevo a mañana?",
  "¿Si me mantengo así, cuándo llego?",
  "¿Qué ceno para cerrar la proteína?",
  "Estoy de guardia, ¿qué como?",
];

function Simulator() {
  const { data, snap } = useStore();
  const [kcal, setKcal] = useState("300");
  const [carbs, setCarbs] = useState("35");
  const n = negotiateExtra(
    { kcal: Number(kcal) || 0, p: 0, c: Number(carbs) || 0, f: Math.max(0, ((Number(kcal) || 0) - (Number(carbs) || 0) * 4) / 9) },
    data.meals, data.config, snap.today, snap.projection.tdee.kcal, data.workouts,
  );
  const wk = simulateWorkoutChange(data.config, data.workouts, snap.today, "mover");
  const sk = simulateWorkoutChange(data.config, data.workouts, snap.today, "saltear");
  return (
    <details className="card">
      <summary><strong>Simulador sin IA</strong> <span className="faint">(funciona offline)</span></summary>
      <div className="grid2" style={{ marginTop: 10 }}>
        <label className="field"><span>Extra kcal</span><input type="number" inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
        <label className="field"><span>de carbos (g)</span><input type="number" inputMode="numeric" value={carbs} onChange={(e) => setCarbs(e.target.value)} /></label>
      </div>
      <p className="small" style={{ marginBottom: 6 }}>{n.summary}</p>
      <ol className="small muted" style={{ paddingLeft: 18, marginTop: 0 }}>
        {n.options.map((o) => <li key={o.key}><strong>{o.title}.</strong> {o.detail}</li>)}
      </ol>
      <hr />
      <p className="small" style={{ margin: 0 }}><strong>Mover el entreno:</strong> {wk.message}</p>
      <p className="small"><strong>Saltearlo:</strong> {sk.message}</p>
    </details>
  );
}

export default function Coach() {
  const { data, snap, actions, toast } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<Record<string, CoachReply["proposals"]>>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data.chat.length, busy]);

  const send = async (text: string, mode: "chat" | "analisis_dia" | "analisis_semana" = "chat") => {
    const content = text.trim();
    if (mode === "chat" && !content) return;
    const history = data.chat.map((m) => ({ role: m.role, content: m.content }));
    if (mode === "chat") {
      const um: ChatMessage = { id: uid(), created_at: new Date().toISOString(), role: "user", content };
      await actions.addChat(um);
      history.push({ role: "user", content });
    } else {
      await actions.addChat({ id: uid(), created_at: new Date().toISOString(), role: "user", content: mode === "analisis_dia" ? "Análisis del día" : "Cierre de la semana" });
    }
    setInput("");
    setBusy(true);
    try {
      const r = await coachAI(
        { mode, messages: history },
        { cfg: data.config, data: { meals: data.meals, workouts: data.workouts, metrics: data.metrics, templates: data.templates, events: data.events }, foods: data.foods },
      );
      const am: ChatMessage = { id: uid(), created_at: new Date().toISOString(), role: "assistant", content: r.text };
      await actions.addChat(am);
      if (r.proposals?.length) setProposals((p) => ({ ...p, [am.id]: r.proposals }));
    } catch (e) {
      toast(e instanceof AIUnavailable ? `${(e as Error).message} Usá el simulador de abajo.` : (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const logProposal = async (p: CoachReply["proposals"][number]) => {
    const meal: Meal = { id: uid(), local_date: snap.today, slot: p.slot, eaten_at: new Date().toISOString(), raw_text: null, items: p.items, totals: totalsOf(p.items), source: "ai", confirmed: true };
    const fb = await actions.logMeal(meal);
    toast(fb);
  };

  return (
    <div>
      <div className="header">
        <div>
          <h1>Coach</h1>
          <div className="sub">Negociá, preguntá, pedí un análisis. Las cuentas las hace la app.</div>
        </div>
        {data.chat.length > 0 && <button className="btn sm ghost" onClick={() => confirm("¿Borrar la conversación?") && actions.clearChat()}>Limpiar</button>}
      </div>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn sm" disabled={busy} onClick={() => send("", "analisis_dia")}>Análisis del día</button>
        <button className="btn sm" disabled={busy} onClick={() => send("", "analisis_semana")}>Cierre de semana</button>
      </div>

      <div className="chat">
        {data.chat.length === 0 && (
          <div className="card faint">
            Ejemplos: “si como una porción de pizza en la cena, ¿cómo queda?”, “¿cuántos días me faltan para 75?”, “comí 2 empanadas de carne en el almuerzo”.
          </div>
        )}
        {data.chat.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.content}
            {proposals[m.id]?.map((p, i) => (
              <div key={i} className="card" style={{ marginTop: 8, marginBottom: 0, padding: 10 }}>
                <div className="small"><strong>{slotLabel(p.slot)}:</strong> {p.items.map((it) => `${it.name} ${it.grams} g`).join(", ")}</div>
                <div className="faint num">{totalsOf(p.items).kcal} kcal · {Math.round(totalsOf(p.items).p)} g P</div>
                <button className="btn sm primary" style={{ marginTop: 6 }} onClick={() => logProposal(p)}>Registrar</button>
              </div>
            ))}
          </div>
        ))}
        {busy && <div className="bubble assistant"><span className="spinner" /></div>}
        <div ref={endRef} />
      </div>

      {data.chat.length < 2 && (
        <div className="chips" style={{ marginTop: 12 }}>
          {QUICK.map((q) => <button key={q} className="chip" onClick={() => send(q)} disabled={busy}>{q}</button>)}
        </div>
      )}

      <div className="composer">
        <input
          type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribile al coach…"
          onKeyDown={(e) => e.key === "Enter" && !busy && send(input)} aria-label="Mensaje al coach"
        />
        <button className="btn primary" onClick={() => send(input)} disabled={busy || !input.trim()}>Enviar</button>
      </div>
      <div style={{ marginTop: 16 }}>
        <Simulator />
      </div>
    </div>
  );
}

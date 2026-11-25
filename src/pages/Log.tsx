import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  addDays, buildDayState, type Food, itemFromFood, localParts, type Meal, type MealItem, normalizePhrase, rankRecipes, rankTemplates,
  servingItems, type Slot, SLOTS, slotForTime, slotLabel, totalsOf,
} from "@core";
import { useStore } from "../lib/store";
import { AIUnavailable, fileToImagePayload, lookupFoodAI, parseMealAI } from "../lib/ai";
import { ItemsEditor } from "../components/ItemsEditor";
import { IconCamera, IconMic, IconStar } from "../components/Icons";
import { uid } from "../lib/uid";
import { useSpeech } from "../lib/speech";

type Mode = "texto" | "lista" | "rapido";

function searchFoods(foods: Food[], q: string): Food[] {
  const n = normalizePhrase(q);
  if (!n) return [...foods].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.name.localeCompare(b.name));
  const terms = n.split(" ");
  return foods
    .map((f) => {
      const hay = normalizePhrase([f.name, f.brand ?? "", ...(f.aliases ?? [])].join(" "));
      const words = new Set(hay.split(" "));
      // palabra completa (ej. la marca "integra") pesa más que un pedazo ("integral")
      const s = terms.reduce((a, t) => a + (hay.includes(t) ? (words.has(t) ? 3 : hay.startsWith(t) ? 2 : 1) : 0), 0);
      return { f, s: s + (f.favorite ? 0.5 : 0) };
    })
    .filter((x) => x.s >= terms.length)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.f);
}

export default function Log() {
  const { data, snap, actions, toast } = useStore();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const tz = data.config.timezone;
  const nowParts = localParts(new Date(), tz);
  const [slot, setSlot] = useState<Slot>((params.get("slot") as Slot) || slotForTime(nowParts.minutes));
  const [day, setDay] = useState<"hoy" | "ayer">("hoy");
  const [time, setTime] = useState(`${String(nowParts.hour).padStart(2, "0")}:${String(nowParts.minute).padStart(2, "0")}`);
  const [mode, setMode] = useState<Mode>((params.get("modo") as Mode) || "texto");
  const [text, setText] = useState("");
  const [items, setItems] = useState<MealItem[]>([]);
  const [source, setSource] = useState<Meal["source"]>("ai");
  const [busy, setBusy] = useState(false);
  const [clarify, setClarify] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [recipeUses, setRecipeUses] = useState<Record<string, number>>({});
  const [lookingUp, setLookingUp] = useState<number | null>(null);

  /** Producto de marca estimado → buscar la etiqueta real y reemplazar el ítem */
  const lookup = async (i: number) => {
    const it = items[i];
    setLookingUp(i);
    try {
      const r = await lookupFoodAI([it.name, it.phrase].filter(Boolean).join(" — "));
      if (!r.food) return toast(r.message || "No encontré la etiqueta de ese producto.", "error");
      await actions.saveFood(r.food);
      // "una barrita" → 1 porción del producto; si no, se mantienen los gramos
      const oneUnit = /\b(un|una|1)\b/i.test(it.phrase ?? "") && /unidad|barrita|pote|botella|lata|sobre|paquete|\(/i.test(r.food.portion_label);
      const grams = oneUnit ? r.food.portion_g : it.grams;
      setItems((prev) => prev.map((x, j) => (j === i ? itemFromFood(r.food!, grams, x.phrase) : x)));
      toast(`${r.message} Guardado en tu tabla.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLookingUp(null);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const speech = useSpeech((t) => setText((p) => (p ? `${p} ${t}` : t)));

  useEffect(() => {
    const ev = params.get("ev");
    if (ev) actions.respondEvent(ev, "opened");
  }, [params, actions]);

  const date = day === "hoy" ? snap.today : addDays(snap.today, -1);
  const dayState = useMemo(() => buildDayState(date, data.meals, data.config, data.workouts), [date, data.meals, data.config, data.workouts]);
  const draftTotals = totalsOf(items);
  const after = useMemo(() => ({
    kcal: dayState.totals.kcal + draftTotals.kcal,
    p: dayState.totals.p + draftTotals.p,
  }), [dayState, draftTotals]);

  const interpret = async (image?: { media_type: string; data: string }) => {
    if (!text.trim() && !image) return;
    setBusy(true);
    setClarify(null);
    try {
      const r = await parseMealAI({ text, image: image ?? null, slot }, { foods: data.foods, portions: data.portions });
      if (r.slot && !params.get("slot")) setSlot(r.slot);
      setItems((prev) => [...prev, ...r.items]);
      setSource(image ? "photo" : "ai");
      setClarify(r.clarification);
      if (!r.items.length) toast("No identifiqué alimentos. Probá con más detalle o usá la lista.", "error");
    } catch (e) {
      const base = (e as Error).message.replace(/\.?\s*$/, ".");
      const msg = e instanceof AIUnavailable ? `${base} Cargalo desde la lista.` : base;
      toast(msg, "error");
      setMode("lista");
      setQ(text.split(/,| y /)[0] ?? "");
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      const img = await fileToImagePayload(f);
      await interpret(img);
    } catch {
      toast("No pude leer la foto.", "error");
    }
  };

  const addFood = (f: Food, grams = f.portion_g) => {
    setItems((prev) => [...prev, itemFromFood(f, grams, null)]);
    if (source === "ai" && !items.length) setSource("list");
  };

  const confirm = async () => {
    if (!items.length) return;
    const [h, m] = time.split(":").map(Number);
    // Construye la hora local elegida en la zona de la usuaria (aprox. vía offset actual)
    const base = new Date();
    const lp = localParts(base, tz);
    const deltaMin = (h * 60 + m) - lp.minutes - (day === "ayer" ? 1440 : 0);
    const eaten = new Date(base.getTime() + deltaMin * 60000);
    const meal: Meal = {
      id: uid(), local_date: date, slot, eaten_at: eaten.toISOString(), raw_text: text || null,
      items, totals: totalsOf(items), source, confirmed: true,
    };
    setBusy(true);
    try {
      const fb = await actions.logMeal(meal);
      // Meal prep: descontar porciones usadas de la heladera
      for (const [id, n] of Object.entries(recipeUses)) {
        const r = data.recipes.find((x) => x.id === id);
        if (r?.batch_left) await actions.saveRecipe({ ...r, batch_left: Math.max(0, r.batch_left - n) });
      }
      toast(fb);
      nav("/");
    } finally {
      setBusy(false);
    }
  };

  // Rápido: repetir comidas recientes (distintas) y plantillas que encajan
  const recents = useMemo(() => {
    const seen = new Set<string>();
    const out: Meal[] = [];
    for (const m of [...data.meals].sort((a, b) => b.eaten_at.localeCompare(a.eaten_at))) {
      const sig = m.items.map((i) => `${i.food_id ?? i.name}:${i.grams}`).sort().join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(m);
      if (out.length >= 30) break;
    }
    const sameSlot = out.filter((m) => m.slot === slot);
    return [...sameSlot, ...out.filter((m) => m.slot !== slot)].slice(0, 8);
  }, [data.meals, slot]);
  const ranked = useMemo(() => rankTemplates(data.templates, slot, dayState), [data.templates, slot, dayState]);
  const results = useMemo(() => searchFoods(data.foods, q).slice(0, 40), [data.foods, q]);
  const rankedRecipes = useMemo(() => rankRecipes(data.recipes, slot, dayState), [data.recipes, slot, dayState]);

  return (
    <div>
      <div className="header">
        <div>
          <h1>Registrar</h1>
          <div className="sub">Corregí antes de confirmar · {dayState.remaining.kcal} kcal y {Math.max(0, Math.round(dayState.remaining.p))} g P restantes</div>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 8 }}>
        {SLOTS.map((s) => (
          <button key={s} className={`chip ${s === slot ? "on" : ""}`} onClick={() => setSlot(s)}>{slotLabel(s)}</button>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="seg" style={{ flex: 1 }}>
          <button className={day === "hoy" ? "on" : ""} onClick={() => setDay("hoy")}>Hoy</button>
          <button className={day === "ayer" ? "on" : ""} onClick={() => setDay("ayer")}>Ayer</button>
        </div>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 140 }} aria-label="Hora" />
      </div>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === "texto" ? "on" : ""} onClick={() => setMode("texto")}>Escribir</button>
        <button className={mode === "rapido" ? "on" : ""} onClick={() => setMode("rapido")}>Rápido</button>
        <button className={mode === "lista" ? "on" : ""} onClick={() => setMode("lista")}>Lista</button>
      </div>

      {mode === "texto" && (
        <div className="card">
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder="ej: medio panqueque proteico y un café con leche proteica"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) interpret(); }}
            aria-label="¿Qué comiste?"
          />
          <div className="row" style={{ marginTop: 8 }}>
            {speech.supported && (
              <button className="btn" onClick={speech.listening ? speech.stop : speech.start} aria-label="Dictar">
                {speech.listening ? <span className="spinner" /> : <IconMic />}
              </button>
            )}
            <button className="btn" onClick={() => fileRef.current?.click()} aria-label="Foto del plato"><IconCamera /></button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
            <button className="btn primary grow" onClick={() => interpret()} disabled={busy || !text.trim()}>
              {busy ? <span className="spinner" /> : "Interpretar"}
            </button>
          </div>
          {clarify && <div className="banner" style={{ marginTop: 8 }}>{clarify}</div>}
        </div>
      )}

      {mode === "rapido" && (
        <>
          {recents.length > 0 && (
            <div className="card">
              <h2>Repetir</h2>
              {recents.map((m) => (
                <div className="list-item" key={m.id}>
                  <div className="grow">
                    <div style={{ fontWeight: 550 }}>{m.items.map((i) => i.name).join(", ")}</div>
                    <div className="faint">{slotLabel(m.slot)} · {m.totals.kcal} kcal · {Math.round(m.totals.p)} g P</div>
                  </div>
                  <button className="btn sm" onClick={() => { setItems((p) => [...p, ...m.items.map((i) => ({ ...i }))]); setSource("repeat"); }}>+ Agregar</button>
                </div>
              ))}
            </div>
          )}
          {rankedRecipes.length > 0 && (
            <div className="card">
              <div className="row between"><h2 style={{ margin: 0 }}>Recetas</h2><Link to="/recetas" className="faint small">Ver todas</Link></div>
              {rankedRecipes.slice(0, 5).map(({ recipe: r, fits, why }) => (
                <div className="list-item" key={r.id}>
                  <div className="grow">
                    <div style={{ fontWeight: 550 }}>{r.batch_left ? "🥡 " : ""}{r.name}</div>
                    <div className="faint">{fits ? "✓ entra · " : ""}{why}</div>
                  </div>
                  <button className="btn sm" onClick={() => { setItems((p) => [...p, ...servingItems(r, 1)]); setSource("template"); setRecipeUses((u) => ({ ...u, [r.id]: (u[r.id] ?? 0) + 1 })); }}>+ 1 porción</button>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <h2>Opciones para {slotLabel(slot).toLowerCase()}</h2>
            {dayState.carbRule.active && <div className="banner" style={{ marginBottom: 8 }}>{dayState.carbRule.reason}</div>}
            {ranked.length === 0 && <div className="faint">No hay plantillas para este momento. Agregalas en Ajustes → Plantillas.</div>}
            {ranked.slice(0, 8).map(({ template: t, fits, why }) => (
              <div className="list-item" key={t.id}>
                <div className="grow">
                  <div style={{ fontWeight: 550 }}>{t.code} · {t.name}</div>
                  <div className="faint">{fits ? "✓ entra · " : ""}{why}</div>
                </div>
                <button className="btn sm" onClick={() => { setItems((p) => [...p, ...t.items.map((i) => ({ ...i }))]); setSource("template"); }}>+ Agregar</button>
              </div>
            ))}
          </div>
        </>
      )}

      {mode === "lista" && (
        <div className="card">
          <input type="search" placeholder="Buscar alimento…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar alimento" />
          <div style={{ maxHeight: 340, overflow: "auto", marginTop: 6 }}>
            {results.map((f) => (
              <div className="list-item" key={f.id}>
                <button className="icon-btn" style={{ color: f.favorite ? "var(--s4)" : undefined }} aria-label="Favorito" onClick={() => actions.saveFood({ ...f, favorite: !f.favorite })}>
                  <IconStar on={f.favorite} />
                </button>
                <div className="grow">
                  <div style={{ fontWeight: 550 }}>{f.name}</div>
                  <div className="faint">{f.portion_label} · {f.kcal} kcal · P {f.p}</div>
                </div>
                <button className="btn sm" onClick={() => addFood(f)}>+</button>
              </div>
            ))}
            {!results.length && <div className="faint" style={{ padding: 8 }}>Sin resultados. Podés agregarlo en Ajustes → Alimentos.</div>}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="card">
          <h2>Revisá y confirmá</h2>
          <ItemsEditor items={items} foods={data.foods} onChange={setItems} onLookup={lookup} lookingUp={lookingUp} />
          <div className="faint" style={{ marginTop: 8 }}>
            Después de esto: {Math.round(after.kcal)} / {dayState.target.kcal} kcal · {Math.round(after.p)} / {dayState.ranges.pMin} g P
            {draftTotals.c > data.config.carb_rule_threshold ? ` · más de ${data.config.carb_rule_threshold} g de carbos: la próxima, baja en carbos` : ""}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setItems([])}>Descartar</button>
            <button className="btn primary grow" onClick={confirm} disabled={busy}>Confirmar {slotLabel(slot).toLowerCase()}</button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  autoTags, buildDayState, fmtShort, type Food, itemFromFood, localParts, type Macros, type Meal, perServing, type Recipe, recipeAsText,
  rescaleItem,
  servingItems, shoppingList, type Slot, slotBudget, slotForTime, slotLabel, totalsOf, withTotals,
} from "@core";
import { useStore } from "../lib/store";
import { AIUnavailable, recipeAI, type RecipeReply } from "../lib/ai";
import { Sheet } from "../components/Sheet";
import { ItemsEditor } from "../components/ItemsEditor";
import { IconStar } from "../components/Icons";
import { uid } from "../lib/uid";

type MainSlot = Exclude<Slot, "snack">;
const MAIN: MainSlot[] = ["desayuno", "almuerzo", "merienda", "cena"];

function MacroLine({ m, label = "por porción" }: { m: Macros; label?: string }) {
  return <span className="num">{m.kcal} kcal · P {Math.round(m.p)} · C {Math.round(m.c)} · G {Math.round(m.f)} <span className="faint">{label}</span></span>;
}

async function copy(text: string, toast: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copiado ✓");
  } catch {
    toast("No pude copiar en este navegador");
  }
}

/** Vista completa de una receta (detalle guardado o resultado del generador) */
function RecipeView({ r }: { r: Recipe }) {
  const ps = perServing(r);
  return (
    <div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        {r.tags.map((t) => <span key={t} className="tag">{t}</span>)}
        <span className="tag">{r.prep_min} min</span>
        <span className="tag">{r.servings} porción{r.servings > 1 ? "es" : ""}</span>
      </div>
      <div className="banner" style={{ marginBottom: 10 }}><MacroLine m={ps} /></div>
      <h3>Ingredientes</h3>
      {r.ingredients.map((i, n) => (
        <div key={n} className="row between small" style={{ padding: "3px 0" }}>
          <span>{i.name} {i.estimated && <span className="tag">estimado</span>}</span>
          <span className="num faint">{i.grams} g{r.servings > 1 ? ` (${Math.round(i.grams / r.servings)} g/porción)` : ""}</span>
        </div>
      ))}
      <h3 style={{ marginTop: 12 }}>Pasos</h3>
      <ol className="small" style={{ paddingLeft: 18, marginTop: 0 }}>
        {r.steps.map((s, n) => <li key={n} style={{ marginBottom: 4 }}>{s}</li>)}
      </ol>
      {r.tips && <p className="small muted"><strong>Tip:</strong> {r.tips}</p>}
    </div>
  );
}

function RecipeEditor({ r, foods, onSave, onCancel }: { r: Recipe; foods: Food[]; onSave: (r: Recipe) => void; onCancel: () => void }) {
  const [name, setName] = useState(r.name);
  const [servings, setServings] = useState(r.servings);
  const [items, setItems] = useState(r.ingredients);
  const [steps, setSteps] = useState(r.steps.join("\n"));
  const [slots, setSlots] = useState<MainSlot[]>(r.slots);
  const [q, setQ] = useState("");
  const results = q ? foods.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  return (
    <div className="stack">
      <label className="field"><span>Nombre</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="chips">{MAIN.map((s) => <button key={s} className={`chip ${slots.includes(s) ? "on" : ""}`} onClick={() => setSlots(slots.includes(s) ? slots.filter((x) => x !== s) : [...slots, s])}>{slotLabel(s)}</button>)}</div>
      <label className="field"><span>Porciones que rinde</span><input type="number" min={1} max={20} value={servings} onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))} /></label>
      <h3>Ingredientes (receta completa)</h3>
      <ItemsEditor items={items} foods={foods} onChange={setItems} />
      <input type="search" placeholder="Agregar ingrediente…" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.map((f) => <button key={f.id} className="btn sm ghost block" style={{ justifyContent: "flex-start" }} onClick={() => { setItems([...items, itemFromFood(f, f.portion_g)]); setQ(""); }}>+ {f.name}</button>)}
      <label className="field"><span>Pasos (uno por línea)</span><textarea value={steps} onChange={(e) => setSteps(e.target.value)} /></label>
      <div className="row">
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn primary grow" disabled={!name.trim() || !items.length} onClick={() => {
          const next = withTotals({ ...r, name: name.trim(), servings, ingredients: items, steps: steps.split("\n").map((s) => s.trim()).filter(Boolean), slots, source: r.source === "base" ? "manual" : r.source });
          onSave({ ...next, tags: autoTags(next) });
        }}>Guardar</button>
      </div>
    </div>
  );
}

function RecipeSheet({ r, onClose }: { r: Recipe | null; onClose: () => void }) {
  const { data, snap, actions, toast } = useStore();
  const [editing, setEditing] = useState(false);
  const tz = data.config.timezone;
  const defaultSlot: Slot = r?.slots.includes(slotForTime(localParts(new Date(), tz).minutes) as MainSlot) ? slotForTime(localParts(new Date(), tz).minutes) : r?.slots[0] ?? "almuerzo";
  const [slot, setSlot] = useState<Slot>(defaultSlot);
  if (!r) return null;
  const log = async () => {
    const items = servingItems(r, 1);
    const meal: Meal = { id: uid(), local_date: snap.today, slot, eaten_at: new Date().toISOString(), raw_text: r.name, items, totals: totalsOf(items), source: "template", confirmed: true };
    const fb = await actions.logMeal(meal);
    if (r.batch_left && r.batch_left > 0) await actions.saveRecipe({ ...r, batch_left: r.batch_left - 1 });
    toast(fb);
    onClose();
  };
  return (
    <Sheet open={!!r} onClose={() => { setEditing(false); onClose(); }} title={r.name}>
      {editing ? (
        <RecipeEditor r={r} foods={data.foods} onCancel={() => setEditing(false)} onSave={async (next) => { await actions.saveRecipe(next); setEditing(false); toast("Receta guardada"); }} />
      ) : (
        <>
          <RecipeView r={r} />
          {!!r.batch_left && <div className="banner" style={{ margin: "8px 0" }}>En la heladera: <strong>{r.batch_left}</strong> {r.batch_left > 1 ? "porciones" : "porción"}{r.batch_cooked_at ? ` (cocinadas el ${fmtShort(r.batch_cooked_at)})` : ""}.</div>}
          <div className="chips" style={{ margin: "10px 0 6px" }}>
            {(["desayuno", "almuerzo", "merienda", "cena", "snack"] as Slot[]).map((s) => <button key={s} className={`chip ${slot === s ? "on" : ""}`} onClick={() => setSlot(s)}>{slotLabel(s)}</button>)}
          </div>
          <button className="btn primary block" onClick={log}>Registrar 1 porción</button>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={async () => { await actions.saveRecipe({ ...r, batch_left: r.servings, batch_cooked_at: snap.today }); toast(`Anotado: ${r.servings} porciones en la heladera`); }}>Cociné una tanda</button>
            <button className="btn sm" onClick={() => actions.saveRecipe({ ...r, favorite: !r.favorite })} style={{ color: r.favorite ? "var(--s4)" : undefined }}><IconStar on={r.favorite} /> Favorita</button>
            <button className="btn sm" onClick={() => copy(recipeAsText(r), toast)}>Copiar</button>
            <button className="btn sm" onClick={() => setEditing(true)}>Editar</button>
            <button className="btn sm ghost danger" onClick={async () => { if (confirm("¿Borrar la receta?")) { await actions.deleteRecipe(r.id); onClose(); } }}>Borrar</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function Generator({ onSaved }: { onSaved: () => void }) {
  const { data, snap, actions, toast } = useStore();
  const cfg = data.config;
  const nowSlot = slotForTime(localParts(new Date(), cfg.timezone).minutes) as MainSlot;
  // Por defecto: el próximo momento que falta desde ahora (no el desayuno a la noche)
  const order: MainSlot[] = ["desayuno", "almuerzo", "merienda", "cena"];
  const upcoming = order.slice(order.indexOf(nowSlot)).find((x) => snap.day.pendingSlots.includes(x)) ?? nowSlot;
  const [slot, setSlot] = useState<MainSlot>(upcoming);
  const [mode, setMode] = useState<"hoy" | "custom">("hoy");
  const [kcal, setKcal] = useState("500");
  const [prot, setProt] = useState("40");
  const [servings, setServings] = useState(1);
  const [minutes, setMinutes] = useState(30);
  const [have, setHave] = useState("");
  const [wish, setWish] = useState("");
  const [lowCarb, setLowCarb] = useState(snap.day.carbRule.active);
  const [portable, setPortable] = useState(snap.guardia);
  const [reintro, setReintro] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RecipeReply | null>(null);
  const day = useMemo(() => buildDayState(snap.today, data.meals, cfg, data.workouts), [snap.today, data.meals, cfg, data.workouts]);
  const target: Macros = mode === "hoy"
    ? slotBudget(day, slot)
    : { kcal: Number(kcal) || 500, p: Number(prot) || 40, c: Math.max(10, ((Number(kcal) || 500) * 0.4) / 4), f: Math.max(8, ((Number(kcal) || 500) * 0.25) / 9) };

  const generate = async () => {
    setBusy(true);
    setRes(null);
    try {
      const r = await recipeAI(
        { slot, target, servings, max_minutes: minutes, have, wish, low_carb: lowCarb, portable, reintroduce: reintro || null, avoid: data.recipes.map((x) => x.name) },
        { foods: data.foods },
      );
      setRes(r);
    } catch (e) {
      toast(e instanceof AIUnavailable ? `${(e as Error).message}` : (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>¿Para cuándo?</h2>
        <div className="chips">{MAIN.map((s) => <button key={s} className={`chip ${slot === s ? "on" : ""}`} onClick={() => setSlot(s)}>{slotLabel(s)}</button>)}</div>
        <div className="seg" style={{ marginTop: 10 }}>
          <button className={mode === "hoy" ? "on" : ""} onClick={() => setMode("hoy")}>Que entre en lo de hoy</button>
          <button className={mode === "custom" ? "on" : ""} onClick={() => setMode("custom")}>Elegir macros</button>
        </div>
        {mode === "custom" && (
          <div className="grid2" style={{ marginTop: 8 }}>
            <label className="field"><span>kcal por porción</span><input type="number" inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
            <label className="field"><span>Proteína mínima (g)</span><input type="number" inputMode="numeric" value={prot} onChange={(e) => setProt(e.target.value)} /></label>
          </div>
        )}
        <div className="faint" style={{ marginTop: 8 }}>Objetivo por porción: <MacroLine m={{ ...target, c: Math.round(target.c), f: Math.round(target.f) }} label="" /></div>
        <h3 style={{ marginTop: 12 }}>Porciones</h3>
        <div className="chips">{[1, 2, 4, 6].map((n) => <button key={n} className={`chip ${servings === n ? "on" : ""}`} onClick={() => setServings(n)}>{n}{n >= 4 ? " (meal prep)" : ""}</button>)}</div>
        <h3 style={{ marginTop: 12 }}>Tiempo máximo</h3>
        <div className="chips">{[10, 20, 30, 45, 60].map((n) => <button key={n} className={`chip ${minutes === n ? "on" : ""}`} onClick={() => setMinutes(n)}>{n} min</button>)}</div>
        <label className="field" style={{ marginTop: 12 }}><span>¿Qué tenés en casa? (opcional)</span>
          <textarea style={{ minHeight: 60 }} value={have} onChange={(e) => setHave(e.target.value)} placeholder="ej: pollo, zapallitos, huevos, queso, arroz" />
        </label>
        <label className="field" style={{ marginTop: 8 }}><span>Algo más (opcional)</span>
          <input type="text" value={wish} onChange={(e) => setWish(e.target.value)} placeholder="ej: algo dulce, sin horno, estilo mexicano" />
        </label>
        <div className="row wrap" style={{ marginTop: 10, gap: 14 }}>
          <label className="row small"><input type="checkbox" checked={lowCarb} onChange={(e) => setLowCarb(e.target.checked)} /> Baja en carbos</label>
          <label className="row small"><input type="checkbox" checked={portable} onChange={(e) => setPortable(e.target.checked)} /> Para llevar (guardia)</label>
        </div>
        {cfg.reintroductions.length > 0 && (
          <label className="field" style={{ marginTop: 8 }}><span>Incluir una reintroducción</span>
            <select value={reintro} onChange={(e) => setReintro(e.target.value)}>
              <option value="">No</option>
              {cfg.reintroductions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        <button className="btn primary block" style={{ marginTop: 12 }} onClick={generate} disabled={busy}>{busy ? <><span className="spinner" /> Cocinando la idea…</> : res ? "Generar otra" : "Generar receta"}</button>
      </div>
      {res && (
        <div className="card">
          <h2>{res.recipe.name}</h2>
          <RecipeView r={res.recipe} />
          <p className="faint">
            {Math.abs(res.deviation.kcal) <= 60 && res.deviation.p >= -5
              ? "✓ Entra en el objetivo."
              : `Diferencia con el objetivo: ${res.deviation.kcal > 0 ? "+" : ""}${res.deviation.kcal} kcal, ${res.deviation.p > 0 ? "+" : ""}${res.deviation.p} g P. Podés ajustar gramos al editarla.`}
            {" "}Los macros salen de tu tabla de alimentos.
          </p>
          {Math.abs(res.deviation.kcal) > 60 && (
            <button className="btn sm" style={{ marginBottom: 8 }} onClick={() => {
              // Escala todas las cantidades para que una porción quede en las kcal objetivo
              const k = target.kcal / Math.max(1, res.perServing.kcal);
              const ingredients = res.recipe.ingredients.map((i) => {
                const f = i.food_id ? data.foods.find((x) => x.id === i.food_id) : undefined;
                return rescaleItem(i, Math.round((i.grams * k) / 5) * 5, f);
              });
              const recipe = withTotals({ ...res.recipe, ingredients });
              const ps = perServing(recipe);
              setRes({ recipe: { ...recipe, tags: autoTags(recipe) }, perServing: ps, deviation: { kcal: Math.round(ps.kcal - target.kcal), p: Math.round(ps.p - target.p) } });
            }}>Ajustar a mi objetivo ({target.kcal} kcal)</button>
          )}
          <div className="row">
            <button className="btn ghost" onClick={() => setRes(null)}>Descartar</button>
            <button className="btn primary grow" onClick={async () => { await actions.saveRecipe(res.recipe); toast("Receta guardada en Mis recetas"); setRes(null); onSaved(); }}>Guardar receta</button>
          </div>
        </div>
      )}
    </>
  );
}

function Shopping() {
  const { data, toast } = useStore();
  const [sel, setSel] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const selection = data.recipes.filter((r) => sel[r.id]).map((r) => ({ recipe: r, batches: sel[r.id] }));
  const list = useMemo(() => shoppingList(selection, data.foods), [selection, data.foods]);
  const text = ["Lista de compras", ...selection.map((s) => `(${s.batches}× ${s.recipe.name})`), "", ...list.map((i) => `- ${i.name}: ${i.label}`)].join("\n");
  return (
    <>
      <div className="card">
        <h2>¿Qué vas a cocinar esta semana?</h2>
        {data.recipes.map((r) => (
          <div key={r.id} className="list-item small">
            <span className="grow">{r.name} <span className="faint">· {r.servings} porc.</span></span>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm" aria-label={`Menos ${r.name}`} onClick={() => setSel({ ...sel, [r.id]: Math.max(0, (sel[r.id] ?? 0) - 1) })}>−</button>
              <span className="num" style={{ width: 22, textAlign: "center" }}>{sel[r.id] ?? 0}</span>
              <button className="btn sm" aria-label={`Más ${r.name}`} onClick={() => setSel({ ...sel, [r.id]: (sel[r.id] ?? 0) + 1 })}>+</button>
            </div>
          </div>
        ))}
        <p className="faint" style={{ marginBottom: 0 }}>Número = cuántas tandas de cada receta.</p>
      </div>
      {list.length > 0 && (
        <div className="card">
          <div className="row between"><h2 style={{ margin: 0 }}>Lista ({list.length})</h2><button className="btn sm" onClick={() => copy(text, toast)}>Copiar</button></div>
          {list.map((i, n) => (
            <div key={i.key}>
              {(n === 0 || list[n - 1].category !== i.category) && <div className="faint" style={{ marginTop: 10, textTransform: "capitalize" }}>{i.category}</div>}
              <label className="row small" style={{ padding: "4px 0", textDecoration: done[i.key] ? "line-through" : undefined, opacity: done[i.key] ? 0.5 : 1 }}>
                <input type="checkbox" checked={!!done[i.key]} onChange={(e) => setDone({ ...done, [i.key]: e.target.checked })} />
                <span className="grow">{i.name}</span><span className="faint num">{i.label}</span>
              </label>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function Recipes() {
  const { data } = useStore();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"mis" | "generar" | "compras">((params.get("tab") as "generar") || "mis");
  const [filter, setFilter] = useState<"todas" | MainSlot | "favoritas" | "heladera">("todas");
  const [open, setOpen] = useState<string | null>(null);
  const openRecipe = data.recipes.find((r) => r.id === open) ?? null;
  const list = data.recipes
    .filter((r) => filter === "todas" || (filter === "favoritas" ? r.favorite : filter === "heladera" ? (r.batch_left ?? 0) > 0 : r.slots.includes(filter)))
    .sort((a, b) => (b.batch_left ?? 0) - (a.batch_left ?? 0) || Number(!!b.favorite) - Number(!!a.favorite) || a.name.localeCompare(b.name));
  return (
    <div>
      <div className="header">
        <div>
          <h1>Recetas</h1>
          <div className="sub">Guardadas, generadas a tu medida y para meal prep.</div>
        </div>
      </div>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === "mis" ? "on" : ""} onClick={() => setTab("mis")}>Mis recetas</button>
        <button className={tab === "generar" ? "on" : ""} onClick={() => setTab("generar")}>Generar</button>
        <button className={tab === "compras" ? "on" : ""} onClick={() => setTab("compras")}>Compras</button>
      </div>
      {tab === "mis" && (
        <>
          <div className="chips" style={{ marginBottom: 10 }}>
            {(["todas", "heladera", "favoritas", ...MAIN] as const).map((f) => (
              <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                {f === "todas" ? "Todas" : f === "heladera" ? "En la heladera" : f === "favoritas" ? "Favoritas" : slotLabel(f)}
              </button>
            ))}
          </div>
          {list.length === 0 && <div className="card faint">No hay recetas acá todavía. Probá en “Generar”.</div>}
          {list.map((r) => {
            const ps = perServing(r);
            return (
              <button key={r.id} className="card" style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(r.id)}>
                <div className="row between">
                  <strong>{r.favorite ? "★ " : ""}{r.name}</strong>
                  {!!r.batch_left && <span className="tag" style={{ borderColor: "var(--good)" }}>{r.batch_left} en heladera</span>}
                </div>
                <div className="faint num" style={{ marginTop: 2 }}>{ps.kcal} kcal · {Math.round(ps.p)} g P por porción · {r.prep_min} min · {r.servings} porc.</div>
                <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>{r.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}{r.source === "ia" && <span className="tag">IA</span>}</div>
              </button>
            );
          })}
        </>
      )}
      {tab === "generar" && <Generator onSaved={() => setTab("mis")} />}
      {tab === "compras" && <Shopping />}
      <RecipeSheet key={open ?? "none"} r={openRecipe} onClose={() => setOpen(null)} />
    </div>
  );
}

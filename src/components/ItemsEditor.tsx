import type { Food, MealItem } from "@core";
import { rescaleItem, totalsOf } from "@core";
import { IconTrash } from "./Icons";

/** Lista editable de ítems: la IA puede errar cantidades, Ari corrige antes de confirmar. */
export function ItemsEditor({ items, foods, onChange }: { items: MealItem[]; foods: Food[]; onChange: (items: MealItem[]) => void }) {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const t = totalsOf(items);
  return (
    <div>
      {items.map((it, i) => (
        <div className="item-edit" key={i}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis" }}>
              {it.name} {it.estimated && <span className="tag" title="No está en tu tabla: macros estimados">estimado</span>}
            </div>
            <div className="faint num">{Math.round(it.kcal)} kcal · P {Math.round(it.p)} · C {Math.round(it.c)} · G {Math.round(it.f)}</div>
          </div>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="number" inputMode="decimal" min={0} step={5} value={it.grams || ""} aria-label={`Gramos de ${it.name}`}
              onChange={(e) => {
                const g = Number(e.target.value) || 0;
                const next = items.slice();
                next[i] = rescaleItem(it, g, it.food_id ? byId.get(it.food_id) : undefined);
                // si el ítem estaba en 0 g y no hay alimento, rescale no puede recalcular: se mantiene
                onChange(next);
              }}
            />
            <span className="faint">g</span>
          </label>
          <button className="icon-btn" aria-label={`Quitar ${it.name}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><IconTrash /></button>
        </div>
      ))}
      {items.length > 0 && (
        <div className="row between" style={{ paddingTop: 10, borderTop: "1px solid var(--border)", fontWeight: 650 }}>
          <span>Total</span>
          <span className="num">{t.kcal} kcal · P {Math.round(t.p)} · C {Math.round(t.c)} · G {Math.round(t.f)}</span>
        </div>
      )}
    </div>
  );
}

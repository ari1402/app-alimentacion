import { type ReactNode, useEffect } from "react";

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";

type Pending = { id: number; label: string; resolve: (proceed: boolean) => void; timer: ReturnType<typeof setTimeout> };
const DeleteContext = createContext<(label: string) => Promise<boolean>>(async () => false);
export const useUndoDelete = () => useContext(DeleteContext);

/** Defer irreversible requests. Undo never tries to recreate IDs, references or files. */
export function UndoDeleteProvider({ children }: { children: React.ReactNode }) {
  const pending = useRef<Pending[]>([]);
  const sequence = useRef(0);
  const [items, setItems] = useState<Pending[]>([]);
  function finish(id: number, proceed: boolean) {
    const item = pending.current.find(item => item.id === id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.current = pending.current.filter(item => item.id !== id);
    setItems([...pending.current]);
    item.resolve(proceed);
  }
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (pending.current.length) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => { window.removeEventListener("beforeunload", guard); for (const item of pending.current) { clearTimeout(item.timer); item.resolve(false); } pending.current = []; };
  }, []);
  return <DeleteContext.Provider value={label => new Promise(resolve => {
    if (pending.current.some(item => item.label === label)) { resolve(false); return; }
    const id = ++sequence.current;
    pending.current.push({ id, label, resolve, timer: setTimeout(() => finish(id, true), 8000) });
    setItems([...pending.current]);
  })}>{children}<div className="undo-stack" aria-live="polite">{items.map(item => <div className="undo-toast" key={item.id}><span>{item.label} · 8 秒后删除</span><button onClick={() => finish(item.id, false)}>撤销</button></div>)}</div></DeleteContext.Provider>;
}

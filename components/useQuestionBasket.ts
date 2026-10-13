"use client";

import { useEffect, useRef, useState } from "react";
import { appendBasketItems, basketStorageKey, readBasketIds } from "../lib/question-basket";
import type { QuestionWithSource } from "../lib/types";

export function useQuestionBasket(ownerId: string, subject: string, stage: string) {
  const key = basketStorageKey(ownerId, subject, stage);
  const [snapshot, setSnapshot] = useState<{ key: string; items: QuestionWithSource[]; ready: boolean }>({ key: "", items: [], ready: false });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const items = snapshot.key === key ? snapshot.items : [];
  const ready = snapshot.key === key && snapshot.ready;

  useEffect(() => {
    let controller: AbortController | undefined;
    async function restore() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal, version = ++generation.current;
      setSnapshot(current => ({ ...current, ready: false }));
      setError(""); setMessage("");
      try {
        const raw = window.localStorage.getItem(key), ids = readBasketIds(raw);
        let questions: QuestionWithSource[] = [];
        if (ids.length) {
          const response = await fetch(`/api/exports/questions?format=json&ids=${encodeURIComponent(ids.join(","))}`, { signal, cache: "no-store" });
          const result = await response.json() as { questions?: QuestionWithSource[]; error?: string };
          if (!response.ok || !Array.isArray(result.questions)) throw new Error(result.error ?? "选题篮校验失败，请刷新重试");
          const byId = new Map(result.questions.map(question => [question.id, question]));
          questions = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
        }
        if (signal.aborted || version !== generation.current) return;
        if (window.localStorage.getItem(key) !== raw) { void restore(); return; }
        if (questions.length !== ids.length) {
          window.localStorage.setItem(key, JSON.stringify(questions.map(question => question.id)));
          setMessage(`已移除 ${ids.length - questions.length} 道已删除或不可用的题目`);
        }
        setSnapshot({ key, items: questions, ready: true });
      } catch (caught) {
        if (signal.aborted || version !== generation.current) return;
        setError(caught instanceof Error ? caught.message : "无法读取本机选题篮");
        setSnapshot({ key, items: [], ready: false });
      }
    }
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) void restore(); };
    void restore();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", restore);
    return () => { controller?.abort(); window.removeEventListener("storage", onStorage); window.removeEventListener("focus", restore); };
  }, [key]);

  function replace(next: QuestionWithSource[]) {
    try {
      window.localStorage.setItem(key, JSON.stringify(next.map(question => question.id)));
      generation.current++;
      setSnapshot({ key, items: next, ready: true }); setError(""); setMessage("");
      return true;
    } catch { setError("浏览器无法保存选题篮，请检查本机存储权限后重试"); return false; }
  }

  function add(questions: QuestionWithSource[]) {
    if (!ready) return false;
    try { return replace(appendBasketItems(items, questions)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "加入失败"); return false; }
  }

  function remove(ids: string[]) {
    try {
      const removed = new Set(ids);
      const stored = readBasketIds(window.localStorage.getItem(key));
      window.localStorage.setItem(key, JSON.stringify(stored.filter(id => !removed.has(id))));
      setSnapshot(current => ({ ...current, items: current.items.filter(question => !removed.has(question.id)) }));
    } catch { setError("题目已删除，但本机选题篮未能同步；重新打开时会再次校验"); }
  }

  return { items, ready, error, message, add, replace, remove };
}

"use client";
import { useState } from "react";
import { chooseTeachingDraft } from "../lib/teaching-draft";
import type { QuestionWithSource } from "../lib/types";

export function TeachingDraft({ subject, stage, tags, onCreate }: { subject: string; stage: string; tags: string[]; onCreate: (questions: QuestionWithSource[], title: string, message: string) => void }) {
  const [topic, setTopic] = useState("");
  const [tag, setTag] = useState("");
  const [count, setCount] = useState(12);
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function create() {
    setBusy(true); setMessage("");
    try {
      const params = new URLSearchParams({ subject, stage, pageSize: "100", page: "1", excludeRecentDays: days });
      if (topic.trim()) params.set("q", topic.trim());
      if (tag) params.set("tag", tag);
      const candidates: QuestionWithSource[] = [];
      // Bound the search; tell the teacher when the available pool cannot fill the request.
      for (let page = 1; page <= 10; page++) {
        params.set("page", String(page));
        const response = await fetch(`/api/questions?${params}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.questions)) throw new Error("暂时没能找到题目，请重试。");
        candidates.push(...data.questions);
        if (page >= (data.pagination?.pageCount ?? 1)) break;
      }
      const chosen = chooseTeachingDraft(candidates, count);
      if (!chosen.length) { setMessage("没有符合条件的题目，试试更换知识点或放宽近期使用限制。"); return; }
      const label = tag || topic.trim() || subject;
      onCreate(chosen, `${label}周测`, chosen.length < count ? `已选 ${chosen.length} 道，符合条件的题目不足 ${count} 道。` : "");
    } catch { setMessage("暂时没能生成草稿，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="teaching-draft card"><h2>出一份周测</h2><label>章节或知识点<input value={topic} onChange={e => setTopic(e.target.value)} placeholder="例如：平面向量" /></label>
    <label>知识点<select value={tag} onChange={e => setTag(e.target.value)}><option value="">全部知识点</option>{tags.map(name => <option key={name}>{name}</option>)}</select></label>
    <label>题量<input type="number" min={1} max={50} value={count} onChange={e => setCount(Number(e.target.value))} /></label>
    <label>近期使用<select value={days} onChange={e => setDays(e.target.value)}><option value="0">不限</option><option value="7">排除近 7 天</option><option value="30">排除近 30 天</option><option value="90">排除近 90 天</option></select></label>
    <button className="btn btn-primary" disabled={busy || count < 1 || count > 50} onClick={() => void create()}>{busy ? "正在选题…" : "生成周测草稿"}</button>{message && <p role="status">{message}</p>}</section>;
}

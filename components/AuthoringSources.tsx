"use client";
import { useState } from "react";
import { MAX_AUTHORING_SOURCES } from "../lib/authoring-plan";

type Source = { id: string; name: string; questionCount: number };
export function AuthoringSources({ sources, selected, onChange }: {
  sources: Source[]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState(""), [error, setError] = useState("");
  const terms = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = sources.filter(source => terms.every(term => source.name.normalize("NFKC").toLocaleLowerCase().includes(term)));
  const selectedSet = new Set(selected), visibleSet = new Set(visible.map(source => source.id));
  function update(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_AUTHORING_SOURCES) { setError(`最多选择 ${MAX_AUTHORING_SOURCES} 份资料，请缩小范围，或使用整个当前题库。`); return; }
    setError(""); onChange(unique);
  }
  return <details className="studio-source-picker">
    <summary>选择资料范围（{selected.length ? `已选 ${selected.length} 份` : "整个当前题库"}）</summary>
    <label>搜索资料名称<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="按年份、学校或资料名称查找" /></label>
    <p aria-live="polite">找到 {visible.length} / {sources.length} 份资料；{selected.length ? `已选 ${selected.length} 份，其中 ${selected.filter(id => !visibleSet.has(id)).length} 份不在当前搜索结果中。` : "未勾选时使用整个当前题库。"}</p>
    <div className="studio-source-actions">
      <button type="button" disabled={!visible.length || visible.every(source => selectedSet.has(source.id))} onClick={() => update([...selected, ...visible.map(source => source.id)])}>选中搜索结果</button>
      <button type="button" disabled={!visible.some(source => selectedSet.has(source.id))} onClick={() => update(selected.filter(id => !visibleSet.has(id)))}>取消勾选搜索结果</button>
      <button type="button" disabled={!selected.length} onClick={() => update([])}>使用整个当前题库</button>
    </div>
    {error && <p className="studio-error" role="alert">{error}</p>}
    <div className="studio-options">{visible.map(source => <label key={source.id}><input type="checkbox" checked={selectedSet.has(source.id)} onChange={event => update(event.target.checked ? [...selected, source.id] : selected.filter(id => id !== source.id))} />{source.name} · {source.questionCount} 题</label>)}</div>
  </details>;
}

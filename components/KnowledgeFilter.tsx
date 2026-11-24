"use client";

import { useId, useState } from "react";
import { BookOpen, ChevronDown, Search, X } from "lucide-react";

export function KnowledgeFilter({ tags, value, onChange }: { tags: string[]; value: string; onChange: (tag: string) => void }) {
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const filtersId = useId();
  const visible = tags.filter(tag => tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="knowledge-navigator" data-open={mobileOpen} aria-label="知识点导航">
    <header><BookOpen size={16} /><strong>知识点</strong><span>{tags.length} 项</span></header>
    <button className="knowledge-mobile-toggle" type="button" aria-expanded={mobileOpen} aria-controls={filtersId} onClick={() => setMobileOpen(!mobileOpen)}>
      <BookOpen size={15} /><strong>知识点</strong><span>{value === "全部" ? "全部知识点" : value}</span><ChevronDown size={14} />
    </button>
    <div id={filtersId} className="knowledge-controls">
      <label className="knowledge-search"><Search size={14} /><input aria-label="筛选知识点" placeholder="查找知识点" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="清空知识点搜索" onClick={() => setQuery("")}><X size={13} /></button>}</label>
      <button type="button" className="knowledge-all" aria-pressed={value === "全部"} onClick={() => onChange("全部")}>全部知识点</button>
      <nav aria-label="题目知识点">{visible.map(tag => <button type="button" key={tag} aria-pressed={value === tag} title={tag} onClick={() => onChange(tag)}>{tag}</button>)}</nav>
      {!tags.length ? <p>尚无知识点标注。审核题目时可补充，已有标签会显示在这里。</p> : !visible.length ? <p>没有匹配的知识点</p> : null}
    </div>
  </section>;
}

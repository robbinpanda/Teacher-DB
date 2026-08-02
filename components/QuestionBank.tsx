"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, ChevronDown, FilePlus2, Filter, ImageIcon, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import type { Question, QuestionType } from "../lib/types";
import { typeLabels } from "../lib/demo-data";
import { MathText } from "./MathText";

export function QuestionBank({ initialQuestions }: { initialQuestions: Question[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | QuestionType>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState("全部");
  const tags = ["全部", "基础运算", "几何图形", "函数", "统计", "综合题", "压轴题"];
  const filtered = useMemo(() => initialQuestions.filter((question) => {
    const matchesQuery = !query || question.stem.toLowerCase().includes(query.toLowerCase()) || question.tags.some((tag) => tag.includes(query));
    const matchesType = type === "all" || question.type === type;
    const matchesTag = activeTag === "全部" || question.tags.some((tag) => tag.includes(activeTag.replace("图形", "")));
    return matchesQuery && matchesType && matchesTag;
  }), [initialQuestions, query, type, activeTag]);

  function toggle(id: string) {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  const paperHref = "/papers/new?ids=" + encodeURIComponent(selected.join(","));

  return (
    <div className="page-shell bank-page">
      <header className="page-header">
        <div><span className="eyebrow"><Sparkles size={14} /> Question library</span><h1>我的题库</h1><p>已审核题目可以按题型、知识点和来源快速筛选，勾选后直接进入组卷。</p></div>
        <div className="header-actions"><button className="btn" type="button"><SlidersHorizontal size={16} /> 管理标签</button><Link className={"btn btn-primary " + (!selected.length ? "disabled-link" : "")} href={selected.length ? paperHref : "#"}><FilePlus2 size={16} /> 选中组卷 {selected.length ? "(" + selected.length + ")" : ""}</Link></div>
      </header>

      <section className="bank-stats">
        <div className="card"><span>题目总数</span><strong>1,248</strong><small>本月新增 126</small></div>
        <div className="card"><span>已审核</span><strong>1,106</strong><small>审核率 88.6%</small></div>
        <div className="card"><span>含图片</span><strong>327</strong><small>裁剪完整 309</small></div>
        <div className="card"><span>已生成试卷</span><strong>36</strong><small>最近 30 天 8 份</small></div>
      </section>

      <section className="bank-toolbar card">
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题干、知识点或来源…" /></label>
        <label className="select-box"><Filter size={15} /><select value={type} onChange={(event) => setType(event.target.value as "all" | QuestionType)}><option value="all">全部题型</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={13} /></label>
        <div className="tag-filters">{tags.map((tag) => <button key={tag} type="button" className={activeTag === tag ? "active" : ""} onClick={() => setActiveTag(tag)}>{tag}</button>)}</div>
      </section>

      <div className="bank-content">
        <div className="bank-list-head"><span>共 {filtered.length} 道匹配题目</span><button type="button" onClick={() => setSelected(selected.length === filtered.length ? [] : filtered.map((item) => item.id))}>{selected.length === filtered.length ? "取消全选" : "选择全部"}</button></div>
        <div className="question-cards">
          {filtered.map((question) => {
            const checked = selected.includes(question.id);
            return (
              <article key={question.id} className={"question-card card " + (checked ? "selected" : "")}>
                <button type="button" className="question-check" onClick={() => toggle(question.id)} aria-label="选择题目">{checked && <Check size={14} />}</button>
                <div className="question-card-main">
                  <div className="question-meta"><span className="pill gray">{typeLabels[question.type]}</span><span>{question.score} 分</span><span>九年级 · 数学</span><span>2025 二模</span>{question.assets.length > 0 && <span className="has-image"><ImageIcon size={12} /> 含题图</span>}</div>
                  <div className="question-stem"><b>{question.number}.</b><MathText text={question.stem} /></div>
                  {question.options && <div className="bank-options">{question.options.map((option) => <span key={option.key}><b>{option.key}</b><MathText text={option.content} /></span>)}</div>}
                  <div className="question-footer"><div>{question.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><button type="button">预览与编辑</button></div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {selected.length > 0 && <div className="selection-bar"><span><b>{selected.length}</b> 道题已选 · 预计 {selected.reduce((sum, id) => sum + (initialQuestions.find((item) => item.id === id)?.score ?? 0), 0)} 分</span><Link href={paperHref} className="btn btn-primary"><FilePlus2 size={15} /> 去组卷</Link></div>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, ChevronDown, Download, FilePlus2, Filter, ImageIcon, Search, Sparkles } from "lucide-react";
import type { QuestionType, QuestionWithSource } from "../lib/types";
import { typeLabels } from "../lib/question-labels";
import { MathText } from "./MathText";

type BankStats = { total: number; approved: number; withAssets: number; papers: number };

export function QuestionBank({
  initialQuestions,
  stats,
  availableTags,
}: {
  initialQuestions: QuestionWithSource[];
  stats: BankStats;
  availableTags: string[];
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | QuestionType>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState("全部");
  const [source, setSource] = useState("全部");
  const tags = ["全部", ...availableTags];
  const sources = ["全部", ...Array.from(new Set(initialQuestions.map((question) => question.source.documentName)))];
  const filtered = useMemo(() => initialQuestions.filter((question) => {
    const normalizedQuery = query.trim().toLowerCase();
    const sourceText = [question.source.documentName, question.source.subject, question.source.grade, question.source.year, question.source.examType, question.source.region, question.source.school].filter(Boolean).join(" ").toLowerCase();
    const matchesQuery = !normalizedQuery || question.stem.toLowerCase().includes(normalizedQuery) || question.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)) || sourceText.includes(normalizedQuery);
    const matchesType = type === "all" || question.type === type;
    const matchesTag = activeTag === "全部" || question.tags.includes(activeTag);
    const matchesSource = source === "全部" || question.source.documentName === source;
    return matchesQuery && matchesType && matchesTag && matchesSource;
  }), [initialQuestions, query, type, activeTag, source]);

  function toggle(id: string) {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  const paperHref = "/papers/new?ids=" + encodeURIComponent(selected.join(","));
  const exportIds = selected.length ? "?ids=" + encodeURIComponent(selected.join(",")) + "&" : "?";
  const approvalRate = stats.total ? Math.round(stats.approved / stats.total * 1000) / 10 : 0;

  return (
    <div className="page-shell bank-page">
      <header className="page-header">
        <div><span className="eyebrow"><Sparkles size={14} /> Question library</span><h1>我的题库</h1><p>已审核题目可以按题型、知识点和来源快速筛选，勾选后直接进入组卷。</p></div>
        <div className="header-actions"><a className="btn" href={`/api/exports/questions${exportIds}format=json`}><Download size={16} /> 导出 JSON</a><a className="btn" href={`/api/exports/questions${exportIds}format=markdown`}><Download size={16} /> 导出 Markdown</a><Link className={"btn btn-primary " + (!selected.length ? "disabled-link" : "")} href={selected.length ? paperHref : "#"}><FilePlus2 size={16} /> 选中组卷 {selected.length ? "(" + selected.length + ")" : ""}</Link></div>
      </header>

      <section className="bank-stats">
        <div className="card"><span>题目总数</span><strong>{stats.total}</strong><small>包含待审核与已审核</small></div>
        <div className="card"><span>已审核入库</span><strong>{stats.approved}</strong><small>审核率 {approvalRate}%</small></div>
        <div className="card"><span>含图片</span><strong>{stats.withAssets}</strong><small>可在审核页调整裁剪</small></div>
        <div className="card"><span>已生成试卷</span><strong>{stats.papers}</strong><small>保存在本机数据库</small></div>
      </section>

      <section className="bank-toolbar card">
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题干、知识点或来源…" /></label>
        <label className="select-box"><Filter size={15} /><select value={type} onChange={(event) => setType(event.target.value as "all" | QuestionType)}><option value="all">全部题型</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={13} /></label>
        <label className="select-box"><select value={source} onChange={(event) => setSource(event.target.value)}>{sources.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label>
        <div className="tag-filters">{tags.map((tag) => <button key={tag} type="button" className={activeTag === tag ? "active" : ""} onClick={() => setActiveTag(tag)}>{tag}</button>)}</div>
      </section>

      <div className="bank-content">
        <div className="bank-list-head"><span>共 {filtered.length} 道匹配题目</span>{filtered.length > 0 && <button type="button" onClick={() => setSelected(selected.length === filtered.length ? [] : filtered.map((item) => item.id))}>{selected.length === filtered.length ? "取消全选" : "选择全部"}</button>}</div>
        <div className="question-cards">
          {filtered.map((question) => {
            const checked = selected.includes(question.id);
            return (
              <article key={question.id} className={"question-card card " + (checked ? "selected" : "")}>
                <button type="button" className="question-check" onClick={() => toggle(question.id)} aria-label="选择题目">{checked && <Check size={14} />}</button>
                <div className="question-card-main">
                  <div className="question-meta"><span className="pill gray">{typeLabels[question.type]}</span><span>{question.score} 分</span><span>{question.source.grade} · {question.source.subject}</span><span>{[question.source.year, question.source.examType].filter(Boolean).join(" ") || question.source.documentName}</span>{question.assets.length > 0 && <span className="has-image"><ImageIcon size={12} /> 含题图</span>}</div>
                  <div className="question-stem"><b>{question.number}.</b><MathText text={question.stem} /></div>
                  {question.options && <div className="bank-options">{question.options.map((option) => <span key={option.key}><b>{option.key}</b><MathText text={option.content} /></span>)}</div>}
                  <div className="question-footer"><div>{question.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><Link href={`/review/${question.source.documentId}?question=${encodeURIComponent(question.id)}`}>预览与编辑</Link></div>
                </div>
              </article>
            );
          })}
        </div>
        {!filtered.length && <div className="card empty-state"><h2>没有匹配的已审核题目</h2><p>先上传试卷、完成 AI 提取并逐题审核，题目会自动出现在这里。</p><Link className="btn btn-primary" href="/">上传试卷</Link></div>}
      </div>
      {selected.length > 0 && <div className="selection-bar"><span><b>{selected.length}</b> 道题已选 · 预计 {selected.reduce((sum, id) => sum + (initialQuestions.find((item) => item.id === id)?.score ?? 0), 0)} 分</span><Link href={paperHref} className="btn btn-primary"><FilePlus2 size={15} /> 去组卷</Link></div>}
    </div>
  );
}

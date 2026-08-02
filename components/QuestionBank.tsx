"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, FilePlus2, Filter, ImageIcon, LoaderCircle, Search, Sparkles } from "lucide-react";
import type { QuestionType, QuestionWithSource } from "../lib/types";
import { typeLabels } from "../lib/question-labels";
import { MathText } from "./MathText";

type BankStats = { total: number; approved: number; withAssets: number; papers: number };
type Pagination = { page: number; pageSize: number; total: number; pageCount: number };
type SourceFacet = { id: string; name: string; year: number | null; examType: string | null; region: string | null; school: string | null };

export function QuestionBank({
  initialQuestions,
  initialPagination,
  stats,
  availableTags,
  sources,
}: {
  initialQuestions: QuestionWithSource[];
  initialPagination: Pagination;
  stats: BankStats;
  availableTags: string[];
  sources: SourceFacet[];
}) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [pagination, setPagination] = useState(initialPagination);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | QuestionType>("all");
  const [selectedScores, setSelectedScores] = useState<Record<string, number>>({});
  const [activeTag, setActiveTag] = useState("全部");
  const [source, setSource] = useState("全部");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const selected = Object.keys(selectedScores);
  const tags = ["全部", ...availableTags];

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError("");
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "30" });
        if (query.trim()) params.set("q", query.trim());
        if (type !== "all") params.set("type", type);
        if (activeTag !== "全部") params.set("tag", activeTag);
        if (source !== "全部") params.set("documentId", source);
        const response = await fetch(`/api/questions?${params}`, { signal: controller.signal });
        const result = await response.json().catch(() => ({})) as { questions?: QuestionWithSource[]; pagination?: Pagination; error?: string };
        if (!response.ok || !result.questions || !result.pagination) throw new Error(result.error ?? "题库查询失败");
        setQuestions(result.questions);
        setPagination(result.pagination);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError(error instanceof Error ? error.message : "题库查询失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTag, page, query, source, type]);

  function toggle(question: QuestionWithSource) {
    setSelectedScores((items) => {
      const next = { ...items };
      if (question.id in next) delete next[question.id];
      else next[question.id] = question.score ?? 0;
      return next;
    });
  }

  function togglePage() {
    const allSelected = questions.length > 0 && questions.every((question) => question.id in selectedScores);
    setSelectedScores((items) => {
      const next = { ...items };
      for (const question of questions) {
        if (allSelected) delete next[question.id];
        else next[question.id] = question.score ?? 0;
      }
      return next;
    });
  }

  const paperHref = "/papers/new?ids=" + encodeURIComponent(selected.join(","));
  const exportIds = selected.length ? "?ids=" + encodeURIComponent(selected.join(",")) + "&" : "?";
  const approvalRate = stats.total ? Math.round(stats.approved / stats.total * 1000) / 10 : 0;
  const allPageSelected = questions.length > 0 && questions.every((question) => question.id in selectedScores);

  return (
    <div className="page-shell bank-page">
      <header className="page-header">
        <div><span className="eyebrow"><Sparkles size={14} /> Question library</span><h1>我的题库</h1><p>已审核题目可以按题型、知识点和来源快速筛选，勾选后直接进入组卷。</p></div>
        <div className="header-actions"><a className="btn" href={`/api/exports/questions${exportIds}format=json`}><Download size={16} /> 导出 JSON</a><a className="btn" href={`/api/exports/questions${exportIds}format=markdown`}><Download size={16} /> 导出 Markdown</a><Link className={"btn btn-primary " + (!selected.length ? "disabled-link" : "")} href={selected.length ? paperHref : "#"}><FilePlus2 size={16} /> 选中组卷 {selected.length ? `(${selected.length})` : ""}</Link></div>
      </header>

      <section className="bank-stats">
        <div className="card"><span>题目总数</span><strong>{stats.total}</strong><small>包含待审核与已审核</small></div>
        <div className="card"><span>已审核入库</span><strong>{stats.approved}</strong><small>审核率 {approvalRate}%</small></div>
        <div className="card"><span>含图片</span><strong>{stats.withAssets}</strong><small>可在审核页调整裁剪</small></div>
        <div className="card"><span>已生成试卷</span><strong>{stats.papers}</strong><small>保存在本机数据库</small></div>
      </section>

      <section className="bank-toolbar card">
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索题干、答案、知识点、学校或地区…" /></label>
        <label className="select-box"><Filter size={15} /><select value={type} onChange={(event) => { setType(event.target.value as "all" | QuestionType); setPage(1); }}><option value="all">全部题型</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={13} /></label>
        <label className="select-box"><select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="全部">全部来源</option>{sources.map((item) => <option key={item.id} value={item.id}>{[item.year, item.region, item.school, item.examType, item.name].filter(Boolean).join(" · ")}</option>)}</select><ChevronDown size={13} /></label>
        <div className="tag-filters">{tags.map((tag) => <button key={tag} type="button" className={activeTag === tag ? "active" : ""} onClick={() => { setActiveTag(tag); setPage(1); }}>{tag}</button>)}</div>
      </section>

      <div className="bank-content">
        <div className="bank-list-head"><span>{loading ? <><LoaderCircle size={12} className="spin" /> 查询中…</> : `共 ${pagination.total} 道匹配题目`}</span>{questions.length > 0 && <button type="button" onClick={togglePage}>{allPageSelected ? "取消本页" : "选择本页"}</button>}</div>
        {searchError && <p className="form-error">{searchError}</p>}
        <div className="question-cards">
          {questions.map((question) => {
            const checked = question.id in selectedScores;
            return (
              <article key={question.id} className={"question-card card " + (checked ? "selected" : "")}>
                <button type="button" className="question-check" onClick={() => toggle(question)} aria-label="选择题目">{checked && <Check size={14} />}</button>
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
        {!questions.length && !loading && <div className="card empty-state"><h2>没有匹配的已审核题目</h2><p>调整筛选条件，或先上传试卷并完成逐题审核。</p><Link className="btn btn-primary" href="/">上传试卷</Link></div>}
        {pagination.pageCount > 1 && <nav className="bank-pagination" aria-label="题库分页"><button type="button" disabled={pagination.page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={14} /> 上一页</button><span>第 {pagination.page} / {pagination.pageCount} 页</span><button type="button" disabled={pagination.page >= pagination.pageCount || loading} onClick={() => setPage((value) => Math.min(pagination.pageCount, value + 1))}>下一页 <ChevronRight size={14} /></button></nav>}
      </div>
      {selected.length > 0 && <div className="selection-bar"><span><b>{selected.length}</b> 道题已选 · 预计 {Object.values(selectedScores).reduce((sum, score) => sum + score, 0)} 分</span><Link href={paperHref} className="btn btn-primary"><FilePlus2 size={15} /> 去组卷</Link></div>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  ImageIcon,
  LoaderCircle,
  Pencil,
  Search,
  X,
} from "lucide-react";
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
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({});
  const [expandedIds, setExpandedIds] = useState<Record<string, true>>({});
  const [activeTag, setActiveTag] = useState("全部");
  const [source, setSource] = useState("全部");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const selected = Object.keys(selectedIds);
  const tags = ["全部", ...availableTags];

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError("");
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "50" });
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
    setSelectedIds((items) => {
      const next = { ...items };
      if (question.id in next) delete next[question.id];
      else next[question.id] = true;
      return next;
    });
  }

  function toggleExpanded(questionId: string) {
    setExpandedIds((items) => {
      const next = { ...items };
      if (questionId in next) delete next[questionId];
      else next[questionId] = true;
      return next;
    });
  }

  function togglePage() {
    const allSelected = questions.length > 0 && questions.every((question) => question.id in selectedIds);
    setSelectedIds((items) => {
      const next = { ...items };
      for (const question of questions) {
        if (allSelected) delete next[question.id];
        else next[question.id] = true;
      }
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setType("all");
    setActiveTag("全部");
    setSource("全部");
    setPage(1);
  }

  const paperHref = "/papers/new?ids=" + encodeURIComponent(selected.join(","));
  const exportIds = selected.length ? "?ids=" + encodeURIComponent(selected.join(",")) + "&" : "?";
  const allPageSelected = questions.length > 0 && questions.every((question) => question.id in selectedIds);
  const activeFilterCount = Number(Boolean(query.trim())) + Number(type !== "all") + Number(activeTag !== "全部") + Number(source !== "全部");

  return (
    <div className="page-shell bank-page">
      <header className="bank-page-header">
        <div className="bank-title-row">
          <h1>题库</h1>
          <div className="bank-summary" aria-label="题库概况">
            <span><b>{stats.approved}</b> 道已入库</span>
            <i />
            <span>{stats.withAssets} 道含图</span>
            <i />
            <span>{stats.papers} 份试卷</span>
          </div>
        </div>
        <div className="bank-header-actions">
          <details className="export-menu">
            <summary className="btn"><Download size={15} /> 导出 <ChevronDown size={13} /></summary>
            <div>
              <a href={`/api/exports/questions${exportIds}format=markdown`}>导出 Markdown</a>
              <a href={`/api/exports/questions${exportIds}format=json`}>导出 JSON</a>
              <small>{selected.length ? `仅导出已选 ${selected.length} 道题` : "导出当前题库全部题目"}</small>
            </div>
          </details>
          {selected.length > 0 && <Link className="btn btn-primary" href={paperHref}><FilePlus2 size={16} /> 用已选题组卷</Link>}
        </div>
      </header>

      <section className="bank-toolbar card" aria-label="筛选题目">
        <label className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索题干、答案、知识点或来源" />
          {query && <button type="button" onClick={() => { setQuery(""); setPage(1); }} aria-label="清空搜索"><X size={14} /></button>}
        </label>
        <label className="select-box"><span>题型</span><select value={type} onChange={(event) => { setType(event.target.value as "all" | QuestionType); setPage(1); }}><option value="all">全部</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={13} /></label>
        <label className="select-box source-select"><span>来源</span><select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="全部">全部来源</option>{sources.map((item) => <option key={item.id} value={item.id}>{[item.year, item.region, item.school, item.examType, item.name].filter(Boolean).join(" · ")}</option>)}</select><ChevronDown size={13} /></label>
        {activeFilterCount > 0 && <button className="clear-filter" type="button" onClick={clearFilters}><X size={13} /> 清除 {activeFilterCount} 项筛选</button>}
        {tags.length > 1 && <div className="tag-filters" aria-label="知识点筛选">{tags.map((tag) => <button key={tag} type="button" className={activeTag === tag ? "active" : ""} onClick={() => { setActiveTag(tag); setPage(1); }}>{tag}</button>)}</div>}
      </section>

      <div className="bank-content">
        <div className="bank-list-head">
          <div>
            <button type="button" className={allPageSelected ? "active" : ""} onClick={togglePage} disabled={!questions.length} aria-label={allPageSelected ? "取消选择当前页" : "选择当前页"}>{allPageSelected && <Check size={12} />}</button>
            <span>{loading ? <><LoaderCircle size={12} className="spin" /> 查询中…</> : `${pagination.total} 道题`}</span>
            {!loading && pagination.pageCount > 1 && <small>第 {pagination.page} / {pagination.pageCount} 页</small>}
          </div>
          <span>默认精简展示，点击展开查看选项与答案</span>
        </div>
        {searchError && <p className="form-error">{searchError}</p>}
        <div className={"question-cards " + (loading ? "loading" : "")}>
          {questions.map((question) => {
            const checked = question.id in selectedIds;
            const expanded = question.id in expandedIds;
            const sourceLabel = [question.source.year, question.source.region, question.source.school, question.source.examType].filter(Boolean).join(" · ") || question.source.documentName;
            return (
              <article key={question.id} className={"question-card " + (checked ? "selected " : "") + (expanded ? "expanded" : "")}>
                <button type="button" className="question-check" onClick={() => toggle(question)} aria-label={`${checked ? "取消选择" : "选择"}第 ${question.number} 题`}>{checked && <Check size={13} />}</button>
                <div className="question-card-main">
                  <div className="question-meta">
                    <span className="pill gray">{typeLabels[question.type]}</span>
                    <span>{question.source.grade} · {question.source.subject}</span>
                    <span className="source-label" title={question.source.documentName}>{sourceLabel}</span>
                    {question.assets.length > 0 && <span className="has-image"><ImageIcon size={12} /> 含图</span>}
                    {question.tags.slice(0, 3).map((tag) => <span className="question-tag" key={tag}>#{tag}</span>)}
                    {question.tags.length > 3 && <span className="question-tag">+{question.tags.length - 3}</span>}
                  </div>
                  <button type="button" className="question-stem" onClick={() => toggleExpanded(question.id)} aria-expanded={expanded}>
                    <b>{question.number}.</b>
                    <span className="question-stem-text"><MathText text={question.stem} /></span>
                  </button>
                  {expanded && <div className="question-details">
                    {question.options?.length ? <div className="bank-options">{question.options.map((option) => <span key={option.key}><b>{option.key}</b><MathText text={option.content} /></span>)}</div> : null}
                    {(question.answer || question.analysis) && <div className="answer-preview">
                      {question.answer && <div><b>答案</b><MathText text={question.answer} /></div>}
                      {question.analysis && <div><b>解析</b><MathText text={question.analysis} /></div>}
                    </div>}
                  </div>}
                </div>
                <div className="question-actions">
                  <button type="button" className="row-action expand-action" onClick={() => toggleExpanded(question.id)} aria-expanded={expanded}>{expanded ? "收起" : "展开"}<ChevronDown size={13} /></button>
                  {question.source.sourceRemoved ? <span className="source-removed">来源已删除</span> : <Link className="row-action" href={`/review/${question.source.documentId}?question=${encodeURIComponent(question.id)}`}><Pencil size={13} /> 编辑</Link>}
                </div>
              </article>
            );
          })}
        </div>
        {!questions.length && !loading && <div className="card empty-state"><h2>没有匹配的已审核题目</h2><p>清除部分筛选条件，或先上传试卷并完成逐题审核。</p>{activeFilterCount > 0 ? <button className="btn btn-primary" type="button" onClick={clearFilters}>清除筛选</button> : <Link className="btn btn-primary" href="/">上传试卷</Link>}</div>}
        {pagination.pageCount > 1 && <nav className="bank-pagination" aria-label="题库分页"><button type="button" disabled={pagination.page <= 1 || loading} onClick={() => { setPage((value) => Math.max(1, value - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}><ChevronLeft size={14} /> 上一页</button><span>第 {pagination.page} / {pagination.pageCount} 页</span><button type="button" disabled={pagination.page >= pagination.pageCount || loading} onClick={() => { setPage((value) => Math.min(pagination.pageCount, value + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>下一页 <ChevronRight size={14} /></button></nav>}
      </div>
      {selected.length > 0 && <div className="selection-bar"><span><b>{selected.length}</b> 道题已选 <button type="button" onClick={() => setSelectedIds({})}>清空</button></span><Link href={paperHref} className="btn btn-primary"><FilePlus2 size={15} /> 去组卷</Link></div>}
    </div>
  );
}

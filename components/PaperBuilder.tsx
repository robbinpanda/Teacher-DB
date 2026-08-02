"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, Eye, GripVertical, LoaderCircle, Settings2, Sparkles, Trash2 } from "lucide-react";
import type { QuestionWithSource } from "../lib/types";
import { typeLabels } from "../lib/question-labels";
import { PaperPrintable } from "./PaperPrintable";

export function PaperBuilder({ questions, initialIds }: { questions: QuestionWithSource[]; initialIds: string[] }) {
  const initial = initialIds.length ? initialIds : questions.slice(0, 5).map((question) => question.id);
  const [ids, setIds] = useState(initial);
  const [title, setTitle] = useState("九年级数学专题训练卷");
  const [subtitle, setSubtitle] = useState("满分：100 分　建议用时：90 分钟");
  const [showAnswers, setShowAnswers] = useState(false);
  const [paperId] = useState(() => crypto.randomUUID());
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">("saving");
  const [downloading, setDownloading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const selected = useMemo(() => ids.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as QuestionWithSource[], [ids, questions]);
  const totalScore = selected.reduce((sum, question) => sum + (question.score ?? 0), 0);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/papers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: paperId, title, subtitle, questionIds: ids, settings: { showAnswers } }),
        });
        if (!response.ok) throw new Error("保存失败");
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [ids, paperId, showAnswers, subtitle, title]);

  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    setSaveState("saving");
    setIds((items) => {
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function smartFill() {
    const selectedSet = new Set(ids);
    const preferredTags = new Set(selected.flatMap((question) => question.tags));
    const candidates = questions
      .filter((question) => !selectedSet.has(question.id))
      .sort((a, b) => {
        const aMatches = a.tags.filter((tag) => preferredTags.has(tag)).length;
        const bMatches = b.tags.filter((tag) => preferredTags.has(tag)).length;
        return bMatches - aMatches || (b.score ?? 0) - (a.score ?? 0);
      });
    let score = totalScore;
    const additions: string[] = [];
    for (const question of candidates) {
      if (score >= 100) break;
      additions.push(question.id);
      score += question.score ?? 0;
    }
    setSaveState("saving");
    setIds((items) => [...items, ...additions]);
  }

  async function downloadPdf() {
    setDownloading(true);
    setPdfError("");
    setSaveState("saving");
    try {
      const saveResponse = await fetch("/api/papers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: paperId, title, subtitle, questionIds: ids, settings: { showAnswers } }),
      });
      if (!saveResponse.ok) throw new Error("试卷保存失败，无法生成 PDF");
      setSaveState("saved");
      const response = await fetch(`/api/papers/${encodeURIComponent(paperId)}/pdf${showAnswers ? "?answers=1" : ""}`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? "PDF 生成失败");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "_") || "试卷"}${showAnswers ? "-含答案" : ""}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "PDF 生成失败");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="paper-builder">
      <header className="paper-topbar no-print">
        <div><Link href="/bank" className="icon-btn"><ArrowLeft size={17} /></Link><span><strong>智能组卷</strong><small>从题库生成可打印试卷</small></span></div>
        <div className="paper-save-state"><Check size={13} /> {saveState === "saving" ? "正在保存…" : saveState === "error" ? "保存失败" : "已自动保存"}</div>
        <div className="header-actions"><button type="button" className="btn btn-small" onClick={() => { setSaveState("saving"); setShowAnswers(!showAnswers); }}><Eye size={14} /> {showAnswers ? "隐藏答案" : "答案预览"}</button><button type="button" className="btn btn-dark btn-small" disabled={downloading} onClick={() => void downloadPdf()}>{downloading ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} {downloading ? "正在生成…" : "下载 PDF"}</button></div>
      </header>
      <div className="paper-workspace">
        <aside className="paper-settings no-print">
          <div className="section-title"><div><h2>试卷设置</h2><p>{selected.length} 道题 · 当前 {totalScore} 分</p></div><Settings2 size={17} /></div>
          <label className="edit-field"><span>试卷标题</span><input value={title} onChange={(event) => { setSaveState("saving"); setTitle(event.target.value); }} /></label>
          <label className="edit-field"><span>副标题</span><input value={subtitle} onChange={(event) => { setSaveState("saving"); setSubtitle(event.target.value); }} /></label>
          {pdfError && <p className="form-error">{pdfError}</p>}
          <div className="paper-summary">
            <div><span>目标分值</span><strong>100</strong></div><div><span>当前分值</span><strong>{totalScore}</strong></div><div><span>预计页数</span><strong>4</strong></div>
          </div>
          <div className="smart-fill"><Sparkles size={17} /><div><strong>智能补齐试卷</strong><p>优先按当前知识点补入未选题目，直到达到 100 分。</p></div><button type="button" onClick={smartFill} disabled={totalScore >= 100 || ids.length >= questions.length}>补齐</button></div>
          <div className="paper-order-title"><span>题目顺序</span><b>拖动或使用箭头排序</b></div>
          <div className="paper-order">
            {selected.map((question, index) => (
              <div key={question.id}><GripVertical size={14} /><span>{index + 1}</span><p><strong>{typeLabels[question.type]}</strong><small>{question.tags[0]} · {question.score} 分</small></p><button type="button" onClick={() => move(index, -1)}><ArrowUp size={12} /></button><button type="button" onClick={() => move(index, 1)}><ArrowDown size={12} /></button><button type="button" onClick={() => { setSaveState("saving"); setIds((items) => items.filter((id) => id !== question.id)); }}><Trash2 size={12} /></button></div>
            ))}
          </div>
          <Link href="/bank" className="btn add-from-bank">＋ 从题库继续选题</Link>
        </aside>

        <main className="paper-preview-wrap">
          <PaperPrintable title={title} subtitle={subtitle} questions={selected} includeAnswers={showAnswers} />
          {!selected.length && <Link className="btn btn-primary no-print" href="/bank">返回题库选题</Link>}
        </main>
      </div>
    </div>
  );
}

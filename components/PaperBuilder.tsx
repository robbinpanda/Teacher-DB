"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Eye, GripVertical, Printer, Settings2, Sparkles, Trash2 } from "lucide-react";
import type { QuestionWithSource } from "../lib/types";
import { typeLabels } from "../lib/question-labels";
import { MathText } from "./MathText";

export function PaperBuilder({ questions, initialIds }: { questions: QuestionWithSource[]; initialIds: string[] }) {
  const initial = initialIds.length ? initialIds : questions.slice(0, 5).map((question) => question.id);
  const [ids, setIds] = useState(initial);
  const [title, setTitle] = useState("九年级数学专题训练卷");
  const [subtitle, setSubtitle] = useState("满分：100 分　建议用时：90 分钟");
  const [showAnswers, setShowAnswers] = useState(false);
  const [paperId] = useState(() => crypto.randomUUID());
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">("saving");
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

  return (
    <div className="paper-builder">
      <header className="paper-topbar no-print">
        <div><Link href="/bank" className="icon-btn"><ArrowLeft size={17} /></Link><span><strong>智能组卷</strong><small>从题库生成可打印试卷</small></span></div>
        <div className="paper-save-state"><Check size={13} /> {saveState === "saving" ? "正在保存…" : saveState === "error" ? "保存失败" : "已自动保存"}</div>
        <div className="header-actions"><button type="button" className="btn btn-small" onClick={() => { setSaveState("saving"); setShowAnswers(!showAnswers); }}><Eye size={14} /> {showAnswers ? "隐藏答案" : "答案预览"}</button><button type="button" className="btn btn-dark btn-small" onClick={() => window.print()}><Printer size={14} /> 打印 / 保存 PDF</button></div>
      </header>
      <div className="paper-workspace">
        <aside className="paper-settings no-print">
          <div className="section-title"><div><h2>试卷设置</h2><p>{selected.length} 道题 · 当前 {totalScore} 分</p></div><Settings2 size={17} /></div>
          <label className="edit-field"><span>试卷标题</span><input value={title} onChange={(event) => { setSaveState("saving"); setTitle(event.target.value); }} /></label>
          <label className="edit-field"><span>副标题</span><input value={subtitle} onChange={(event) => { setSaveState("saving"); setSubtitle(event.target.value); }} /></label>
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
          <article className="paper-sheet">
            <header><h1>{title}</h1><p>{subtitle}</p><div><span>姓名：____________</span><span>班级：____________</span><span>得分：____________</span></div></header>
            <section className="paper-notice"><strong>注意事项</strong><p>1．答题前请填写姓名和班级；2．请在规定区域内作答，写出必要的计算或证明过程。</p></section>
            {selected.map((question, index) => (
              <section className="paper-question" key={question.id}>
                <div className="paper-question-head"><b>{index + 1}．</b><span>（本题 {question.score} 分）</span></div>
                <div className="paper-question-stem"><MathText text={question.stem} /></div>
                {question.options && <div className="paper-options">{question.options.map((option) => <span key={option.key}>{option.key}．<MathText text={option.content} /></span>)}</div>}
                {question.assets[0]?.url && <Image src={question.assets[0].url} width={320} height={220} className="paper-crop-placeholder" alt={question.assets[0].label} unoptimized />}
                {question.type === "fill" ? <div className="answer-line" /> : question.type === "answer" ? <div className="answer-space" /> : null}
                {showAnswers && <div className="paper-answer"><strong>答案：</strong><MathText text={question.answer} /><br /><strong>解析：</strong><MathText text={question.analysis} /></div>}
              </section>
            ))}
            {!selected.length && <section className="empty-state"><h2>还没有选入题目</h2><p>请先在题库中勾选已审核题目，再进入组卷。</p><Link className="btn btn-primary no-print" href="/bank">返回题库选题</Link></section>}
            <footer>— 拾题 · 教师题库助手生成 —</footer>
          </article>
        </main>
      </div>
    </div>
  );
}

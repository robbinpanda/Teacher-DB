"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { MathText } from "./MathText";
import { AnalysisWithImages } from "./AnalysisWithImages";
import type { AuthoringDocument as Document } from "../server/services/authoring-output";
import type { QuestionWithSource } from "../lib/types";

const figure = (asset: QuestionWithSource["assets"][number]) => asset.url ? <figure key={asset.id}><Image src={asset.url} alt={asset.label} width={asset.width ?? 600} height={asset.height ?? 400} unoptimized loading="eager" /><figcaption>{asset.label}</figcaption></figure> : null;
export function AuthoringDocument({ document, answers = false }: { document: Document; answers?: boolean }) {
  const root = useRef<HTMLElement>(null), [readyDocument, setReadyDocument] = useState<Document | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([window.document.fonts.ready, ...Array.from(root.current?.querySelectorAll("img") ?? []).map(image => image.decode())])
      .then(() => { if (active) setReadyDocument(document); }).catch(() => { /* Export must fail visibly if an image cannot load. */ });
    return () => { active = false; };
  }, [document]);
  let number = 0;
  const numbered = document.chapters.map(chapter => ({ chapter, items: chapter.content?.items.map(item => ({ ...item, number: ++number })) ?? [] }));
  return <article ref={root} className={`authoring-document printable-paper${document.kind === "book" || document.chapters.length > 3 ? " authoring-book" : ""}`} data-pagination-ready={readyDocument === document ? "true" : "false"}>
    <style>{"@page { size: A4 portrait; margin: 16mm; }"}</style>
    <header className="authoring-document-header"><p>{document.kind === "book" ? "校本教材 / 教辅" : document.kind === "paper" ? "练习试卷" : "专题讲义"} · {answers ? "教师版" : "学生版"}</p><h1>{document.title}</h1><p>{document.plan.audience} · 建议用时 {document.plan.estimatedMinutes} 分钟</p><p>{document.plan.approach}</p></header>
    {document.status !== "completed" && <p className="authoring-draft-notice">预览草稿：仍有章节未完成或未经教师采用，不作为正式作品导出。</p>}
    <nav className="authoring-contents" aria-label="作品目录"><h2>学习路线</h2><ol>{document.chapters.map(chapter => <li key={chapter.id}><a href={`#chapter-${chapter.id}`}>{chapter.plan.title}</a></li>)}</ol></nav>
    {numbered.map(({ chapter, items }) => <section className="authoring-document-chapter" id={`chapter-${chapter.id}`} key={chapter.id}>
      <h2>{chapter.position + 1}. {chapter.plan.title}</h2><ul>{chapter.plan.objectives.map((objective, i) => <li key={i}>{objective}</li>)}</ul>
      {!chapter.content ? <p>本章尚未完成。</p> : <>
        <p><MathText text={chapter.content.introduction} /></p>
        {chapter.content.knowledge.map(knowledge => <section className="authoring-lesson" key={knowledge.id}><h3>{knowledge.title}</h3><p><MathText text={knowledge.explanation} /></p>
          {knowledge.formulas.map((formula, i) => <div className="authoring-formula" key={i}><MathText text={`$${formula.latex}$`} /><p>适用条件：<MathText text={formula.conditions} /></p></div>)}
          <h4>方法与步骤</h4><p><MathText text={knowledge.method} /></p>
          {knowledge.misconceptions.map((item, i) => <p key={i}><strong>易错：</strong><MathText text={item.mistake} /><br /><strong>纠正：</strong><MathText text={item.correction} /></p>)}
        </section>)}
        {items.map((item, index) => {
          const question = chapter.content!.questions.find(question => question.id === item.questionId)!;
          const slot = chapter.plan.slots[item.slotIndex], example = slot.role === "example";
          return <div key={question.id} className={index === items.length - 1 ? "authoring-exercise-end" : undefined}><section className={`authoring-exercise${!example && question.type === "answer" ? " authoring-writing-exercise" : ""}`}>
            <h3>{example ? "例题" : slot.role === "assessment" ? "检测" : "练习"} {item.number}{slot.score > 0 ? `（${slot.score} 分）` : ""}</h3>
            <p><MathText text={question.stem} /></p>{question.options?.map(option => <p key={option.key}>{option.key}. <MathText text={option.content} /></p>)}
            {question.assets.filter(asset => asset.role === "question").map(figure)}
            <small>来源：{question.source.documentName} · 原第 {question.number} 题</small>
            {example ? <div className="authoring-worked-solution"><h4>例题详解</h4><p><MathText text={question.answer} /></p><AnalysisWithImages text={item.teachingExplanation || question.analysis} assets={question.assets} renderAsset={figure} /></div>
              : question.type === "answer" && <div className="authoring-writing-space" aria-label={`练习 ${item.number} 作答区`} />}
          </section>{index === items.length - 1 && <section className="authoring-summary"><h3>本章回顾</h3><p><MathText text={chapter.content!.conclusion} /></p></section>}</div>;
        })}
        {chapter.content.gaps.length > 0 && <p>本章仍有选题缺口，需补充后使用。</p>}
        {!items.length && <section className="authoring-summary"><h3>本章回顾</h3><p><MathText text={chapter.content.conclusion} /></p></section>}
      </>}
    </section>)}
    {answers && <section className="authoring-answer-appendix"><h2>练习答案与解析</h2>{numbered.map(({ chapter, items }) => <section key={chapter.id}><h3>{chapter.plan.title}</h3>{items.filter(item => chapter.plan.slots[item.slotIndex].role !== "example").map(item => {
      const question = chapter.content!.questions.find(question => question.id === item.questionId)!;
      return <section className="authoring-answer" key={question.id}><h4>第 {item.number} 题</h4><p><MathText text={question.answer} /></p><AnalysisWithImages text={item.teachingExplanation || question.analysis} assets={question.assets} renderAsset={figure} /></section>;
    })}</section>)}</section>}
  </article>;
}

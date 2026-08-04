import Image from "next/image";
import type { QuestionWithSource } from "../lib/types";
import { MathText } from "./MathText";

export function PaperPrintable({
  title,
  subtitle,
  questions,
  includeAnswers = false,
}: {
  title: string;
  subtitle: string;
  questions: QuestionWithSource[];
  includeAnswers?: boolean;
}) {
  return (
    <article className="paper-sheet printable-paper">
      <header><h1>{title}</h1><p>{subtitle}</p><div><span>姓名：____________</span><span>班级：____________</span></div></header>
      <section className="paper-notice"><strong>注意事项</strong><p>1．答题前请填写姓名和班级；2．请在规定区域内作答，写出必要的计算或证明过程。</p></section>
      {questions.map((question, index) => (
        <section className="paper-question" key={question.id}>
          <div className="paper-question-head"><b>{index + 1}．</b></div>
          <div className="paper-question-stem"><MathText text={question.stem} /></div>
          {question.options && <div className="paper-options">{question.options.map((option) => <span key={option.key}>{option.key}．<MathText text={option.content} /></span>)}</div>}
          {question.assets.filter((asset) => asset.url).map((asset) => (
            <Image key={asset.id} src={asset.url!} width={420} height={280} className="paper-crop-placeholder" alt={asset.label} unoptimized />
          ))}
          {question.type === "fill" ? <div className="answer-line" /> : question.type === "answer" ? <div className="answer-space" /> : null}
          {includeAnswers && <div className="paper-answer printable-answer"><strong>答案：</strong><MathText text={question.answer} /><br /><strong>解析：</strong><MathText text={question.analysis} /></div>}
        </section>
      ))}
      {!questions.length && <section className="empty-state"><h2>空白试卷</h2><p>这份试卷还没有题目。</p></section>}
      <footer>— 拾题 · 教师题库助手生成 —</footer>
    </article>
  );
}

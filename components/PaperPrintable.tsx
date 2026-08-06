import Image from "next/image";
import type { QuestionWithSource } from "../lib/types";
import { defaultAssetLayout, scoreForQuestion, type PaperSettings } from "../lib/paper-templates";
import { MathText } from "./MathText";

export function PaperPrintable({ title, subtitle, questions, settings, includeAnswers }: {
  title: string;
  subtitle: string;
  questions: QuestionWithSource[];
  settings: PaperSettings;
  includeAnswers?: boolean;
}) {
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  let globalIndex = 0;
  return (
    <article className={`paper-sheet printable-paper ${settings.compact ? "compact" : "formal"}`}>
      <header>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        <div>{settings.infoFields.map((field) => <span key={field}>{field}：____________</span>)}</div>
      </header>
      {settings.notice.trim() && <section className="paper-notice"><strong>注意事项</strong>{settings.notice.split("\n").map((line) => <p key={line}>{line}</p>)}</section>}
      {settings.sections.map((section) => {
        const sectionQuestions = section.questionIds.map((id) => questionMap.get(id)).filter(Boolean) as QuestionWithSource[];
        if (!sectionQuestions.length) return null;
        return (
          <section className="paper-section" key={section.id}>
            <div className="paper-section-heading"><h2>{section.title}</h2><span>{section.scoreDetail}</span></div>
            {sectionQuestions.map((question, sectionIndex) => {
              const questionNumber = ++globalIndex;
              const score = scoreForQuestion(section, sectionIndex);
              const beforeAssets = question.assets.filter((asset) => (settings.assetLayouts[asset.id]?.placement ?? "after-stem") === "after-stem");
              const afterAssets = question.assets.filter((asset) => settings.assetLayouts[asset.id]?.placement === "before-answer");
              const renderAsset = (asset: QuestionWithSource["assets"][number]) => {
                if (!asset.url) return null;
                const layout = settings.assetLayouts[asset.id] ?? defaultAssetLayout(questionNumber);
                return (
                  <figure className="paper-asset-stage" key={asset.id}>
                    <div style={{ transform: `translate(${layout.x}px, ${layout.y}px) scale(${layout.scale / 100})` }}>
                      <Image src={asset.url} width={asset.width ?? 420} height={asset.height ?? 280} alt={layout.caption} unoptimized />
                      <figcaption>{layout.caption || `第 ${questionNumber} 题的图片`}</figcaption>
                    </div>
                  </figure>
                );
              };
              return (
                <section className="paper-question" key={question.id}>
                  <div className="paper-question-line"><b>{questionNumber}.</b><div className="paper-question-stem"><MathText text={question.stem} /></div>{score > 0 && <span className="paper-question-score">（{score} 分）</span>}</div>
                  {beforeAssets.map(renderAsset)}
                  {question.options && <div className="paper-options">{question.options.map((option) => <span key={option.key}><b>{option.key}.</b> <MathText text={option.content} /></span>)}</div>}
                  {afterAssets.map(renderAsset)}
                  {question.type === "fill" ? <div className="answer-line" /> : question.type === "answer" ? <div className="answer-space" style={{ height: settings.answerSpaces[question.id] ?? 180 }} /> : null}
                  {includeAnswers && <div className="paper-answer printable-answer"><strong>答案：</strong><MathText text={question.answer || "未录入"} /><br /><strong>解析：</strong><MathText text={question.analysis || "未录入"} /></div>}
                </section>
              );
            })}
          </section>
        );
      })}
      {!questions.length && <section className="empty-state"><h2>空白试卷</h2><p>这份试卷还没有题目。</p></section>}
      <footer>— 拾题 · 教师题库助手生成 —</footer>
    </article>
  );
}

import Image from "next/image";
import type { CSSProperties } from "react";
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
  const style = settings.style;
  const pageDimensions = style.pageSize === "A3" ? [297, 420] : [210, 297];
  const [pageWidth, pageHeight] = style.orientation === "landscape" ? [...pageDimensions].reverse() : pageDimensions;
  const paperVariables = {
    "--paper-width": `${pageWidth}mm`,
    "--paper-height": `${pageHeight}mm`,
    "--paper-margin-top": `${style.marginTop}mm`,
    "--paper-margin-right": `${style.marginRight}mm`,
    "--paper-margin-bottom": `${style.marginBottom}mm`,
    "--paper-margin-left": `${style.marginLeft}mm`,
    "--paper-body-font": style.bodyFont,
    "--paper-body-size": `${style.bodySize}pt`,
    "--paper-line-height": style.lineHeight,
    "--paper-letter-spacing": `${style.letterSpacing}em`,
    "--paper-title-font": style.titleFont,
    "--paper-title-size": `${style.titleSize}pt`,
    "--paper-title-weight": style.titleWeight,
    "--paper-title-spacing": `${style.titleLetterSpacing}em`,
    "--paper-subtitle-size": `${style.subtitleSize}pt`,
    "--paper-section-title-size": `${style.sectionTitleSize}pt`,
    "--paper-question-gap": `${style.questionGap}mm`,
    "--paper-section-gap": `${style.sectionGap}mm`,
    "--paper-option-columns": style.optionColumns,
    "--paper-column-count": style.columns,
  } as CSSProperties;
  let globalIndex = 0;
  return (
    <>
    <style>{`@page { size: ${pageWidth}mm ${pageHeight}mm; margin: 0; }`}</style>
    <article className={`paper-sheet printable-paper ${settings.compact ? "compact" : "formal"} header-${style.headerStyle} info-${style.infoStyle} notice-${style.noticeStyle} score-${style.scoreStyle} title-${style.titleAlign}${style.showBindingLine ? " has-binding-line" : ""}`} style={paperVariables}>
      {style.showBindingLine && <aside className="paper-binding-line"><span>{style.bindingText}</span></aside>}
      <header className="paper-document-header">
        {style.headerStyle === "exam" && style.headerLabel && <div className="paper-exam-label">{style.headerLabel}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {style.headerStyle !== "none" && <div className="paper-candidate-info">{settings.infoFields.map((field) => <span key={field}>{field}：____________</span>)}</div>}
      </header>
      {settings.notice.trim() && style.noticeStyle !== "hidden" && <section className="paper-notice"><strong>注意事项</strong>{settings.notice.split("\n").map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</section>}
      <div className="paper-section-list">{settings.sections.map((section) => {
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
                  <div className="paper-question-line"><b>{questionNumber}.</b><div className="paper-question-stem"><MathText text={question.stem} />{score > 0 && style.scoreStyle === "inline" && <span className="paper-question-score inline">（{score} 分）</span>}</div>{score > 0 && style.scoreStyle === "right" && <span className="paper-question-score">（{score} 分）</span>}</div>
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
      })}</div>
      {!questions.length && <section className="empty-state"><h2>空白试卷</h2><p>这份试卷还没有题目。</p></section>}
      {(style.footerText || style.showPageNumber) && <footer><span>{style.footerText}</span>{style.showPageNumber && <b>第 1 页</b>}</footer>}
    </article>
    </>
  );
}

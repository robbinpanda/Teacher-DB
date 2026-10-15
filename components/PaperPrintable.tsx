import Image from "next/image";
import type { CSSProperties } from "react";
import type { QuestionWithSource } from "../lib/types";
import { defaultAssetLayout, questionStemHasAnswerBlank, scoreForQuestion, type PaperSettings } from "../lib/paper-templates";
import { AnalysisWithImages } from "./AnalysisWithImages";
import { MathText } from "./MathText";
import { PaperPages, type PaperBlock } from "./PaperPages";

const chineseDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function chineseNumber(value: number) {
  if (value < 10) return chineseDigits[value];
  if (value < 20) return `十${value % 10 ? chineseDigits[value % 10] : ""}`;
  if (value < 100) return `${chineseDigits[Math.floor(value / 10)]}十${value % 10 ? chineseDigits[value % 10] : ""}`;
  return String(value);
}

function formatQuestionNumber(value: number, format: PaperSettings["style"]["questionNumberStyle"]) {
  if (format === "parenthesized") return `（${value}）`;
  if (format === "chinese") return `${chineseNumber(value)}、`;
  return `${value}.`;
}

export function PaperPrintable({ title, subtitle, questions, settings, includeAnswers, preserveQuestionNumbers = false }: {
  title: string;
  subtitle: string;
  questions: QuestionWithSource[];
  settings: PaperSettings;
  includeAnswers?: boolean;
  preserveQuestionNumbers?: boolean;
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
    "--paper-title-line-height": style.titleLineHeight,
    "--paper-title-gap": `${style.titleMarginBottom}mm`,
    "--paper-subtitle-size": `${style.subtitleSize}pt`,
    "--paper-subtitle-weight": style.subtitleWeight,
    "--paper-subtitle-spacing": `${style.subtitleLetterSpacing}em`,
    "--paper-section-title-size": `${style.sectionTitleSize}pt`,
    "--paper-section-title-weight": style.sectionTitleWeight,
    "--paper-section-heading-gap": `${style.sectionHeadingGap}mm`,
    "--paper-section-heading-padding": `${style.sectionHeadingPadding}mm`,
    "--paper-header-bottom-spacing": `${style.headerBottomSpacing}mm`,
    "--paper-candidate-size": `${style.candidateInfoSize}pt`,
    "--paper-candidate-gap": `${style.candidateInfoGap}mm`,
    "--paper-notice-margin-top": `${style.noticeMarginTop}mm`,
    "--paper-notice-margin-bottom": `${style.noticeMarginBottom}mm`,
    "--paper-question-gap": `${style.questionGap}mm`,
    "--paper-section-gap": `${style.sectionGap}mm`,
    "--paper-question-number-size": `${style.questionNumberSize}pt`,
    "--paper-question-indent": `${style.questionIndent}mm`,
    "--paper-option-columns": style.optionColumns,
    "--paper-column-count": style.columns,
  } as CSSProperties;
  const header = <>
      <header className="paper-document-header">
        {style.headerStyle === "exam" && style.headerLabel && <div className="paper-exam-label">{style.headerLabel}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {style.headerStyle !== "none" && <div className="paper-candidate-info">{settings.infoFields.map((field) => <span key={field}>{field}：____________</span>)}</div>}
      </header>
      {settings.notice.trim() && style.noticeStyle !== "hidden" && <section className="paper-notice"><strong>注意事项</strong>{settings.notice.split("\n").map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</section>}
      {!questions.length && <section className="empty-state"><h2>空白试卷</h2><p>这份试卷还没有题目。</p></section>}
  </>;
  let globalIndex = 0;
  const blocks: PaperBlock[] = settings.sections.flatMap((section) => {
        const sectionQuestions = section.questionIds.map((id) => questionMap.get(id)).filter(Boolean) as QuestionWithSource[];
        return sectionQuestions.map((question, sectionIndex) => {
              const questionNumber = ++globalIndex;
              const number = preserveQuestionNumbers && question.number ? question.number : String(questionNumber);
              const score = scoreForQuestion(section, sectionIndex);
              const questionAssets = question.assets.filter((asset) => asset.role === "question");
              const beforeAssets = questionAssets.filter((asset) => (settings.assetLayouts[asset.id]?.placement ?? "after-stem") === "after-stem");
              const afterAssets = questionAssets.filter((asset) => settings.assetLayouts[asset.id]?.placement === "before-answer");
              const renderAsset = (asset: QuestionWithSource["assets"][number], answerAsset = false) => {
                if (!asset.url) return null;
                const layout = settings.assetLayouts[asset.id] ?? defaultAssetLayout(questionNumber);
                return (
                  <figure className="paper-asset-stage" key={asset.id}>
                    <div style={{ transform: `translate(${layout.x}px, ${layout.y}px) scale(${layout.scale / 100})` }}>
                      <Image src={asset.url} width={asset.width ?? 420} height={asset.height ?? 280} alt={layout.caption} unoptimized loading="eager" />
                      <figcaption>{answerAsset ? asset.label || `第 ${questionNumber} 题答案图` : layout.caption || `第 ${questionNumber} 题的图片`}</figcaption>
                    </div>
                  </figure>
                );
              };
              const configuredBlank = settings.answerSpaces[question.id];
              return {
                id: question.id, number, sectionId: section.id,
                answer: question.type === "answer" && !includeAnswers,
                minimumBlank: Number.isFinite(configuredBlank) ? Math.max(0, configuredBlank) : 0,
                heading: <div className="paper-section-heading"><h2>{section.title}</h2><span>{section.scoreDetail}</span></div>,
                content: <>
                  <div className="paper-question-line"><b>{preserveQuestionNumbers ? `${number}.` : formatQuestionNumber(questionNumber, style.questionNumberStyle)}</b><div className="paper-question-stem"><MathText text={question.stem} />{question.type === "fill" && !questionStemHasAnswerBlank(question.stem) && <span className="paper-fill-blank" aria-label="答题空格" />}{score > 0 && style.scoreStyle === "inline" && <span className="paper-question-score inline">（{score} 分）</span>}</div>{score > 0 && style.scoreStyle === "right" && <span className="paper-question-score">（{score} 分）</span>}</div>
                  {beforeAssets.map((asset) => renderAsset(asset))}
                  {question.options && <div className="paper-options">{question.options.map((option) => <span key={option.key}><b>{option.key}.</b> <MathText text={option.content} /></span>)}</div>}
                  {afterAssets.map((asset) => renderAsset(asset))}
                  {includeAnswers && <div className="paper-answer printable-answer"><strong>答案：</strong><MathText text={question.answer || "未录入"} /><br /><strong>解析：</strong><AnalysisWithImages text={question.analysis || "未录入"} assets={question.assets} renderAsset={(asset) => renderAsset(asset, true)} /></div>}
                </>,
              };
        });
  });
  const className = `${settings.compact ? "compact" : "formal"} header-${style.headerStyle} divider-${style.headerDivider} section-divider-${style.sectionDivider} info-${style.infoStyle} notice-${style.noticeStyle} score-${style.scoreStyle} title-${style.titleAlign}${style.titleItalic ? " title-italic" : ""}${style.titleUnderline ? " title-underline" : ""}${style.showBindingLine ? " has-binding-line" : ""}`;
  return <>
    <style>{`@page { size: ${pageWidth}mm ${pageHeight}mm; margin: 0; }`}</style>
    <PaperPages className={className} variables={paperVariables} header={header} blocks={blocks}
      binding={style.showBindingLine && <aside className="paper-binding-line"><span>{style.bindingText}</span></aside>}
      footerText={style.footerText} showPageNumber={style.showPageNumber} columns={style.columns} />
  </>;
}

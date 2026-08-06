"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Code2, Download, Eye, GripVertical, ImageIcon, LayoutTemplate, ListPlus, LoaderCircle, Plus, Save, Settings2, Trash2, X } from "lucide-react";
import type { QuestionWithSource } from "../lib/types";
import { stageFromGrade, stageLabel } from "../lib/education-taxonomy";
import { defaultAssetLayout, paperStyleFromTemplate, paperStyleToLatex, sectionsFromTemplate, type PaperAssetLayout, type PaperSection, type PaperSettings, type PaperStyleConfig, type PaperTemplate } from "../lib/paper-templates";
import { typeLabels } from "../lib/question-labels";
import { useEducationScope } from "./AppShell";
import { PaperPrintable } from "./PaperPrintable";

function orderedIds(sections: PaperSection[]) { return sections.flatMap((section) => section.questionIds); }

const paperFonts = [
  { value: '"Songti SC", SimSun, serif', label: "宋体（正式试卷）" },
  { value: '"Kaiti SC", KaiTi, serif', label: "楷体" },
  { value: '"Heiti SC", SimHei, sans-serif', label: "黑体" },
  { value: 'Arial, "Microsoft YaHei", sans-serif', label: "Arial / 微软雅黑" },
];

function MetricControl({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  return <label className="template-metric"><span>{label}<b>{value}{unit}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

export function PaperBuilder({ questions, initialIds, templates: initialTemplates, initialPaper }: { questions: QuestionWithSource[]; initialIds: string[]; templates: PaperTemplate[]; initialPaper?: { id: string; title: string; subtitle: string; settings: PaperSettings } }) {
  const scope = useEducationScope();
  const paperSubject = initialPaper?.settings.subject ?? scope.subject;
  const paperStage = initialPaper?.settings.stage ?? scope.stage;
  const inScope = useMemo(() => questions.filter((question) => question.source.subject === paperSubject && stageFromGrade(question.source.grade) === paperStage), [paperStage, paperSubject, questions]);
  const initialQuestions = initialIds.length ? initialIds.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as QuestionWithSource[] : inScope.slice(0, 5);
  const [templates, setTemplates] = useState(initialTemplates);
  const availableTemplates = useMemo(() => templates.filter((template) => (template.subject === "*" || template.subject === paperSubject) && (template.subject === "*" || template.stage === paperStage)), [paperStage, paperSubject, templates]);
  const preferredTemplate = availableTemplates.find((template) => template.id === `preset-${paperStage}-math-exam`) ?? availableTemplates[0] ?? initialTemplates[0];
  const [templateId, setTemplateId] = useState(initialPaper?.settings.templateId ?? preferredTemplate?.id ?? "preset-homework");
  const initialTemplate = initialTemplates.find((template) => template.id === templateId) ?? initialTemplates[0];
  const [sections, setSections] = useState<PaperSection[]>(() => initialPaper?.settings.sections ?? sectionsFromTemplate(initialTemplate, initialQuestions));
  const [title, setTitle] = useState(initialPaper?.title ?? `${stageLabel(paperStage)}${paperSubject}练习卷`);
  const [subtitle, setSubtitle] = useState(initialPaper?.subtitle ?? "建议用时 90 分钟");
  const [showAnswers, setShowAnswers] = useState(initialPaper?.settings.showAnswers ?? false);
  const [notice, setNotice] = useState(initialPaper?.settings.notice ?? initialTemplate.config.notice);
  const [infoFields, setInfoFields] = useState(initialPaper?.settings.infoFields ?? initialTemplate.config.infoFields);
  const [compact, setCompact] = useState(initialPaper?.settings.compact ?? initialTemplate.config.compact);
  const [paperStyle, setPaperStyle] = useState<PaperStyleConfig>(() => initialPaper?.settings.style ?? paperStyleFromTemplate(initialTemplate));
  const [templateStudioOpen, setTemplateStudioOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<"page" | "type" | "header" | "question" | "structure" | "latex">("page");
  const [answerSpaces, setAnswerSpaces] = useState<Record<string, number>>(initialPaper?.settings.answerSpaces ?? {});
  const [assetLayouts, setAssetLayouts] = useState<Record<string, PaperAssetLayout>>(initialPaper?.settings.assetLayouts ?? {});
  const [paperId] = useState(() => initialPaper?.id ?? crypto.randomUUID());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(initialPaper || initialQuestions.length ? "saving" : "idle");
  const [downloading, setDownloading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [customName, setCustomName] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const ids = useMemo(() => orderedIds(sections), [sections]);
  const selected = useMemo(() => ids.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as QuestionWithSource[], [ids, questions]);
  const settings: PaperSettings = useMemo(() => ({ templateId, subject: paperSubject, stage: paperStage, showAnswers, answerSpaces, assetLayouts, sections, notice, infoFields, compact, style: paperStyle }), [answerSpaces, assetLayouts, compact, infoFields, notice, paperStage, paperStyle, paperSubject, sections, showAnswers, templateId]);
  const typeCount = new Set(selected.map((question) => question.type)).size;

  useEffect(() => {
    if (!initialPaper && !ids.length) return;
    const timer = window.setTimeout(async () => {
      try {
        const scoreById = Object.fromEntries(sections.flatMap((section) => section.questionIds.map((id, index) => [id, section.scoreSequence?.[index] ?? section.defaultScore])));
        const response = await fetch("/api/papers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: paperId, title, subtitle, questionIds: ids, scores: scoreById, settings }) });
        if (!response.ok) throw new Error("保存失败");
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [ids, initialPaper, paperId, sections, settings, subtitle, title]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (initialPaper) return;
      const candidates = templates.filter((template) => (template.subject === "*" || template.subject === paperSubject) && (template.subject === "*" || template.stage === paperStage));
      const currentValid = candidates.some((template) => template.id === templateId);
      if (currentValid) return;
      const nextTemplate = candidates.find((template) => template.id === `preset-${paperStage}-math-exam`) ?? candidates[0];
      if (!nextTemplate) return;
      setTemplateId(nextTemplate.id);
      setNotice(nextTemplate.config.notice);
      setInfoFields(nextTemplate.config.infoFields);
      setCompact(nextTemplate.config.compact);
      setPaperStyle(paperStyleFromTemplate(nextTemplate));
      setSections(sectionsFromTemplate(nextTemplate, selected));
      setTitle(`${stageLabel(paperStage)}${paperSubject}练习卷`);
      setSaveState("saving");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialPaper, paperStage, paperSubject, selected, templateId, templates]);

  useEffect(() => {
    if (!templateStudioOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTemplateStudioOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [templateStudioOpen]);

  function applyTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setTemplateId(id); setNotice(template.config.notice); setInfoFields(template.config.infoFields); setCompact(template.config.compact); setPaperStyle(paperStyleFromTemplate(template));
    setSections(sectionsFromTemplate(template, selected)); setSaveState("saving");
  }

  function move(sectionId: string, index: number, offset: number) {
    setSections((items) => items.map((section) => {
      if (section.id !== sectionId) return section;
      const target = index + offset;
      if (target < 0 || target >= section.questionIds.length) return section;
      const questionIds = [...section.questionIds];
      [questionIds[index], questionIds[target]] = [questionIds[target], questionIds[index]];
      return { ...section, questionIds };
    })); setSaveState("saving");
  }

  function moveToSection(questionId: string, targetId: string) {
    setSections((items) => items.map((section) => ({ ...section, questionIds: section.id === targetId ? [...section.questionIds.filter((id) => id !== questionId), questionId] : section.questionIds.filter((id) => id !== questionId) })));
  }

  function smartFill() {
    const selectedSet = new Set(ids);
    const candidates = inScope.filter((question) => !selectedSet.has(question.id)).slice(0, Math.max(0, 12 - ids.length));
    setSections((items) => {
      const next = items.map((item) => ({ ...item, questionIds: [...item.questionIds] }));
      for (const question of candidates) (next.find((section) => section.acceptedTypes.includes(question.type)) ?? next.at(-1))?.questionIds.push(question.id);
      return next;
    }); setSaveState("saving");
  }

  function patchAsset(assetId: string, patch: Partial<PaperAssetLayout>, questionNumber: number) {
    setAssetLayouts((items) => ({ ...items, [assetId]: { ...(items[assetId] ?? defaultAssetLayout(questionNumber)), ...patch } }));
    setSaveState("saving");
  }

  function patchPaperStyle(patch: Partial<PaperStyleConfig>) {
    setPaperStyle((current) => ({ ...current, ...patch }));
    setSaveState("saving");
  }

  function openTemplateStudio() {
    const activeTemplate = templates.find((template) => template.id === templateId);
    if (!customName.trim()) setCustomName(activeTemplate?.isPreset === false ? activeTemplate.name : `${activeTemplate?.name ?? `${paperSubject}试卷`} · 自定义`);
    setTemplateMessage("");
    setTemplateStudioOpen(true);
  }

  async function saveTemplate() {
    if (!customName.trim()) { setTemplateMessage("请先填写模板名称"); return false; }
    const activeTemplate = templates.find((template) => template.id === templateId);
    const templateSections = sections.map((section) => ({ id: section.id, title: section.title, scoreDetail: section.scoreDetail, acceptedTypes: section.acceptedTypes, defaultScore: section.defaultScore, scoreSequence: section.scoreSequence }));
    const response = await fetch("/api/paper-templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: activeTemplate?.isPreset === false ? activeTemplate.id : undefined, name: customName, subject: paperSubject, stage: paperStage, config: { notice, infoFields, compact, style: paperStyle, sections: templateSections } }) });
    const result = await response.json().catch(() => ({})) as { id?: string; error?: string; templates?: PaperTemplate[] };
    if (!response.ok) { setTemplateMessage(result.error ?? "模板保存失败"); return false; }
    if (result.templates) setTemplates(result.templates);
    if (result.id) setTemplateId(result.id);
    setTemplateMessage("模板已保存并应用");
    return true;
  }

  async function saveTemplateAndClose() {
    if (await saveTemplate()) setTemplateStudioOpen(false);
  }

  async function downloadPdf() {
    setDownloading(true); setPdfError("");
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      const response = await fetch(`/api/papers/${encodeURIComponent(paperId)}/pdf${showAnswers ? "?answers=1" : ""}`);
      if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error ?? "PDF 生成失败"); }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "_") || "试卷"}${showAnswers ? "-含答案" : ""}.pdf`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) { setPdfError(error instanceof Error ? error.message : "PDF 生成失败"); } finally { setDownloading(false); }
  }

  let rowNumber = 0;
  const visibleSaveState = !initialPaper && !ids.length ? "idle" : saveState;
  return (
    <div className="paper-builder">
      <header className="paper-topbar no-print">
        <div><Link href={initialPaper ? "/papers" : "/bank"} className="icon-btn"><ArrowLeft size={17} /></Link><span><strong>{initialPaper ? "编辑试卷" : "组卷"}</strong><small>{stageLabel(paperStage)} · {paperSubject}</small></span></div>
        <Link href="/papers" title="打开试卷库" className={`paper-save-state ${visibleSaveState}`}><Check size={13} /> {visibleSaveState === "idle" ? "选题后存入试卷库" : visibleSaveState === "saving" ? "正在存入试卷库…" : visibleSaveState === "error" ? "保存失败" : "已存入试卷库"}</Link>
        <div className="header-actions"><button type="button" className="btn btn-small" onClick={() => { setSaveState("saving"); setShowAnswers(!showAnswers); }}><Eye size={14} /> {showAnswers ? "隐藏答案" : "答案预览"}</button><button type="button" className="btn btn-dark btn-small" disabled={downloading} onClick={() => void downloadPdf()}>{downloading ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} {downloading ? "正在生成…" : "下载 PDF"}</button></div>
      </header>
      <div className="paper-workspace">
        <aside className="paper-settings no-print">
          <div className="section-title"><div><h2>试卷模板与版式</h2><p>板块、分值、题图均可调整</p></div><Settings2 size={17} /></div>
          <label className="edit-field"><span>套用模板</span><select value={templateId} onChange={(event) => applyTemplate(event.target.value)}>{availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.isPreset ? " · 预制" : " · 我的"}</option>)}</select></label>
          <label className="edit-field"><span>试卷标题</span><input value={title} onChange={(event) => { setTitle(event.target.value); setSaveState("saving"); }} /></label>
          <label className="edit-field"><span>副标题</span><input value={subtitle} onChange={(event) => { setSubtitle(event.target.value); setSaveState("saving"); }} /></label>
          <button type="button" className={`template-studio-trigger${templateStudioOpen ? " active" : ""}`} aria-expanded={templateStudioOpen} onClick={openTemplateStudio}><span><LayoutTemplate size={17} /><i><strong>模板排版设置</strong><small>偶尔调整一次，保存后持续复用</small></i></span><ChevronRight size={15} /></button>
          {templateStudioOpen && <><button type="button" className="template-studio-backdrop" aria-label="关闭模板编辑器" onClick={() => setTemplateStudioOpen(false)} /><section className="template-studio" role="dialog" aria-modal="true" aria-labelledby="template-studio-title">
            <header className="template-studio-head"><div><span><LayoutTemplate size={18} /></span><div><h2 id="template-studio-title">模板排版设置</h2><p>精细调整一次，保存后可直接套用到之后的试卷</p></div></div><button type="button" aria-label="关闭模板编辑器" onClick={() => setTemplateStudioOpen(false)}><X size={18} /></button></header>
            <div className="template-studio-body">
              <nav className="template-studio-tabs" aria-label="模板设置分类">
                {([ ["page", "页面布局"], ["type", "文字标题"], ["header", "卷首信息"], ["question", "题目样式"], ["structure", "大题结构"], ["latex", "LaTeX"] ] as const).map(([id, label]) => <button type="button" key={id} className={studioTab === id ? "active" : ""} onClick={() => setStudioTab(id)}>{label}<ChevronRight size={13} /></button>)}
              </nav>
              <div className="template-studio-controls">
                {studioTab === "page" && <div className="template-studio-panel">
                  <div className="template-panel-heading"><strong>页面布局</strong><span>纸张、方向、分栏与留白</span></div>
                  <div className="template-control-grid"><label><span>纸张</span><select value={paperStyle.pageSize} onChange={(event) => patchPaperStyle({ pageSize: event.target.value as PaperStyleConfig["pageSize"] })}><option>A4</option><option>A3</option></select></label><label><span>方向</span><select value={paperStyle.orientation} onChange={(event) => patchPaperStyle({ orientation: event.target.value as PaperStyleConfig["orientation"] })}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label><label><span>分栏</span><select value={paperStyle.columns} onChange={(event) => patchPaperStyle({ columns: Number(event.target.value) as 1 | 2 })}><option value="1">单栏</option><option value="2">双栏</option></select></label></div>
                  <p className="template-group-title">页边距</p>
                  <MetricControl label="上边距" value={paperStyle.marginTop} min={5} max={45} step={1} unit="mm" onChange={(marginTop) => patchPaperStyle({ marginTop })} />
                  <MetricControl label="下边距" value={paperStyle.marginBottom} min={5} max={45} step={1} unit="mm" onChange={(marginBottom) => patchPaperStyle({ marginBottom })} />
                  <MetricControl label="左边距" value={paperStyle.marginLeft} min={5} max={45} step={1} unit="mm" onChange={(marginLeft) => patchPaperStyle({ marginLeft })} />
                  <MetricControl label="右边距" value={paperStyle.marginRight} min={5} max={45} step={1} unit="mm" onChange={(marginRight) => patchPaperStyle({ marginRight })} />
                  <label className="template-toggle"><input type="checkbox" checked={paperStyle.showBindingLine} onChange={(event) => patchPaperStyle({ showBindingLine: event.target.checked })} /><span>显示密封 / 装订线<small>适用于中高考正式卷面</small></span></label>
                  {paperStyle.showBindingLine && <label className="template-wide-field"><span>装订线文字</span><input value={paperStyle.bindingText} onChange={(event) => patchPaperStyle({ bindingText: event.target.value })} /></label>}
                </div>}
                {studioTab === "type" && <div className="template-studio-panel">
                  <div className="template-panel-heading"><strong>文字与标题</strong><span>正文、主标题、副标题和大题标题分别设置</span></div>
                  <p className="template-group-title">正文</p>
                  <label className="template-wide-field"><span>正文字体</span><select value={paperStyle.bodyFont} onChange={(event) => patchPaperStyle({ bodyFont: event.target.value })}>{paperFonts.map((font) => <option value={font.value} key={font.value}>{font.label}</option>)}</select></label>
                  <MetricControl label="正文字号" value={paperStyle.bodySize} min={7} max={18} step={0.5} unit="pt" onChange={(bodySize) => patchPaperStyle({ bodySize })} />
                  <MetricControl label="正文行距" value={paperStyle.lineHeight} min={1} max={3} step={0.05} unit="×" onChange={(lineHeight) => patchPaperStyle({ lineHeight })} />
                  <MetricControl label="正文字间距" value={paperStyle.letterSpacing} min={-0.1} max={0.5} step={0.01} unit="em" onChange={(letterSpacing) => patchPaperStyle({ letterSpacing })} />
                  <p className="template-group-title">主标题</p>
                  <label className="template-wide-field"><span>主标题字体</span><select value={paperStyle.titleFont} onChange={(event) => patchPaperStyle({ titleFont: event.target.value })}>{paperFonts.map((font) => <option value={font.value} key={font.value}>{font.label}</option>)}</select></label>
                  <div className="template-control-grid"><label><span>粗细</span><select value={paperStyle.titleWeight} onChange={(event) => patchPaperStyle({ titleWeight: Number(event.target.value) as PaperStyleConfig["titleWeight"] })}><option value="400">常规</option><option value="500">中等</option><option value="700">粗体</option></select></label><label><span>对齐</span><select value={paperStyle.titleAlign} onChange={(event) => patchPaperStyle({ titleAlign: event.target.value as PaperStyleConfig["titleAlign"] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label></div>
                  <div className="template-inline-toggles"><label><input type="checkbox" checked={paperStyle.titleItalic} onChange={(event) => patchPaperStyle({ titleItalic: event.target.checked })} /> 斜体</label><label><input type="checkbox" checked={paperStyle.titleUnderline} onChange={(event) => patchPaperStyle({ titleUnderline: event.target.checked })} /> 下划线</label></div>
                  <MetricControl label="主标题字号" value={paperStyle.titleSize} min={12} max={42} step={1} unit="pt" onChange={(titleSize) => patchPaperStyle({ titleSize })} />
                  <MetricControl label="主标题行高" value={paperStyle.titleLineHeight} min={0.9} max={2.2} step={0.05} unit="×" onChange={(titleLineHeight) => patchPaperStyle({ titleLineHeight })} />
                  <MetricControl label="主标题字间距" value={paperStyle.titleLetterSpacing} min={-0.1} max={0.5} step={0.01} unit="em" onChange={(titleLetterSpacing) => patchPaperStyle({ titleLetterSpacing })} />
                  <MetricControl label="标题下方间距" value={paperStyle.titleMarginBottom} min={0} max={20} step={0.5} unit="mm" onChange={(titleMarginBottom) => patchPaperStyle({ titleMarginBottom })} />
                  <p className="template-group-title">副标题</p>
                  <div className="template-control-grid"><label><span>粗细</span><select value={paperStyle.subtitleWeight} onChange={(event) => patchPaperStyle({ subtitleWeight: Number(event.target.value) as PaperStyleConfig["subtitleWeight"] })}><option value="400">常规</option><option value="500">中等</option><option value="700">粗体</option></select></label></div>
                  <MetricControl label="副标题字号" value={paperStyle.subtitleSize} min={7} max={20} step={0.5} unit="pt" onChange={(subtitleSize) => patchPaperStyle({ subtitleSize })} />
                  <MetricControl label="副标题字间距" value={paperStyle.subtitleLetterSpacing} min={-0.1} max={0.5} step={0.01} unit="em" onChange={(subtitleLetterSpacing) => patchPaperStyle({ subtitleLetterSpacing })} />
                  <p className="template-group-title">大题标题</p>
                  <div className="template-control-grid"><label><span>粗细</span><select value={paperStyle.sectionTitleWeight} onChange={(event) => patchPaperStyle({ sectionTitleWeight: Number(event.target.value) as PaperStyleConfig["sectionTitleWeight"] })}><option value="400">常规</option><option value="500">中等</option><option value="700">粗体</option></select></label></div>
                  <MetricControl label="大题标题字号" value={paperStyle.sectionTitleSize} min={8} max={24} step={0.5} unit="pt" onChange={(sectionTitleSize) => patchPaperStyle({ sectionTitleSize })} />
                  <MetricControl label="大题标题下方间距" value={paperStyle.sectionHeadingGap} min={0} max={20} step={0.5} unit="mm" onChange={(sectionHeadingGap) => patchPaperStyle({ sectionHeadingGap })} />
                  <MetricControl label="标题分隔线内距" value={paperStyle.sectionHeadingPadding} min={0} max={10} step={0.5} unit="mm" onChange={(sectionHeadingPadding) => patchPaperStyle({ sectionHeadingPadding })} />
                </div>}
                {studioTab === "header" && <div className="template-studio-panel">
                  <div className="template-panel-heading"><strong>卷首信息</strong><span>标题区、考生信息和注意事项的结构与留白</span></div>
                  <div className="template-control-grid"><label><span>表头形式</span><select value={paperStyle.headerStyle} onChange={(event) => patchPaperStyle({ headerStyle: event.target.value as PaperStyleConfig["headerStyle"] })}><option value="exam">正式考试</option><option value="classic">标准</option><option value="minimal">简洁</option><option value="none">无表头</option></select></label><label><span>分隔线</span><select value={paperStyle.headerDivider} onChange={(event) => patchPaperStyle({ headerDivider: event.target.value as PaperStyleConfig["headerDivider"] })}><option value="none">无</option><option value="single">单线</option><option value="double">双线</option></select></label><label><span>信息栏</span><select value={paperStyle.infoStyle} onChange={(event) => patchPaperStyle({ infoStyle: event.target.value as PaperStyleConfig["infoStyle"] })}><option value="line">横线式</option><option value="boxed">方格式</option></select></label></div>
                  {paperStyle.headerStyle === "exam" && <label className="template-wide-field"><span>卷首标识</span><input value={paperStyle.headerLabel} placeholder="如：绝密★启用前" onChange={(event) => patchPaperStyle({ headerLabel: event.target.value })} /></label>}
                  <MetricControl label="标题区下方间距" value={paperStyle.headerBottomSpacing} min={0} max={20} step={0.5} unit="mm" onChange={(headerBottomSpacing) => patchPaperStyle({ headerBottomSpacing })} />
                  <MetricControl label="考生信息字号" value={paperStyle.candidateInfoSize} min={7} max={18} step={0.5} unit="pt" onChange={(candidateInfoSize) => patchPaperStyle({ candidateInfoSize })} />
                  <MetricControl label="副标题与信息栏间距" value={paperStyle.candidateInfoGap} min={0} max={20} step={0.5} unit="mm" onChange={(candidateInfoGap) => patchPaperStyle({ candidateInfoGap })} />
                  <label className="template-wide-field"><span>考生信息栏（顿号分隔）</span><input value={infoFields.join("、")} onChange={(event) => setInfoFields(event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))} /></label>
                  <p className="template-group-title">注意事项</p>
                  <label className="template-wide-field"><span>显示形式</span><select value={paperStyle.noticeStyle} onChange={(event) => patchPaperStyle({ noticeStyle: event.target.value as PaperStyleConfig["noticeStyle"] })}><option value="boxed">边框</option><option value="plain">无边框</option><option value="hidden">隐藏</option></select></label>
                  <MetricControl label="注意事项上间距" value={paperStyle.noticeMarginTop} min={0} max={20} step={0.5} unit="mm" onChange={(noticeMarginTop) => patchPaperStyle({ noticeMarginTop })} />
                  <MetricControl label="注意事项下间距" value={paperStyle.noticeMarginBottom} min={0} max={20} step={0.5} unit="mm" onChange={(noticeMarginBottom) => patchPaperStyle({ noticeMarginBottom })} />
                  <label className="template-wide-field"><span>注意事项内容</span><textarea rows={4} value={notice} onChange={(event) => setNotice(event.target.value)} /></label>
                  <label className="template-wide-field"><span>页脚文字</span><input value={paperStyle.footerText} onChange={(event) => patchPaperStyle({ footerText: event.target.value })} /></label>
                  <label className="template-toggle"><input type="checkbox" checked={paperStyle.showPageNumber} onChange={(event) => patchPaperStyle({ showPageNumber: event.target.checked })} /><span>显示页码</span></label>
                </div>}
                {studioTab === "question" && <div className="template-studio-panel">
                  <div className="template-panel-heading"><strong>题目样式</strong><span>题号、题目留白、选项与分值</span></div>
                  <div className="template-control-grid"><label><span>题号格式</span><select value={paperStyle.questionNumberStyle} onChange={(event) => patchPaperStyle({ questionNumberStyle: event.target.value as PaperStyleConfig["questionNumberStyle"] })}><option value="decimal">1.</option><option value="parenthesized">（1）</option><option value="chinese">一、</option></select></label><label><span>选项排列</span><select value={paperStyle.optionColumns} onChange={(event) => patchPaperStyle({ optionColumns: Number(event.target.value) as PaperStyleConfig["optionColumns"] })}><option value="1">每行 1 项</option><option value="2">每行 2 项</option><option value="4">每行 4 项</option></select></label><label><span>分值位置</span><select value={paperStyle.scoreStyle} onChange={(event) => patchPaperStyle({ scoreStyle: event.target.value as PaperStyleConfig["scoreStyle"] })}><option value="right">题目右侧</option><option value="inline">题干末尾</option><option value="hidden">隐藏</option></select></label></div>
                  <MetricControl label="题号字号" value={paperStyle.questionNumberSize} min={7} max={20} step={0.5} unit="pt" onChange={(questionNumberSize) => patchPaperStyle({ questionNumberSize })} />
                  <MetricControl label="题号占位宽度" value={paperStyle.questionIndent} min={3} max={20} step={0.5} unit="mm" onChange={(questionIndent) => patchPaperStyle({ questionIndent })} />
                  <MetricControl label="题目间距" value={paperStyle.questionGap} min={0} max={24} step={1} unit="mm" onChange={(questionGap) => patchPaperStyle({ questionGap })} />
                  <MetricControl label="大题间距" value={paperStyle.sectionGap} min={0} max={30} step={1} unit="mm" onChange={(sectionGap) => patchPaperStyle({ sectionGap })} />
                  <label className="template-toggle"><input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} /><span>紧凑排版<small>减少默认作答留白，适合日常练习</small></span></label>
                </div>}
                {studioTab === "latex" && <div className="template-studio-panel template-latex-panel"><div className="template-panel-heading"><strong>LaTeX 参数映射</strong><span>可视化参数自动转换为可移植的排版语义</span></div><div className="latex-heading"><Code2 size={16} /><span><strong>实时生成</strong><small>页面与字体参数同时驱动浏览器预览和 PDF 打印</small></span></div><pre>{paperStyleToLatex(paperStyle)}</pre><p>公式内容仍使用 LaTeX 语法，模板设置负责控制整张试卷的版面。</p></div>}
                {studioTab === "structure" && <div className="template-studio-panel"><div className="template-panel-heading"><strong>大题结构</strong><span>定义标题、分值规则和题型归属</span></div><p className="template-panel-note">模板保存后可重复用于任何试卷。</p><div className="paper-section-editor">
                  {sections.map((section) => <div key={section.id}><input aria-label="板块标题" value={section.title} onChange={(event) => setSections((items) => items.map((item) => item.id === section.id ? { ...item, title: event.target.value } : item))} /><input aria-label="板块分值说明" value={section.scoreDetail} onChange={(event) => setSections((items) => items.map((item) => item.id === section.id ? { ...item, scoreDetail: event.target.value } : item))} /><label>默认每题 <input type="number" min="0" max="100" value={section.defaultScore} onChange={(event) => setSections((items) => items.map((item) => item.id === section.id ? { ...item, defaultScore: Number(event.target.value) } : item))} /> 分</label></div>)}
                  <button type="button" className="text-button" onClick={() => setSections((items) => [...items, { id: crypto.randomUUID(), title: `${items.length + 1}、自定义板块`, scoreDetail: "请填写分值说明", acceptedTypes: ["single", "multiple", "fill", "answer"], defaultScore: 5, questionIds: [] }])}><Plus size={13} /> 添加板块</button>
                </div></div>}
              </div>
              <aside className="template-studio-preview"><header><span>实时预览</span><small>{selected.length > 5 ? "展示前 5 题" : "调整立即生效"}</small></header><div><PaperPrintable title={title} subtitle={subtitle} questions={selected.slice(0, 5)} settings={settings} includeAnswers={showAnswers} /></div></aside>
            </div>
            <footer className="template-studio-footer"><label><span>模板名称</span><input placeholder="为这套模板命名" value={customName} onChange={(event) => setCustomName(event.target.value)} /></label><div>{templateMessage && <span className="template-studio-message">{templateMessage}</span>}<button type="button" className="btn" onClick={() => setTemplateStudioOpen(false)}>关闭</button><button type="button" className="btn btn-primary" onClick={() => void saveTemplateAndClose()}><Save size={14} /> 保存并应用</button></div></footer>
          </section></>}
          <div className="paper-summary"><div><span>题目</span><strong>{selected.length}</strong></div><div><span>题型</span><strong>{typeCount}</strong></div><div><span>板块</span><strong>{sections.length}</strong></div></div>
          <div className="smart-fill"><ListPlus size={17} /><div><strong>按当前范围补齐</strong><p>只从 {stageLabel(paperStage)}{paperSubject}题库补题，默认补到 12 道。</p></div><button type="button" onClick={smartFill} disabled={ids.length >= 12 || ids.length >= inScope.length}>补齐</button></div>
          {templateMessage && <p className="form-note">{templateMessage}</p>}{pdfError && <p className="form-error">{pdfError}</p>}
          <div className="paper-order-title"><span>题目与题图</span><b>可换板块、排序和调整题图</b></div>
          <div className="paper-order">
            {sections.flatMap((section) => section.questionIds.map((id, index) => {
              const question = questions.find((item) => item.id === id); if (!question) return null; const questionNumber = ++rowNumber;
              return <div className="paper-order-item" key={question.id}><div className="paper-order-main"><GripVertical size={14} /><span>{questionNumber}</span><p><strong>{typeLabels[question.type]}</strong><small>{question.tags[0] || "未标注知识点"}</small></p><select aria-label={`第 ${questionNumber} 题板块`} value={section.id} onChange={(event) => moveToSection(question.id, event.target.value)}>{sections.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><button type="button" onClick={() => move(section.id, index, -1)}><ArrowUp size={12} /></button><button type="button" onClick={() => move(section.id, index, 1)}><ArrowDown size={12} /></button><button type="button" onClick={() => setSections((items) => items.map((item) => ({ ...item, questionIds: item.questionIds.filter((itemId) => itemId !== question.id) })))}><Trash2 size={12} /></button></div>
                {question.type === "answer" && <label className="paper-space-control"><span>作答留白</span><input type="range" min="80" max="600" step="10" value={answerSpaces[question.id] ?? 180} onChange={(event) => setAnswerSpaces((items) => ({ ...items, [question.id]: Number(event.target.value) }))} /><i>{answerSpaces[question.id] ?? 180}px</i></label>}
                {question.assets.map((asset) => { const layout = assetLayouts[asset.id] ?? defaultAssetLayout(questionNumber); return <div className="paper-image-controls" key={asset.id}><span><ImageIcon size={12} /> {layout.caption}</span><label>缩放 <input type="range" min="40" max="200" value={layout.scale} onChange={(event) => patchAsset(asset.id, { scale: Number(event.target.value) }, questionNumber)} /><i>{layout.scale}%</i></label><label>水平 <input type="range" min="-240" max="240" value={layout.x} onChange={(event) => patchAsset(asset.id, { x: Number(event.target.value) }, questionNumber)} /></label><label>垂直 <input type="range" min="-160" max="160" value={layout.y} onChange={(event) => patchAsset(asset.id, { y: Number(event.target.value) }, questionNumber)} /></label><input aria-label="题图说明" value={layout.caption} onChange={(event) => patchAsset(asset.id, { caption: event.target.value }, questionNumber)} /><select value={layout.placement} onChange={(event) => patchAsset(asset.id, { placement: event.target.value as PaperAssetLayout["placement"] }, questionNumber)}><option value="after-stem">题干后</option><option value="before-answer">选项后</option></select></div>; })}
              </div>;
            }))}
          </div>
          <Link href="/bank" className="btn add-from-bank">＋ 从题库继续选题</Link>
        </aside>
        <main className="paper-preview-wrap"><PaperPrintable title={title} subtitle={subtitle} questions={selected} settings={settings} includeAnswers={showAnswers} />{!selected.length && <Link className="btn btn-primary no-print" href="/bank">返回题库选题</Link>}</main>
      </div>
    </div>
  );
}

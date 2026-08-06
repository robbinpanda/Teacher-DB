"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, Eye, GripVertical, ImageIcon, LoaderCircle, Plus, Save, Settings2, Sparkles, Trash2 } from "lucide-react";
import type { QuestionWithSource } from "../lib/types";
import { stageFromGrade, stageLabel } from "../lib/education-taxonomy";
import { defaultAssetLayout, sectionsFromTemplate, type PaperAssetLayout, type PaperSection, type PaperSettings, type PaperTemplate } from "../lib/paper-templates";
import { typeLabels } from "../lib/question-labels";
import { useEducationScope } from "./AppShell";
import { PaperPrintable } from "./PaperPrintable";

function orderedIds(sections: PaperSection[]) { return sections.flatMap((section) => section.questionIds); }

export function PaperBuilder({ questions, initialIds, templates: initialTemplates }: { questions: QuestionWithSource[]; initialIds: string[]; templates: PaperTemplate[] }) {
  const scope = useEducationScope();
  const inScope = useMemo(() => questions.filter((question) => question.source.subject === scope.subject && stageFromGrade(question.source.grade) === scope.stage), [questions, scope.stage, scope.subject]);
  const initialQuestions = initialIds.length ? initialIds.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as QuestionWithSource[] : inScope.slice(0, 5);
  const [templates, setTemplates] = useState(initialTemplates);
  const availableTemplates = useMemo(() => templates.filter((template) => (template.subject === "*" || template.subject === scope.subject) && (template.subject === "*" || template.stage === scope.stage)), [scope.stage, scope.subject, templates]);
  const preferredTemplate = availableTemplates.find((template) => template.id === `preset-${scope.stage}-math-exam`) ?? availableTemplates[0] ?? initialTemplates[0];
  const [templateId, setTemplateId] = useState(preferredTemplate?.id ?? "preset-homework");
  const initialTemplate = initialTemplates.find((template) => template.id === templateId) ?? initialTemplates[0];
  const [sections, setSections] = useState<PaperSection[]>(() => sectionsFromTemplate(initialTemplate, initialQuestions));
  const [title, setTitle] = useState(`${stageLabel(scope.stage)}${scope.subject}练习卷`);
  const [subtitle, setSubtitle] = useState("建议用时 90 分钟");
  const [showAnswers, setShowAnswers] = useState(false);
  const [notice, setNotice] = useState(initialTemplate.config.notice);
  const [infoFields, setInfoFields] = useState(initialTemplate.config.infoFields);
  const [compact, setCompact] = useState(initialTemplate.config.compact);
  const [answerSpaces, setAnswerSpaces] = useState<Record<string, number>>({});
  const [assetLayouts, setAssetLayouts] = useState<Record<string, PaperAssetLayout>>({});
  const [paperId] = useState(() => crypto.randomUUID());
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">("saving");
  const [downloading, setDownloading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [customName, setCustomName] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const ids = useMemo(() => orderedIds(sections), [sections]);
  const selected = useMemo(() => ids.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as QuestionWithSource[], [ids, questions]);
  const settings: PaperSettings = useMemo(() => ({ templateId, subject: scope.subject, stage: scope.stage, showAnswers, answerSpaces, assetLayouts, sections, notice, infoFields, compact }), [answerSpaces, assetLayouts, compact, infoFields, notice, scope.stage, scope.subject, sections, showAnswers, templateId]);
  const typeCount = new Set(selected.map((question) => question.type)).size;

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const scoreById = Object.fromEntries(sections.flatMap((section) => section.questionIds.map((id, index) => [id, section.scoreSequence?.[index] ?? section.defaultScore])));
        const response = await fetch("/api/papers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: paperId, title, subtitle, questionIds: ids, scores: scoreById, settings }) });
        if (!response.ok) throw new Error("保存失败");
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [ids, paperId, sections, settings, subtitle, title]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const candidates = templates.filter((template) => (template.subject === "*" || template.subject === scope.subject) && (template.subject === "*" || template.stage === scope.stage));
      const currentValid = candidates.some((template) => template.id === templateId);
      if (currentValid) return;
      const nextTemplate = candidates.find((template) => template.id === `preset-${scope.stage}-math-exam`) ?? candidates[0];
      if (!nextTemplate) return;
      setTemplateId(nextTemplate.id);
      setNotice(nextTemplate.config.notice);
      setInfoFields(nextTemplate.config.infoFields);
      setCompact(nextTemplate.config.compact);
      setSections(sectionsFromTemplate(nextTemplate, selected));
      setTitle(`${stageLabel(scope.stage)}${scope.subject}练习卷`);
      setSaveState("saving");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scope.stage, scope.subject, selected, templateId, templates]);

  function applyTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setTemplateId(id); setNotice(template.config.notice); setInfoFields(template.config.infoFields); setCompact(template.config.compact);
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

  async function saveTemplate() {
    if (!customName.trim()) { setTemplateMessage("请先填写模板名称"); return; }
    const templateSections = sections.map((section) => ({ id: section.id, title: section.title, scoreDetail: section.scoreDetail, acceptedTypes: section.acceptedTypes, defaultScore: section.defaultScore, scoreSequence: section.scoreSequence }));
    const response = await fetch("/api/paper-templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: customName, subject: scope.subject, stage: scope.stage, config: { notice, infoFields, compact, sections: templateSections } }) });
    const result = await response.json().catch(() => ({})) as { error?: string; templates?: PaperTemplate[] };
    if (!response.ok) { setTemplateMessage(result.error ?? "模板保存失败"); return; }
    if (result.templates) setTemplates(result.templates);
    setCustomName(""); setTemplateMessage("自定义模板已保存");
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
  return (
    <div className="paper-builder">
      <header className="paper-topbar no-print">
        <div><Link href="/bank" className="icon-btn"><ArrowLeft size={17} /></Link><span><strong>智能组卷</strong><small>{stageLabel(scope.stage)} · {scope.subject}</small></span></div>
        <div className={`paper-save-state ${saveState}`}><Check size={13} /> {saveState === "saving" ? "正在保存…" : saveState === "error" ? "保存失败" : "已自动保存"}</div>
        <div className="header-actions"><button type="button" className="btn btn-small" onClick={() => setShowAnswers(!showAnswers)}><Eye size={14} /> {showAnswers ? "隐藏答案" : "答案预览"}</button><button type="button" className="btn btn-dark btn-small" disabled={downloading} onClick={() => void downloadPdf()}>{downloading ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} {downloading ? "生成中…" : "下载 PDF"}</button></div>
      </header>
      <div className="paper-workspace">
        <aside className="paper-settings no-print">
          <div className="section-title"><div><h2>试卷模板与版式</h2><p>板块、分值、题图均可调整</p></div><Settings2 size={17} /></div>
          <label className="edit-field"><span>套用模板</span><select value={templateId} onChange={(event) => applyTemplate(event.target.value)}>{availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.isPreset ? " · 预制" : " · 我的"}</option>)}</select></label>
          <label className="edit-field"><span>试卷标题</span><input value={title} onChange={(event) => { setTitle(event.target.value); setSaveState("saving"); }} /></label>
          <label className="edit-field"><span>副标题</span><input value={subtitle} onChange={(event) => { setSubtitle(event.target.value); setSaveState("saving"); }} /></label>
          <label className="edit-field"><span>注意事项</span><textarea rows={3} value={notice} onChange={(event) => setNotice(event.target.value)} /></label>
          <label className="edit-field"><span>考生信息栏（顿号分隔）</span><input value={infoFields.join("、")} onChange={(event) => setInfoFields(event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))} /></label>
          <label className="paper-checkbox"><input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} /> 紧凑排版</label>
          <div className="paper-summary"><div><span>题目</span><strong>{selected.length}</strong></div><div><span>题型</span><strong>{typeCount}</strong></div><div><span>板块</span><strong>{sections.length}</strong></div></div>
          <div className="smart-fill"><Sparkles size={17} /><div><strong>按当前学科智能补齐</strong><p>只从 {stageLabel(scope.stage)}{scope.subject}题库补题。</p></div><button type="button" onClick={smartFill}>补齐</button></div>
          <div className="paper-section-editor">
            {sections.map((section) => <div key={section.id}><input aria-label="板块标题" value={section.title} onChange={(event) => setSections((items) => items.map((item) => item.id === section.id ? { ...item, title: event.target.value } : item))} /><input aria-label="板块分值说明" value={section.scoreDetail} onChange={(event) => setSections((items) => items.map((item) => item.id === section.id ? { ...item, scoreDetail: event.target.value } : item))} /><label>默认每题 <input type="number" min="0" max="100" value={section.defaultScore} onChange={(event) => setSections((items) => items.map((item) => item.id === section.id ? { ...item, defaultScore: Number(event.target.value) } : item))} /> 分</label></div>)}
            <button type="button" className="text-button" onClick={() => setSections((items) => [...items, { id: crypto.randomUUID(), title: `${items.length + 1}、自定义板块`, scoreDetail: "请填写分值说明", acceptedTypes: ["single", "multiple", "fill", "answer"], defaultScore: 5, questionIds: [] }])}><Plus size={13} /> 添加板块</button>
          </div>
          <div className="custom-template-save"><input placeholder="我的模板名称" value={customName} onChange={(event) => setCustomName(event.target.value)} /><button type="button" onClick={() => void saveTemplate()}><Save size={13} /> 保存模板</button></div>
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

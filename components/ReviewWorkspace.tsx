"use client";

import Link from "next/link";
import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  ImageIcon,
  Plus,
  Save,
  Sparkles,
  Tag,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { MathText } from "./MathText";
import type { BoundingBox, Question, QuestionType, QuestionWithSource, ReviewDocument, ReviewPage } from "../lib/types";
import { typeLabels } from "../lib/question-labels";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function CropPreview({ bbox, imageUrl }: { bbox: BoundingBox; imageUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const sourceX = image.naturalWidth * bbox.x / 100;
      const sourceY = image.naturalHeight * bbox.y / 100;
      const sourceWidth = image.naturalWidth * bbox.width / 100;
      const sourceHeight = image.naturalHeight * bbox.height / 100;
      canvas.width = 440;
      canvas.height = Math.max(130, Math.round(440 * sourceHeight / sourceWidth));
      canvas.getContext("2d")?.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    };
    image.src = imageUrl;
  }, [bbox, imageUrl]);
  return <canvas ref={canvasRef} className="crop-preview-canvas" />;
}

export function ReviewWorkspace({
  sourceDocument,
  pages,
  initialQuestions,
  initialActiveId,
}: {
  sourceDocument: ReviewDocument;
  pages: ReviewPage[];
  initialQuestions: QuestionWithSource[];
  initialActiveId?: string;
}) {
  const [questions, setQuestions] = useState(initialQuestions);
  const initialActive = initialQuestions.find((question) => question.id === initialActiveId) ?? initialQuestions[0];
  const [activeId, setActiveId] = useState(initialActive?.id ?? "");
  const [currentPage, setCurrentPage] = useState(initialActive?.page ?? pages[0]?.pageNumber ?? 1);
  const [zoom, setZoom] = useState(82);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [newTag, setNewTag] = useState("");
  const pageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { mode: "move" | "resize"; x: number; y: number; box: BoundingBox }>(null);
  const active = questions.find((question) => question.id === activeId) ?? questions[0];
  const activeAsset = active?.assets[0];
  const editableBox = activeAsset?.bbox ?? active?.bbox;
  const currentPageInfo = pages.find((page) => page.pageNumber === currentPage) ?? pages[0];
  const pageQuestions = questions.filter((question) => question.page === currentPage);
  const approvedCount = questions.filter((question) => question.status === "approved").length;
  const progress = questions.length ? Math.round(approvedCount / questions.length * 100) : 0;
  const incompletePages = pages.filter((page) => page.extractionStatus !== "complete");
  const failedPages = pages.filter((page) => page.extractionStatus === "failed");

  async function addManualQuestion(pageNumber = currentPage) {
    setSaveError("");
    const response = await fetch(`/api/documents/${sourceDocument.id}/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: pageNumber }),
    });
    const result = await response.json().catch(() => ({})) as { question?: QuestionWithSource; error?: string };
    if (!response.ok || !result.question) {
      setSaveError(result.error ?? "手动补题失败");
      return;
    }
    setQuestions((items) => [...items, result.question!]);
    setActiveId(result.question.id);
    setCurrentPage(result.question.page);
  }

  async function retryExtraction() {
    setRetrying(true);
    setSaveError("");
    try {
      for (const page of incompletePages) {
        const response = await fetch("/api/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentId: sourceDocument.id,
            pageId: page.id,
            pageNumber: page.pageNumber,
            fileName: sourceDocument.name,
          }),
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? `第 ${page.pageNumber} 页重新识别失败`);
      }
      window.location.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "重新识别失败");
      setRetrying(false);
    }
  }

  if (!active || !editableBox || !currentPageInfo) {
    return (
      <div className="page-shell">
        <Link href="/" className="btn"><ArrowLeft size={16} /> 返回</Link>
        <section className="card empty-state">
          <h1>{sourceDocument.name}</h1>
          <p>当前文档已有原始页面，但还没有提取到可审核题目。可以手动补题，或回到上传流程重新提取。</p>
          <div className="header-actions">
            <button type="button" className="btn btn-primary" disabled={retrying} onClick={() => void retryExtraction()}><Sparkles size={15} /> {retrying ? "正在重新识别…" : "重新运行 AI 识别"}</button>
            {currentPageInfo && <button type="button" className="btn" onClick={() => void addManualQuestion(currentPageInfo.pageNumber)}><Plus size={15} /> 手动补一道题</button>}
          </div>
          {saveError && <p className="form-error">{saveError}</p>}
        </section>
      </div>
    );
  }

  function patchActive(patch: Partial<Question>) {
    setQuestions((items) => items.map((item) => item.id === active.id ? { ...item, ...patch } : item));
    setSaved(false);
  }

  function patchBox(box: BoundingBox) {
    if (activeAsset) {
      patchActive({ assets: active.assets.map((asset, index) => index === 0 ? { ...asset, bbox: box } : asset) });
    } else {
      patchActive({ bbox: box });
    }
  }

  function beginDrag(event: React.PointerEvent, mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, x: event.clientX, y: event.clientY, box: { ...editableBox } };
    pageRef.current?.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent) {
    const drag = dragRef.current;
    const rect = pageRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const dx = (event.clientX - drag.x) / rect.width * 100;
    const dy = (event.clientY - drag.y) / rect.height * 100;
    if (drag.mode === "move") {
      patchBox({
        ...drag.box,
        x: clamp(drag.box.x + dx, 0, 100 - drag.box.width),
        y: clamp(drag.box.y + dy, 0, 100 - drag.box.height),
      });
    } else {
      patchBox({
        ...drag.box,
        width: clamp(drag.box.width + dx, 3, 100 - drag.box.x),
        height: clamp(drag.box.height + dy, 3, 100 - drag.box.y),
      });
    }
  }

  async function saveQuestion() {
    setSaved(false);
    setSaveError("");
    const response = await fetch("/api/questions/" + active.id, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...active, status: "approved" }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setSaveError(result.error ?? "保存失败，请稍后重试");
      return;
    }
    patchActive({ status: "approved" });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  function selectQuestion(question: QuestionWithSource) {
    setActiveId(question.id);
    setCurrentPage(question.page);
    setSaveError("");
  }

  function switchPage(direction: -1 | 1) {
    const index = pages.findIndex((page) => page.pageNumber === currentPage);
    const next = pages[clamp(index + direction, 0, pages.length - 1)];
    if (!next) return;
    setCurrentPage(next.pageNumber);
    const firstQuestion = questions.find((question) => question.page === next.pageNumber);
    if (firstQuestion) setActiveId(firstQuestion.id);
  }

  async function finishReview() {
    setFinishing(true);
    setSaveError("");
    try {
      const response = await fetch("/api/documents/" + sourceDocument.id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "complete" }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "无法完成审核");
      window.location.href = "/bank";
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "无法完成审核");
      setFinishing(false);
    }
  }

  function addTag() {
    const tag = newTag.trim();
    if (tag && !active.tags.includes(tag)) patchActive({ tags: [...active.tags, tag] });
    setNewTag("");
  }

  return (
    <div className="review-layout">
      <header className="review-topbar no-print">
        <div className="review-title">
          <Link href="/" className="icon-btn" aria-label="返回"><ArrowLeft size={18} /></Link>
          <div><strong>{sourceDocument.name}</strong><span>第 {currentPage} / {pages.length} 页　·　发现 {questions.length} 道题　·　识别 {pages.length - incompletePages.length}/{pages.length} 页</span></div>
        </div>
        <div className="review-progress"><span>审核进度</span><div className="progress"><i style={{ width: progress + "%" }} /></div><b>{approvedCount} / {questions.length}</b></div>
        <div className="header-actions">
          {incompletePages.length > 0 && <button className="btn btn-small" type="button" disabled={retrying} onClick={() => void retryExtraction()}><Sparkles size={14} /> {retrying ? "继续识别中…" : failedPages.length ? `重试失败页 (${failedPages.length})` : `继续识别 (${incompletePages.length})`}</button>}
          <button className="btn btn-small" type="button" onClick={() => void saveQuestion()}><Save size={14} /> 暂存当前题</button>
          <button className="btn btn-primary btn-small" type="button" disabled={finishing} onClick={() => void finishReview()}>{finishing ? "正在完成…" : "完成并入库"} <Check size={14} /></button>
        </div>
      </header>

      <div className="review-body">
        <aside className="question-rail no-print">
          <div className="rail-title"><span>本页题目</span><b>{pageQuestions.length}</b></div>
          {pageQuestions.map((question) => (
            <button type="button" key={question.id} onClick={() => selectQuestion(question)} className={question.id === active.id ? "active" : ""}>
              <span className="question-number">{question.number}</span>
              <span><strong>{typeLabels[question.type]}</strong><small>{question.assets.length ? "含 1 张题图" : "纯文字题"}</small></span>
              {question.status === "approved" ? <Check size={14} className="status-ok" /> : question.status === "needs_attention" ? <AlertTriangle size={14} className="status-warn" /> : <i className="status-dot" />}
            </button>
          ))}
          {!pageQuestions.length && <p className="hint">本页未提取到题目</p>}
          <button type="button" className="add-question" onClick={() => void addManualQuestion()}><Plus size={15} /> 手动补一道题</button>
        </aside>

        <section className="source-panel">
          <div className="source-toolbar no-print">
            <div><span className="pill gray">原始页 {String(currentPage).padStart(2, "0")}</span><span className={`pill ${currentPageInfo.extractionStatus === "complete" ? "green" : currentPageInfo.extractionStatus === "failed" ? "orange" : "gray"}`}>{currentPageInfo.extractionStatus === "complete" ? "识别完成" : currentPageInfo.extractionStatus === "failed" ? `识别失败 · 第 ${currentPageInfo.extractionAttempt} 次` : currentPageInfo.extractionStatus === "running" ? "识别中" : "等待识别"}</span><span className="hint"><Crop size={13} /> 拖动选框；右下角缩放</span></div>
            <div className="zoom-control"><button type="button" onClick={() => setZoom(clamp(zoom - 8, 55, 120))}><ZoomOut size={15} /></button><span>{zoom}%</span><button type="button" onClick={() => setZoom(clamp(zoom + 8, 55, 120))}><ZoomIn size={15} /></button></div>
          </div>
          <div className="page-stage">
            <div
              ref={pageRef}
              className="exam-page"
              style={{ width: zoom + "%" }}
              onPointerMove={moveDrag}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              <NextImage src={currentPageInfo.imageUrl} alt={`原试卷第 ${currentPage} 页`} width={currentPageInfo.width} height={currentPageInfo.height} draggable={false} priority unoptimized />
              {pageQuestions.map((question) => (
                <button
                  type="button"
                  key={question.id}
                  className={"question-box " + (question.id === active.id ? "active" : "")}
                  style={{ left: question.bbox.x + "%", top: question.bbox.y + "%", width: question.bbox.width + "%", height: question.bbox.height + "%" }}
                  onClick={() => selectQuestion(question)}
                  aria-label={"第 " + question.number + " 题范围"}
                ><span>Q{question.number}</span></button>
              ))}
              {activeAsset && active.page === currentPage && (
                <div
                  className="asset-box"
                  style={{ left: editableBox.x + "%", top: editableBox.y + "%", width: editableBox.width + "%", height: editableBox.height + "%" }}
                  onPointerDown={(event) => beginDrag(event, "move")}
                >
                  <span><ImageIcon size={11} /> 题图</span>
                  <button type="button" className="resize-handle" onPointerDown={(event) => beginDrag(event, "resize")} aria-label="缩放裁剪框" />
                </div>
              )}
            </div>
          </div>
          <div className="page-switch no-print"><button type="button" disabled={currentPage === pages[0]?.pageNumber} onClick={() => switchPage(-1)}><ChevronLeft size={15} /></button><span>第 {currentPage} 页 / 共 {pages.length} 页</span><button type="button" disabled={currentPage === pages.at(-1)?.pageNumber} onClick={() => switchPage(1)}><ChevronRight size={15} /></button></div>
        </section>

        <aside className="editor-panel no-print">
          <div className="editor-head">
            <div><span className="eyebrow"><Sparkles size={12} /> AI 提取结果</span><h2>第 {active.number} 题 · {typeLabels[active.type]}</h2></div>
            <span className={"confidence " + (active.confidence < .9 ? "medium" : "")}>{Math.round(active.confidence * 100)}% 置信度</span>
          </div>

          {activeAsset && (
            <div className="crop-card">
              <div className="field-label"><span><ImageIcon size={13} /> 题图裁剪</span><b>可拖动调整</b></div>
              <CropPreview bbox={editableBox} imageUrl={currentPageInfo.imageUrl} />
              <div className="bbox-grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}><span>{key === "width" ? "宽" : key === "height" ? "高" : key.toUpperCase()}</span><input type="number" min="0" max="100" step=".1" value={editableBox[key].toFixed(1)} onChange={(event) => patchBox({ ...editableBox, [key]: Number(event.target.value) })} /><i>%</i></label>
                ))}
              </div>
            </div>
          )}

          <div className="two-fields">
            <label className="edit-field"><span>题号</span><input value={active.number} onChange={(event) => patchActive({ number: event.target.value })} /></label>
            <label className="edit-field"><span>题型</span><select value={active.type} onChange={(event) => {
              const nextType = event.target.value as QuestionType;
              const options = ["single", "multiple"].includes(nextType)
                ? (active.options?.length ? active.options : ["A", "B", "C", "D"].map((key) => ({ key, content: "" })))
                : [];
              patchActive({ type: nextType, options });
            }}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>

          <label className="edit-field"><span>题干 <em>支持 $LaTeX$</em></span><textarea rows={4} value={active.stem} onChange={(event) => patchActive({ stem: event.target.value })} /></label>
          <div className="render-preview"><span>渲染预览</span><MathText text={active.stem} /></div>

          {["single", "multiple"].includes(active.type) && (
            <div className="option-editor">
              <span className="field-label">选项</span>
              {(active.options ?? []).map((option, index) => (
                <label key={option.key}><b>{option.key}</b><input value={option.content} onChange={(event) => patchActive({ options: active.options?.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item) })} /></label>
              ))}
              <button type="button" className="btn btn-small" onClick={() => patchActive({ options: [...(active.options ?? []), { key: String.fromCharCode(65 + (active.options?.length ?? 0)), content: "" }] })}><Plus size={12} /> 添加选项</button>
            </div>
          )}

          <div className="two-fields">
            <label className="edit-field"><span>答案</span><input value={active.answer} onChange={(event) => patchActive({ answer: event.target.value })} /></label>
            <label className="edit-field"><span>分值</span><input type="number" value={active.score ?? 0} onChange={(event) => patchActive({ score: Number(event.target.value) })} /></label>
          </div>
          <label className="edit-field"><span>解析</span><textarea rows={3} value={active.analysis} onChange={(event) => patchActive({ analysis: event.target.value })} /></label>

          <div className="tag-editor">
            <span className="field-label"><Tag size={13} /> 标签</span>
            <div className="tag-list">{active.tags.map((tag) => <button key={tag} type="button" onClick={() => patchActive({ tags: active.tags.filter((item) => item !== tag) })}>{tag}<X size={11} /></button>)}</div>
            <div className="tag-input"><input placeholder="输入标签后回车" value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} /><button type="button" onClick={addTag}><Plus size={14} /></button></div>
          </div>

          {saveError && <p className="form-error">{saveError}</p>}
          <button type="button" className="btn btn-primary save-review" onClick={() => void saveQuestion()}><Check size={16} /> {saved ? "已保存，审核通过" : "保存并通过此题"}</button>
        </aside>
      </div>
    </div>
  );
}

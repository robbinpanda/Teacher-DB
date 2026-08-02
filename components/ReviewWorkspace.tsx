"use client";

import Link from "next/link";
import Image from "next/image";
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
import type { BoundingBox, Question } from "../lib/types";
import { typeLabels } from "../lib/demo-data";

const pageImage = "/demo-exam-page.svg";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function CropPreview({ bbox }: { bbox: BoundingBox }) {
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
    image.src = pageImage;
  }, [bbox]);
  return <canvas ref={canvasRef} className="crop-preview-canvas" />;
}

export function ReviewWorkspace({ initialQuestions }: { initialQuestions: Question[] }) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [activeId, setActiveId] = useState(initialQuestions[1]?.id ?? initialQuestions[0].id);
  const [zoom, setZoom] = useState(82);
  const [saved, setSaved] = useState(false);
  const [newTag, setNewTag] = useState("");
  const pageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { mode: "move" | "resize"; x: number; y: number; box: BoundingBox }>(null);
  const active = questions.find((question) => question.id === activeId) ?? questions[0];
  const activeAsset = active.assets[0];
  const editableBox = activeAsset?.bbox ?? active.bbox;

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
    await fetch("/api/questions/" + active.id, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...active, status: "approved" }),
    }).catch(() => null);
    patchActive({ status: "approved" });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
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
          <div><strong>2025 届九年级第二次模拟考试·数学</strong><span>第 1 / 8 页　·　发现 24 道题</span></div>
        </div>
        <div className="review-progress"><span>审核进度</span><div className="progress"><i style={{ width: "75%" }} /></div><b>18 / 24</b></div>
        <div className="header-actions">
          <button className="btn btn-small" type="button"><Save size={14} /> 暂存</button>
          <Link className="btn btn-primary btn-small" href="/bank">完成并入库 <Check size={14} /></Link>
        </div>
      </header>

      <div className="review-body">
        <aside className="question-rail no-print">
          <div className="rail-title"><span>本页题目</span><b>{questions.length}</b></div>
          {questions.map((question) => (
            <button type="button" key={question.id} onClick={() => setActiveId(question.id)} className={question.id === active.id ? "active" : ""}>
              <span className="question-number">{question.number}</span>
              <span><strong>{typeLabels[question.type]}</strong><small>{question.assets.length ? "含 1 张题图" : "纯文字题"}</small></span>
              {question.status === "approved" ? <Check size={14} className="status-ok" /> : question.status === "needs_attention" ? <AlertTriangle size={14} className="status-warn" /> : <i className="status-dot" />}
            </button>
          ))}
          <button type="button" className="add-question"><Plus size={15} /> 手动补一道题</button>
        </aside>

        <section className="source-panel">
          <div className="source-toolbar no-print">
            <div><span className="pill gray">原始页 01</span><span className="hint"><Crop size={13} /> 拖动选框；右下角缩放</span></div>
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
              <Image src={pageImage} alt="原试卷第 1 页" width={900} height={1273} draggable={false} priority />
              {questions.map((question) => (
                <button
                  type="button"
                  key={question.id}
                  className={"question-box " + (question.id === active.id ? "active" : "")}
                  style={{ left: question.bbox.x + "%", top: question.bbox.y + "%", width: question.bbox.width + "%", height: question.bbox.height + "%" }}
                  onClick={() => setActiveId(question.id)}
                  aria-label={"第 " + question.number + " 题范围"}
                ><span>Q{question.number}</span></button>
              ))}
              {activeAsset && (
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
          <div className="page-switch no-print"><button type="button"><ChevronLeft size={15} /></button><span>第 1 页 / 共 8 页</span><button type="button"><ChevronRight size={15} /></button></div>
        </section>

        <aside className="editor-panel no-print">
          <div className="editor-head">
            <div><span className="eyebrow"><Sparkles size={12} /> AI 提取结果</span><h2>第 {active.number} 题 · {typeLabels[active.type]}</h2></div>
            <span className={"confidence " + (active.confidence < .9 ? "medium" : "")}>{Math.round(active.confidence * 100)}% 置信度</span>
          </div>

          {activeAsset && (
            <div className="crop-card">
              <div className="field-label"><span><ImageIcon size={13} /> 题图裁剪</span><b>可拖动调整</b></div>
              <CropPreview bbox={editableBox} />
              <div className="bbox-grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}><span>{key === "width" ? "宽" : key === "height" ? "高" : key.toUpperCase()}</span><input type="number" min="0" max="100" step=".1" value={editableBox[key].toFixed(1)} onChange={(event) => patchBox({ ...editableBox, [key]: Number(event.target.value) })} /><i>%</i></label>
                ))}
              </div>
            </div>
          )}

          <label className="edit-field"><span>题干 <em>支持 $LaTeX$</em></span><textarea rows={4} value={active.stem} onChange={(event) => patchActive({ stem: event.target.value })} /></label>
          <div className="render-preview"><span>渲染预览</span><MathText text={active.stem} /></div>

          {active.options && (
            <div className="option-editor">
              <span className="field-label">选项</span>
              {active.options.map((option, index) => (
                <label key={option.key}><b>{option.key}</b><input value={option.content} onChange={(event) => patchActive({ options: active.options?.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item) })} /></label>
              ))}
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

          <button type="button" className="btn btn-primary save-review" onClick={() => void saveQuestion()}><Check size={16} /> {saved ? "已保存，审核通过" : "保存并通过此题"}</button>
        </aside>
      </div>
    </div>
  );
}

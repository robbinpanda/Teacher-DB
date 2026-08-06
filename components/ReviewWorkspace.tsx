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
  FileUp,
  Info,
  LoaderCircle,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { MathText } from "./MathText";
import type { BoundingBox, Question, QuestionType, QuestionWithSource, ReviewDocument, ReviewPage } from "../lib/types";
import { typeLabels } from "../lib/question-labels";
import { stageFromGrade } from "../lib/education-taxonomy";
import { answerImagesFromFile } from "../lib/client-answer-images";
import type { TagCatalogEntry } from "../lib/tag-catalog";

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
  const [pageStates, setPageStates] = useState(pages);
  const [job, setJob] = useState<{ status?: string | null; nextAttemptAt?: string | null; lastError?: string | null }>({
    status: sourceDocument.jobStatus,
    nextAttemptAt: sourceDocument.nextAttemptAt,
    lastError: sourceDocument.error,
  });
  const initialActive = initialQuestions.find((question) => question.id === initialActiveId) ?? initialQuestions[0];
  const [activeId, setActiveId] = useState(initialActive?.id ?? "");
  const [currentPage, setCurrentPage] = useState(initialActive?.page ?? pages[0]?.pageNumber ?? 1);
  const [zoom, setZoom] = useState(82);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [bulkAction, setBulkAction] = useState<"approve" | "remove" | null>(null);
  const [bulkNotice, setBulkNotice] = useState("");
  const [showUnapprovedSummary, setShowUnapprovedSummary] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [newResultsAvailable, setNewResultsAvailable] = useState(false);
  const [boxMode, setBoxMode] = useState<"region" | "asset">("region");
  const [newTag, setNewTag] = useState("");
  const [tagCatalog, setTagCatalog] = useState<TagCatalogEntry[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [documentMeta, setDocumentMeta] = useState({
    subject: sourceDocument.subject, grade: sourceDocument.grade, year: sourceDocument.year ? String(sourceDocument.year) : "",
    examType: sourceDocument.examType ?? "", region: sourceDocument.region ?? "", school: sourceDocument.school ?? "",
  });
  const [detailMessage, setDetailMessage] = useState("");
  const [answerImporting, setAnswerImporting] = useState(false);
  const [answerImportMessage, setAnswerImportMessage] = useState("");
  const answerInputRef = useRef<HTMLInputElement>(null);
  const [adjustedQuestionIds, setAdjustedQuestionIds] = useState<Set<string>>(() => new Set());
  const [reextractingId, setReextractingId] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { mode: "move" | "resize"; x: number; y: number; box: BoundingBox }>(null);
  const active = questions.find((question) => question.id === activeId) ?? questions[0];
  const regionAdjusted = active ? adjustedQuestionIds.has(active.id) : false;
  const pageAsset = active?.assets.find((asset) => asset.page === currentPage);
  const activeAsset = boxMode === "asset" ? pageAsset : undefined;
  const activeRegion = active?.regions.find((region) => region.page === currentPage);
  const editableBox = activeAsset?.bbox ?? activeRegion?.bbox;
  const currentPageInfo = pageStates.find((page) => page.pageNumber === currentPage) ?? pageStates[0];
  const pageQuestions = questions.filter((question) => question.regions.some((region) => region.page === currentPage));
  const approvedCount = questions.filter((question) => question.status === "approved").length;
  const unapprovedQuestions = questions.filter((question) => question.status !== "approved");
  const progress = questions.length ? Math.round(approvedCount / questions.length * 100) : 0;
  const incompletePages = pageStates.filter((page) => page.extractionStatus !== "complete");
  const failedPages = pageStates.filter((page) => page.extractionStatus === "failed");
  const initialCompletedRef = useRef(sourceDocument.completedPageCount);

  useEffect(() => {
    const params = new URLSearchParams({ subject: documentMeta.subject || "数学", stage: stageFromGrade(documentMeta.grade) });
    fetch(`/api/tag-catalog?${params}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { tags?: TagCatalogEntry[] };
      if (response.ok && result.tags) setTagCatalog(result.tags);
    }).catch(() => undefined);
  }, [documentMeta.grade, documentMeta.subject]);

  useEffect(() => {
    if (!incompletePages.length) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch(`/api/documents/${sourceDocument.id}/progress`, { cache: "no-store" }).catch(() => undefined);
      if (!response?.ok || cancelled) return;
      const result = await response.json() as {
        job?: { status?: string; nextAttemptAt?: string | null; lastError?: string | null };
        pages?: Array<{ pageId: string; pageNumber: number; status: ReviewPage["extractionStatus"]; attempt: number; error?: string | null; nextAttemptAt?: string | null }>;
      };
      setJob(result.job ?? {});
      if (result.pages) {
        const completed = result.pages.filter((page) => page.status === "complete").length;
        setPageStates((items) => items.map((page) => {
          const fresh = result.pages?.find((candidate) => candidate.pageId === page.id);
          return fresh ? { ...page, extractionStatus: fresh.status, extractionAttempt: fresh.attempt, extractionError: fresh.error, nextAttemptAt: fresh.nextAttemptAt } : page;
        }));
        if (completed > initialCompletedRef.current) {
          initialCompletedRef.current = completed;
          if (!initialQuestions.length) window.location.reload();
          else setNewResultsAvailable(true);
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [incompletePages.length, initialQuestions.length, sourceDocument.id]);

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
      const response = await fetch(`/api/documents/${sourceDocument.id}/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retry: true }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "重新加入识别队列失败");
      setJob({ status: "queued", lastError: null, nextAttemptAt: null });
      setPageStates((items) => items.map((page) => page.extractionStatus === "complete" ? page : { ...page, extractionStatus: "queued", extractionError: null, nextAttemptAt: null }));
      setRetrying(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "重新识别失败");
      setRetrying(false);
    }
  }

  if (!active || !currentPageInfo) {
    return (
      <div className="page-shell">
        <Link href="/" className="btn"><ArrowLeft size={16} /> 返回</Link>
        <section className="card extraction-empty">
          {currentPageInfo && <div className="empty-page-preview"><NextImage src={currentPageInfo.imageUrl} alt="原始试卷首页" width={currentPageInfo.width} height={currentPageInfo.height} unoptimized priority /></div>}
          <div className="empty-progress-panel">
            <h1>{sourceDocument.name}</h1>
            <p>原卷和分页图已保存。识别在服务端可靠队列中逐页执行，已完成的页面不会重新开始。</p>
            <strong>页面识别 {pageStates.length - incompletePages.length} / {pageStates.length}</strong>
            <div className="page-state-grid">{pageStates.map((page) => <span key={page.id} className={page.extractionStatus === "complete" ? "complete" : page.extractionStatus === "failed" ? "failed" : page.extractionStatus === "retry_wait" ? "retry" : ""}>第 {page.pageNumber} 页 · {page.extractionStatus === "complete" ? "完成" : page.extractionStatus === "running" ? "识别中" : page.extractionStatus === "retry_wait" ? "退避" : page.extractionStatus === "failed" ? "失败" : "排队"}</span>)}</div>
            {job.status === "retry_wait" && job.nextAttemptAt && <p className="queue-notice">网络退避中，将在 {new Date(job.nextAttemptAt).toLocaleString()} 自动继续。</p>}
            {(job.lastError || sourceDocument.error) && <p className="form-error">{job.lastError || sourceDocument.error}</p>}
            <div className="header-actions">
              <button type="button" className="btn btn-primary" disabled={retrying || ["queued", "processing"].includes(job.status ?? "")} onClick={() => void retryExtraction()}><RefreshCw size={15} /> {retrying ? "正在加入队列…" : ["queued", "processing", "retry_wait"].includes(job.status ?? "") ? "可靠队列处理中" : "继续未完成页面"}</button>
              {currentPageInfo && <button type="button" className="btn" onClick={() => void addManualQuestion(currentPageInfo.pageNumber)}><Plus size={15} /> 手动补一道题</button>}
            </div>
            {saveError && <p className="form-error">{saveError}</p>}
          </div>
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
      patchActive({ assets: active.assets.map((asset) => asset.id === activeAsset.id ? { ...asset, bbox: box } : asset) });
    } else {
      const regions = active.regions.map((region) => region.page === currentPage ? { ...region, bbox: box } : region);
      const primary = regions[0];
      patchActive({ regions, page: primary.page, bbox: primary.bbox });
      setAdjustedQuestionIds((items) => new Set(items).add(active.id));
    }
  }

  function addQuestionRegion(pageNumber: number) {
    const targetPage = pageStates.find((page) => page.pageNumber === pageNumber);
    if (!targetPage) return;
    const existing = active.regions.find((region) => region.page === pageNumber);
    if (existing) {
      setCurrentPage(pageNumber);
      setBoxMode("region");
      return;
    }
    const regionPages = active.regions.map((region) => region.page);
    const beforeFirstPage = pageNumber < Math.min(...regionPages);
    const bbox: BoundingBox = beforeFirstPage
      ? { x: 8, y: 55, width: 84, height: 38 }
      : { x: 8, y: 6, width: 84, height: 42 };
    const regions = [...active.regions, { page: pageNumber, bbox }].sort((left, right) => left.page - right.page);
    const primary = regions[0];
    patchActive({ regions, page: primary.page, bbox: primary.bbox });
    setAdjustedQuestionIds((items) => new Set(items).add(active.id));
    setCurrentPage(pageNumber);
    setBoxMode("region");
    setSaveError("");
  }

  function addManualAsset() {
    const regionBox = active.regions.find((region) => region.page === currentPage)?.bbox ?? active.bbox;
    const width = Math.max(3, regionBox.width * .5);
    const height = Math.max(3, regionBox.height * .5);
    const asset = {
      id: crypto.randomUUID(),
      kind: "figure" as const,
      label: "手动题图",
      page: currentPage,
      bbox: {
        x: clamp(regionBox.x + (regionBox.width - width) / 2, 0, 100 - width),
        y: clamp(regionBox.y + (regionBox.height - height) / 2, 0, 100 - height),
        width,
        height,
      },
    };
    patchActive({ assets: [...active.assets, asset] });
    setBoxMode("asset");
  }

  function removePageAsset() {
    if (!pageAsset) return;
    patchActive({ assets: active.assets.filter((asset) => asset.id !== pageAsset.id) });
    setBoxMode("region");
  }

  function beginDrag(event: React.PointerEvent, mode: "move" | "resize") {
    if (!editableBox) return;
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
    setAdjustedQuestionIds((items) => {
      const next = new Set(items);
      next.delete(active.id);
      return next;
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function reextractQuestion() {
    const target = active;
    setReextractingId(target.id);
    setSaveError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/questions/${encodeURIComponent(target.id)}/reextract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ regions: target.regions }),
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        recognition?: Pick<Question, "type" | "stem" | "options" | "answer" | "analysis" | "tags" | "confidence">;
      };
      if (!response.ok || !result.recognition) throw new Error(result.error ?? "重新识别失败");
      const recognition = result.recognition;
      const refreshed: QuestionWithSource = {
        ...target,
        ...recognition,
        answer: recognition.answer || target.answer,
        analysis: recognition.analysis || target.analysis,
        tags: Array.from(new Set([...target.tags, ...recognition.tags])),
        regions: target.regions,
        page: target.regions[0]?.page ?? target.page,
        bbox: target.regions[0]?.bbox ?? target.bbox,
        status: "pending",
      };
      const saveResponse = await fetch(`/api/questions/${encodeURIComponent(target.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(refreshed),
      });
      const saveResult = await saveResponse.json().catch(() => ({})) as { error?: string; question?: QuestionWithSource };
      if (!saveResponse.ok) throw new Error(saveResult.error ?? "识别成功，但保存新题框失败");
      setQuestions((items) => items.map((item) => item.id === target.id ? (saveResult.question ?? refreshed) : item));
      setAdjustedQuestionIds((items) => {
        const next = new Set(items);
        next.delete(target.id);
        return next;
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "重新识别失败");
    } finally {
      setReextractingId(null);
    }
  }

  function selectQuestion(question: QuestionWithSource) {
    setActiveId(question.id);
    setBoxMode("region");
    if (!question.regions.some((region) => region.page === currentPage)) setCurrentPage(question.regions[0]?.page ?? question.page);
    setSaveError("");
  }

  function switchPage(direction: -1 | 1) {
    const index = pageStates.findIndex((page) => page.pageNumber === currentPage);
    const next = pageStates[clamp(index + direction, 0, pageStates.length - 1)];
    if (!next) return;
    setCurrentPage(next.pageNumber);
    setBoxMode("region");
    const firstQuestion = questions.find((question) => question.regions.some((region) => region.page === next.pageNumber));
    if (firstQuestion) setActiveId(firstQuestion.id);
  }

  async function runBulkAction(action: "approve_high_confidence" | "remove_all_from_bank") {
    if (action === "remove_all_from_bank" && !window.confirm("将本试卷所有已入库题目移出题库？题目内容、页面框选和审核记录都会保留，可以之后重新入库。")) return;
    setBulkAction(action === "approve_high_confidence" ? "approve" : "remove");
    setSaveError("");
    setBulkNotice("");
    try {
      const response = await fetch(`/api/documents/${sourceDocument.id}/questions/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; changed?: number; highConfidenceWarnings?: number };
      if (!response.ok) throw new Error(result.error ?? "批量操作失败");
      if (action === "approve_high_confidence") {
        setQuestions((items) => items.map((item) => item.confidence > .95 && item.status === "pending" ? { ...item, status: "approved" } : item));
        setShowUnapprovedSummary(true);
        setBulkNotice(`已入库 ${result.changed ?? 0} 道高置信度题目${result.highConfidenceWarnings ? `；另有 ${result.highConfidenceWarnings} 道虽超过 95% 但存在完整性警告，未自动入库` : ""}`);
      } else {
        setQuestions((items) => items.map((item) => item.status === "approved" ? { ...item, status: "pending" } : item));
        setShowUnapprovedSummary(false);
        setBulkNotice(`已将 ${result.changed ?? 0} 道题移出题库，题目和框选仍保留`);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "批量操作失败");
    } finally {
      setBulkAction(null);
    }
  }

  async function addTag() {
    const tag = newTag.trim();
    if (!tag) return;
    if (!tagCatalog.some((item) => item.name === tag)) {
      const response = await fetch("/api/tag-catalog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: documentMeta.subject, stage: stageFromGrade(documentMeta.grade), name: tag }) });
      const result = await response.json().catch(() => ({})) as { tags?: TagCatalogEntry[]; error?: string };
      if (!response.ok) { setSaveError(result.error ?? "标签加入目录失败"); return; }
      if (result.tags) setTagCatalog(result.tags);
    }
    if (!active.tags.includes(tag)) patchActive({ tags: [...active.tags, tag] });
    setNewTag("");
  }

  async function saveDocumentDetails() {
    setDetailMessage("正在保存…");
    const response = await fetch(`/api/documents/${sourceDocument.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...documentMeta, year: documentMeta.year ? Number(documentMeta.year) : null }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setDetailMessage(response.ok ? "试卷详情已保存" : result.error ?? "保存失败");
  }

  async function importAnswers(files: FileList | null) {
    if (!files?.length) return;
    setAnswerImporting(true); setAnswerImportMessage("正在准备答案页…");
    try {
      let totalMatches = 0;
      let lastMissing: string[] = [];
      const warningParts: string[] = [];
      for (const file of Array.from(files)) {
        const images = await answerImagesFromFile(file);
        let importId: string | undefined;
        for (let index = 0; index < images.length; index += 4) {
          const batch = images.slice(index, index + 4).map((dataUrl, offset) => ({ page: index + offset + 1, dataUrl }));
          setAnswerImportMessage(`正在匹配 ${file.name}：${Math.min(index + 4, images.length)} / ${images.length} 页…`);
          const response = await fetch(`/api/documents/${sourceDocument.id}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName: file.name, images: batch, importId, final: index + 4 >= images.length }) });
          const result = await response.json().catch(() => ({})) as { error?: string; importId?: string; matches?: Array<{ id: string; answer: string; analysis: string }>; missingNumbers?: string[]; unknownNumbers?: string[]; lowConfidenceNumbers?: string[]; unmatchedNotes?: string[] };
          if (!response.ok) throw new Error(result.error ?? "答案匹配失败");
          importId = result.importId;
          totalMatches += result.matches?.length ?? 0;
          lastMissing = result.missingNumbers ?? lastMissing;
          if (result.unknownNumbers?.length) warningParts.push(`未找到题号 ${result.unknownNumbers.join("、")}`);
          if (result.lowConfidenceNumbers?.length) warningParts.push(`题号 ${result.lowConfidenceNumbers.join("、")} 匹配置信度较低，请人工复核`);
          if (result.unmatchedNotes?.length) warningParts.push(...result.unmatchedNotes);
          if (result.matches?.length) setQuestions((items) => items.map((question) => {
            const update = result.matches?.find((match) => match.id === question.id);
            return update ? { ...question, answer: update.answer || question.answer, analysis: update.analysis || question.analysis } : question;
          }));
        }
      }
      const missingText = lastMissing.length ? `；仍缺答案：${lastMissing.slice(0, 18).join("、")}${lastMissing.length > 18 ? "…" : ""}` : "；全部已匹配";
      const warningText = warningParts.length ? `；提示：${warningParts.slice(0, 3).join("；")}` : "";
      setAnswerImportMessage(`已匹配 ${totalMatches} 条答案${missingText}${warningText}`);
    } catch (error) { setAnswerImportMessage(error instanceof Error ? error.message : "答案导入失败"); }
    finally { setAnswerImporting(false); if (answerInputRef.current) answerInputRef.current.value = ""; }
  }

  return (
    <div className="review-layout">
      <header className="review-topbar no-print">
        <div className="review-title">
          <Link href="/" className="icon-btn" aria-label="返回"><ArrowLeft size={18} /></Link>
          <div><strong>{sourceDocument.name}</strong><span>第 {currentPage} / {pageStates.length} 页　·　发现 {questions.length} 道题　·　识别 {pageStates.length - incompletePages.length}/{pageStates.length} 页</span></div>
        </div>
        <div className="review-progress"><span>审核进度</span><div className="progress"><i style={{ width: progress + "%" }} /></div><b>{approvedCount} / {questions.length}</b></div>
        <div className="header-actions">
          <input ref={answerInputRef} hidden type="file" multiple accept="application/pdf,image/*" onChange={(event) => void importAnswers(event.target.files)} />
          <button className="btn btn-small" type="button" disabled={answerImporting || approvedCount === 0} title={approvedCount === 0 ? "请先审核入库题目" : ""} onClick={() => answerInputRef.current?.click()}><FileUp size={14} /> {answerImporting ? "答案匹配中…" : "导入答案"}</button>
          <button className="btn btn-small" type="button" onClick={() => setDetailsOpen((value) => !value)}><Info size={14} /> 试卷详情</button>
          {newResultsAvailable && <button className="btn btn-small" type="button" onClick={() => window.location.reload()}><RefreshCw size={14} /> 刷新识别结果</button>}
          {incompletePages.length > 0 && <button className="btn btn-small" type="button" disabled={retrying} onClick={() => void retryExtraction()}><RefreshCw size={14} /> {retrying ? "继续识别中…" : failedPages.length ? `重试失败页 (${failedPages.length})` : `继续识别 (${incompletePages.length})`}</button>}
          {bulkNotice && <span className="bulk-notice">{bulkNotice}</span>}
          <button className="btn btn-primary btn-small" type="button" disabled={Boolean(bulkAction)} onClick={() => void runBulkAction("approve_high_confidence")}><Check size={14} /> {bulkAction === "approve" ? "批量入库中…" : "一键入库 >95%（无警告）"}</button>
          <button className="btn btn-danger-soft btn-small" type="button" disabled={Boolean(bulkAction)} onClick={() => void runBulkAction("remove_all_from_bank")}><Trash2 size={14} /> {bulkAction === "remove" ? "正在移出…" : "全部移出题库"}</button>
        </div>
      </header>

      {(detailsOpen || answerImportMessage) && <div className="review-notice-panel no-print">
        {detailsOpen && <div className="document-detail-editor"><label>学科<input value={documentMeta.subject} onChange={(event) => setDocumentMeta({ ...documentMeta, subject: event.target.value })} /></label><label>年级<input value={documentMeta.grade} onChange={(event) => setDocumentMeta({ ...documentMeta, grade: event.target.value })} /></label><label>年份<input type="number" value={documentMeta.year} onChange={(event) => setDocumentMeta({ ...documentMeta, year: event.target.value })} /></label><label>考试类型<input placeholder="如：中考 / 二模" value={documentMeta.examType} onChange={(event) => setDocumentMeta({ ...documentMeta, examType: event.target.value })} /></label><label>地区<input value={documentMeta.region} onChange={(event) => setDocumentMeta({ ...documentMeta, region: event.target.value })} /></label><label>学校<input value={documentMeta.school} onChange={(event) => setDocumentMeta({ ...documentMeta, school: event.target.value })} /></label><button type="button" className="btn btn-primary btn-small" onClick={() => void saveDocumentDetails()}>保存详情</button>{detailMessage && <span>{detailMessage}</span>}</div>}
        {answerImportMessage && <p className={/失败|超过|无效/.test(answerImportMessage) ? "form-error" : "form-note"}>{answerImportMessage}</p>}
      </div>}

      <div className="review-body">
        <aside className="question-rail no-print">
          <div className="rail-title"><span>本页题目</span><b>{pageQuestions.length}</b></div>
          {showUnapprovedSummary && (
            <div className="unapproved-summary">
              <small>{unapprovedQuestions.length ? `未入库 ${unapprovedQuestions.length} 道，点击题号定位（橙色需复核）` : "本试卷题目已全部入库"}</small>
              {unapprovedQuestions.length > 0 && (
                <div>
                  {unapprovedQuestions.map((question) => (
                    <button
                      type="button"
                      key={question.id}
                      className={question.status === "needs_attention" ? "warning" : ""}
                      title={question.status === "needs_attention" ? `第 ${question.number} 题存在识别或完整性警告` : `第 ${question.number} 题未达到自动入库条件`}
                      onClick={() => selectQuestion(question)}
                    >{question.number}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {pageQuestions.map((question) => (
            <button type="button" key={question.id} onClick={() => selectQuestion(question)} className={question.id === active.id ? "active" : ""}>
              <span className="question-number">{question.number}</span>
              <span><strong>{typeLabels[question.type]}</strong><small>{question.assets.length ? `含 ${question.assets.length} 张题图` : "纯文字题"}</small></span>
              {question.status === "approved" ? <Check size={14} className="status-ok" /> : question.status === "needs_attention" ? <AlertTriangle size={14} className="status-warn" /> : <i className="status-dot" />}
            </button>
          ))}
          {!pageQuestions.length && <p className="hint">本页未提取到题目</p>}
          <button type="button" className="add-question" onClick={() => void addManualQuestion()}><Plus size={15} /> 手动补一道题</button>
        </aside>

        <section className="source-panel">
          <div className="source-toolbar no-print">
            <div><span className="pill gray">原始页 {String(currentPage).padStart(2, "0")}</span><span className={`pill ${currentPageInfo.extractionStatus === "complete" ? "green" : currentPageInfo.extractionStatus === "failed" ? "orange" : "gray"}`}>{currentPageInfo.extractionStatus === "complete" ? "识别完成" : currentPageInfo.extractionStatus === "failed" ? `识别失败 · 第 ${currentPageInfo.extractionAttempt} 次` : currentPageInfo.extractionStatus === "running" ? "识别中" : currentPageInfo.extractionStatus === "retry_wait" ? "网络退避中" : "等待识别"}</span><span className="hint"><Crop size={13} /> 拖动选框；右下角缩放</span></div>
            <div className="source-actions">{!activeRegion && <button type="button" className="add-current-region" onClick={() => addQuestionRegion(currentPage)}><Plus size={13} /> 将本页加入第 {active.number} 题</button>}<div className="zoom-control"><button type="button" onClick={() => setZoom(clamp(zoom - 8, 55, 120))}><ZoomOut size={15} /></button><span>{zoom}%</span><button type="button" onClick={() => setZoom(clamp(zoom + 8, 55, 120))}><ZoomIn size={15} /></button></div></div>
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
              {pageQuestions.map((question) => {
                const region = question.regions.find((item) => item.page === currentPage) ?? { page: currentPage, bbox: question.bbox };
                return (
                <button
                  type="button"
                  key={question.id}
                  className={"question-box " + (question.id === active.id ? "active" : "")}
                  style={{ left: region.bbox.x + "%", top: region.bbox.y + "%", width: region.bbox.width + "%", height: region.bbox.height + "%" }}
                  onClick={() => selectQuestion(question)}
                  aria-label={"第 " + question.number + " 题范围"}
                ><span>Q{question.number}{question.regions.length > 1 ? ` · 跨${question.regions.length}页` : ""}</span></button>
                );
              })}
              {!activeAsset && activeRegion && editableBox && (
                <div
                  className="region-edit-box"
                  style={{ left: editableBox.x + "%", top: editableBox.y + "%", width: editableBox.width + "%", height: editableBox.height + "%" }}
                  onPointerDown={(event) => beginDrag(event, "move")}
                >
                  <span><Crop size={11} /> 拖动题框</span>
                  <button type="button" className="resize-handle" onPointerDown={(event) => beginDrag(event, "resize")} aria-label="缩放题目范围" />
                </div>
              )}
              {activeAsset && editableBox && (
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
          <div className="page-switch no-print"><button type="button" disabled={currentPage === pageStates[0]?.pageNumber} onClick={() => switchPage(-1)}><ChevronLeft size={15} /></button><span>第 {currentPage} 页 / 共 {pageStates.length} 页</span><button type="button" disabled={currentPage === pageStates.at(-1)?.pageNumber} onClick={() => switchPage(1)}><ChevronRight size={15} /></button></div>
        </section>

        <aside className="editor-panel no-print">
          <div className="editor-head">
            <div><span className="eyebrow">识别结果</span><h2>第 {active.number} 题 · {typeLabels[active.type]}</h2></div>
            <span className={"confidence " + (active.confidence < .9 ? "medium" : "")}>{Math.round(active.confidence * 100)}% 置信度</span>
          </div>

          <div className="cross-page-regions">
            <span>题目页面范围</span>
            {active.regions.map((region) => (
              <button key={region.page} type="button" className={region.page === currentPage ? "active" : ""} onClick={() => { setCurrentPage(region.page); setBoxMode("region"); }}>第 {region.page} 页</button>
            ))}
            {Math.min(...active.regions.map((region) => region.page)) > (pageStates[0]?.pageNumber ?? 1) && <button type="button" className="add-region-chip" onClick={() => addQuestionRegion(Math.min(...active.regions.map((region) => region.page)) - 1)}><Plus size={11} /> 前一页框</button>}
            {Math.max(...active.regions.map((region) => region.page)) < (pageStates.at(-1)?.pageNumber ?? 1) && <button type="button" className="add-region-chip" onClick={() => addQuestionRegion(Math.max(...active.regions.map((region) => region.page)) + 1)}><Plus size={11} /> 后一页框</button>}
          </div>

          {!activeRegion && (
            <div className="missing-region-card">
              <Crop size={16} />
              <div><strong>第 {currentPage} 页尚未属于第 {active.number} 题</strong><p>若本页是这道题的题干、答案或解析续页，可补框后拖动调整，再重新识别。</p></div>
              <button type="button" onClick={() => addQuestionRegion(currentPage)}><Plus size={12} /> 补本页框</button>
            </div>
          )}

          {editableBox && (
            <div className="crop-card">
              <div className="box-mode-tabs">
                <button type="button" className={boxMode === "region" ? "active" : ""} onClick={() => setBoxMode("region")}><Crop size={12} /> 题目范围</button>
                {pageAsset
                  ? <><button type="button" className={boxMode === "asset" ? "active" : ""} onClick={() => setBoxMode("asset")}><ImageIcon size={12} /> 题图裁剪</button><button type="button" className="remove-asset" onClick={removePageAsset}><X size={12} /> 移除题图</button></>
                  : <button type="button" className="add-asset" onClick={addManualAsset}><Plus size={12} /> 框选题图</button>}
              </div>
              <div className="field-label"><span>{activeAsset ? <ImageIcon size={13} /> : <Crop size={13} />} {activeAsset ? "题图裁剪" : `第 ${currentPage} 页题目范围`}</span><b>可拖动调整</b></div>
              <CropPreview bbox={editableBox} imageUrl={currentPageInfo.imageUrl} />
              <div className="bbox-grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}><span>{key === "width" ? "宽" : key === "height" ? "高" : key.toUpperCase()}</span><input type="number" min="0" max="100" step=".1" value={editableBox[key].toFixed(1)} onChange={(event) => patchBox({ ...editableBox, [key]: Number(event.target.value) })} /><i>%</i></label>
                ))}
              </div>
              {!activeAsset && (
                <button
                  type="button"
                  className={`btn reextract-question${regionAdjusted ? " adjusted" : ""}`}
                  disabled={reextractingId === active.id}
                  onClick={() => void reextractQuestion()}
                >
                  {reextractingId === active.id ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
                  {reextractingId === active.id
                    ? "正在按新题框识别…"
                    : regionAdjusted
                      ? `按新题框重新识别${active.regions.length > 1 ? `（${active.regions.length} 页）` : ""}`
                      : "重新识别此题"}
                </button>
              )}
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

          <label className="edit-field"><span>答案</span><input value={active.answer} onChange={(event) => patchActive({ answer: event.target.value })} /></label>
          <label className="edit-field"><span>解析</span><textarea rows={3} value={active.analysis} onChange={(event) => patchActive({ analysis: event.target.value })} /></label>
          <div className="render-preview"><span>解析渲染预览</span>{active.analysis.trim() ? <MathText text={active.analysis} /> : <em>暂无解析内容</em>}</div>

          <div className="tag-editor">
            <span className="field-label"><Tag size={13} /> 标签</span>
            <div className="tag-list">{active.tags.map((tag) => <button key={tag} type="button" onClick={() => patchActive({ tags: active.tags.filter((item) => item !== tag) })}>{tag}<X size={11} /></button>)}</div>
            <div className="tag-suggestions">{tagCatalog.filter((item) => !active.tags.includes(item.name)).slice(0, 12).map((item) => <button type="button" key={item.name} onClick={() => patchActive({ tags: [...active.tags, item.name] })}>{item.name}{!item.isPreset && <i>自定义</i>}</button>)}</div>
            <div className="tag-input"><input list="controlled-tags" placeholder="选择标签，或输入新标签加入目录" value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addTag(); } }} /><datalist id="controlled-tags">{tagCatalog.map((item) => <option key={item.name} value={item.name} />)}</datalist><button type="button" onClick={() => void addTag()}><Plus size={14} /></button></div>
          </div>

          {saveError && <p className="form-error">{saveError}</p>}
          <button type="button" className="btn btn-primary save-review" onClick={() => void saveQuestion()}><Check size={16} /> {saved ? "已保存，审核通过" : "保存并通过此题"}</button>
        </aside>
      </div>
    </div>
  );
}

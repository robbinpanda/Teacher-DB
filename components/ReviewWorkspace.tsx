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
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
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
import { missingPositiveNumbers } from "../lib/document-integrity";
import { isValidQuestionNumber } from "../lib/question-number-source";

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
  const [recognition, setRecognition] = useState<{
    questionTotal: number | null;
    completedQuestionNumbers: string[];
    completedQuestionCount: number;
    percent: number;
    phase: string;
    lastEventAt: string | null;
    message: string | null;
  }>(() => {
    let completedQuestionNumbers: string[] = [];
    try {
      const parsed = JSON.parse(sourceDocument.recognizedQuestionNumbersJson ?? "[]");
      if (Array.isArray(parsed)) completedQuestionNumbers = parsed.map(String).filter((value) => /^[1-9]\d*$/.test(value));
    } catch {
      completedQuestionNumbers = [];
    }
    const questionTotal = sourceDocument.recognitionQuestionTotal ?? null;
    return {
      questionTotal,
      completedQuestionNumbers,
      completedQuestionCount: completedQuestionNumbers.length,
      percent: questionTotal ? Math.min(100, Math.round(completedQuestionNumbers.length / questionTotal * 100)) : 0,
      phase: sourceDocument.jobStatus && ["paused", "failed", "retry_wait", "complete"].includes(sourceDocument.jobStatus)
        ? sourceDocument.jobStatus
        : sourceDocument.recognitionPhase ?? sourceDocument.jobStatus ?? "queued",
      lastEventAt: sourceDocument.recognitionLastEventAt ?? null,
      message: sourceDocument.recognitionMessage ?? null,
    };
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
  const [activeAssetId, setActiveAssetId] = useState("");
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
  const sourceStageRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const scrollUnlockTimerRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const dragRef = useRef<null | { mode: "move" | "resize"; page: number; x: number; y: number; box: BoundingBox }>(null);
  const active = questions.find((question) => question.id === activeId) ?? questions[0];
  const regionAdjusted = active ? adjustedQuestionIds.has(active.id) : false;
  const activeAsset = boxMode === "asset"
    ? active?.assets.find((asset) => asset.id === activeAssetId)
    : undefined;
  const activeRegion = active?.regions.find((region) => region.page === currentPage);
  const editableBox = activeAsset?.bbox ?? activeRegion?.bbox;
  const currentPageInfo = pageStates.find((page) => page.pageNumber === currentPage) ?? pageStates[0];
  const activeAssetPageInfo = activeAsset
    ? pageStates.find((page) => page.pageNumber === activeAsset.page)
    : undefined;
  const currentModelLabel = currentPageInfo.modelDisplayName ?? sourceDocument.modelDisplayName ?? currentPageInfo.modelName ?? sourceDocument.modelName ?? "模型记录缺失";
  const approvedCount = questions.filter((question) => question.status === "approved").length;
  const unapprovedQuestions = questions.filter((question) => question.status !== "approved");
  const progress = questions.length ? Math.round(approvedCount / questions.length * 100) : 0;
  const incompletePages = pageStates.filter((page) => page.extractionStatus !== "complete");
  const failedPages = pageStates.filter((page) => page.extractionStatus === "failed");
  const missingSourcePageCount = Math.max(0, sourceDocument.pageCount - pageStates.length);
  const unexpectedSourcePageCount = Math.max(0, pageStates.length - sourceDocument.pageCount);
  const missingQuestionNumbers = missingPositiveNumbers(questions.map((question) => question.number));
  const invalidQuestionNumbers = questions.map((question) => question.number).filter((number) => !isValidQuestionNumber(number));
  const documentReadyForReview = missingSourcePageCount === 0 && unexpectedSourcePageCount === 0 && incompletePages.length === 0 && missingQuestionNumbers.length === 0 && invalidQuestionNumbers.length === 0;
  const integrityMessage = missingSourcePageCount
    ? `原卷声明 ${sourceDocument.pageCount} 页，但目前只保存了 ${pageStates.length} 页。请重新上传同一 PDF 补齐，现有识别结果会保留。`
    : unexpectedSourcePageCount
      ? `原卷声明 ${sourceDocument.pageCount} 页，但保存了 ${pageStates.length} 页。请重新上传并核对 PDF 页数。`
    : incompletePages.length
      ? `还有 ${incompletePages.length} 页尚未识别完成，暂不能审核入库。`
      : missingQuestionNumbers.length
        ? `题号不连续，缺少第 ${missingQuestionNumbers.join("、")} 题。请补题或重新识别对应页面后再审核。`
        : invalidQuestionNumbers.length
          ? `存在非法题号 ${invalidQuestionNumbers.join("、")}，请改为从 1 开始、不带前导零的阿拉伯数字。`
        : "";
  const initialCompletedRef = useRef(sourceDocument.completedPageCount);

  useEffect(() => {
    const params = new URLSearchParams({ subject: documentMeta.subject || "数学", stage: stageFromGrade(documentMeta.grade) });
    fetch(`/api/tag-catalog?${params}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { tags?: TagCatalogEntry[] };
      if (response.ok && result.tags) setTagCatalog(result.tags);
    }).catch(() => undefined);
  }, [documentMeta.grade, documentMeta.subject]);

  useEffect(() => {
    const waitingForFinalization = ["queued", "processing", "retry_wait"].includes(job.status ?? "");
    if (!incompletePages.length && !missingSourcePageCount && !waitingForFinalization) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch(`/api/documents/${sourceDocument.id}/progress`, { cache: "no-store" }).catch(() => undefined);
      if (!response?.ok || cancelled) return;
      const result = await response.json() as {
        job?: { status?: string; nextAttemptAt?: string | null; lastError?: string | null };
        recognition?: typeof recognition;
        document?: { status?: string };
        pages?: Array<{ pageId: string; pageNumber: number; imageUrl: string; width: number; height: number; status: ReviewPage["extractionStatus"]; attempt: number; error?: string | null; nextAttemptAt?: string | null }>;
      };
      setJob(result.job ?? {});
      if (result.recognition) setRecognition(result.recognition);
      if (result.pages) {
        const completed = result.pages.filter((page) => page.status === "complete").length;
        setPageStates(result.pages.map((page) => ({
          id: page.pageId,
          pageNumber: page.pageNumber,
          imageUrl: page.imageUrl,
          width: page.width,
          height: page.height,
          extractionStatus: page.status,
          extractionAttempt: page.attempt,
          extractionError: page.error,
          nextAttemptAt: page.nextAttemptAt,
        })));
        if (completed > initialCompletedRef.current) {
          initialCompletedRef.current = completed;
          setNewResultsAvailable(true);
        }
      }
      if (result.job?.status === "complete" || result.document?.status === "reviewing") window.location.reload();
    };
    void poll();
    const timer = window.setInterval(poll, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [incompletePages.length, initialQuestions.length, job.status, missingSourcePageCount, sourceDocument.id]);

  useEffect(() => {
    function deleteSelectedBox(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!active) return;
      if (activeAsset) {
        event.preventDefault();
        const assetId = activeAsset.id;
        setQuestions((items) => items.map((item) => item.id === active.id
          ? { ...item, assets: item.assets.filter((asset) => asset.id !== assetId) }
          : item));
        const remaining = active.assets.filter((asset) => asset.id !== assetId);
        if (remaining.length) setActiveAssetId(remaining[0].id);
        else setBoxMode("region");
        setSaved(false);
        return;
      }
      if (activeRegion) {
        event.preventDefault();
        const regions = active.regions.filter((region) => region.page !== currentPage);
        const primary = regions[0];
        setQuestions((items) => items.map((item) => item.id === active.id
          ? { ...item, regions, page: primary?.page ?? item.page, bbox: primary?.bbox ?? item.bbox }
          : item));
        setAdjustedQuestionIds((items) => new Set(items).add(active.id));
        setSaved(false);
      }
    }
    window.addEventListener("keydown", deleteSelectedBox);
    return () => window.removeEventListener("keydown", deleteSelectedBox);
  }, [active, activeAsset, activeRegion, currentPage]);

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
      setRecognition({
        questionTotal: null,
        completedQuestionNumbers: [],
        completedQuestionCount: 0,
        percent: 0,
        phase: "queued",
        lastEventAt: null,
        message: "等待整卷模型调用",
      });
      setPageStates((items) => items.map((page) => page.extractionStatus === "complete" ? page : { ...page, extractionStatus: "queued", extractionError: null, nextAttemptAt: null }));
      setRetrying(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "重新识别失败");
      setRetrying(false);
    }
  }

  const recognitionInProgress = ["queued", "processing", "retry_wait", "paused", "failed"].includes(job.status ?? "");
  const recognitionPhaseLabel = recognition.phase === "thinking"
    ? "模型正在通读与思考"
    : recognition.phase === "receiving"
      ? "正在逐题接收并保存"
      : recognition.phase === "finalizing"
        ? "正在校验完整性"
        : recognition.phase === "retry_wait"
          ? "等待自动重试"
          : recognition.phase === "error"
            ? "识别失败"
            : recognition.phase === "paused"
              ? "识别已暂停"
              : "正在连接模型";

  if (!active || !currentPageInfo || recognitionInProgress) {
    return (
      <div className="page-shell">
        <Link href="/" className="btn"><ArrowLeft size={16} /> 返回</Link>
        <section className="card extraction-empty">
          {currentPageInfo && <div className="empty-page-preview"><NextImage src={currentPageInfo.imageUrl} alt="原始试卷首页" width={currentPageInfo.width} height={currentPageInfo.height} unoptimized priority /></div>}
          <div className="empty-progress-panel">
            <h1>{sourceDocument.name}</h1>
            <p>整份试卷只调用一次模型。模型确认总题数后逐题流式返回，后端每收到一题就立即校验并保存。</p>
            <div className="question-stream-heading">
              <strong>{recognition.questionTotal
                ? `已完成 ${recognition.completedQuestionCount} / ${recognition.questionTotal} 题`
                : "正在统计整卷题目总数"}</strong>
              <span>{recognitionPhaseLabel}</span>
            </div>
            <div className="question-stream-bar" role="progressbar" aria-valuemin={0} aria-valuemax={recognition.questionTotal ?? undefined} aria-valuenow={recognition.completedQuestionCount}>
              <span style={{ width: `${recognition.percent}%` }} />
            </div>
            <div className="question-stream-status">
              {recognition.completedQuestionNumbers.length
                ? recognition.completedQuestionNumbers.map((number) => <span key={number}><Check size={13} /> 第 {number} 题</span>)
                : <em>{recognition.message ?? "模型正在通读全部页面，题目完成后会逐个显示在这里。"}</em>}
            </div>
            <p className="stream-timeout-note">模型持续输出文字或思考活动时会一直处理；只有连续 90 秒没有任何活动，或模型明确报错，才会进入退避重试。</p>
            {job.status === "retry_wait" && job.nextAttemptAt && <p className="queue-notice">网络退避中，将在 {new Date(job.nextAttemptAt).toLocaleString()} 自动继续。</p>}
            {job.status === "paused" && <p className="queue-notice">全部识别任务已暂停。请在工作台点击“全部开始”，未完成试卷会立即重新排队。</p>}
            {(job.lastError || sourceDocument.error) && <p className="form-error">{job.lastError || sourceDocument.error}</p>}
            <div className="header-actions">
              <button type="button" className="btn btn-primary" disabled={retrying || ["queued", "processing"].includes(job.status ?? "")} onClick={() => void retryExtraction()}><RefreshCw size={15} /> {retrying ? "正在加入队列…" : ["queued", "processing", "retry_wait"].includes(job.status ?? "") ? "可靠队列处理中" : "重新识别整卷"}</button>
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
      if (primary) patchActive({ regions, page: primary.page, bbox: primary.bbox });
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
    const beforeFirstPage = regionPages.length > 0 && pageNumber < Math.min(...regionPages);
    const bbox: BoundingBox = !regionPages.length
      ? { x: 8, y: 8, width: 84, height: 36 }
      : beforeFirstPage
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

  function addManualAsset(role: "question" | "answer" = "question") {
    const regionBox = active.regions.find((region) => region.page === currentPage)?.bbox ?? active.bbox;
    const width = Math.max(3, regionBox.width * .5);
    const height = Math.max(3, regionBox.height * .5);
    const asset = {
      id: crypto.randomUUID(),
      kind: "figure" as const,
      role,
      label: `${role === "answer" ? "答案图" : "题图"} ${active.assets.length + 1}`,
      page: currentPage,
      bbox: {
        x: clamp(regionBox.x + (regionBox.width - width) / 2, 0, 100 - width),
        y: clamp(regionBox.y + (regionBox.height - height) / 2, 0, 100 - height),
        width,
        height,
      },
    };
    patchActive({ assets: [...active.assets, asset] });
    setActiveAssetId(asset.id);
    setBoxMode("asset");
  }

  function removeActiveAsset() {
    if (!activeAsset) return;
    const remainingAssets = active.assets.filter((asset) => asset.id !== activeAsset.id);
    patchActive({ assets: active.assets.filter((asset) => asset.id !== activeAsset.id) });
    if (remainingAssets.length) {
      setActiveAssetId(remainingAssets[0].id);
      showPage(remainingAssets[0].page);
    }
    else setBoxMode("region");
  }

  function removeActiveRegion() {
    if (!activeRegion) return;
    const regions = active.regions.filter((region) => region.page !== currentPage);
    const primary = regions[0];
    patchActive({ regions, page: primary?.page ?? active.page, bbox: primary?.bbox ?? active.bbox });
    setAdjustedQuestionIds((items) => new Set(items).add(active.id));
  }

  function showPage(pageNumber: number, behavior: ScrollBehavior = "smooth") {
    setCurrentPage(pageNumber);
    programmaticScrollRef.current = true;
    if (scrollUnlockTimerRef.current !== null) window.clearTimeout(scrollUnlockTimerRef.current);
    window.requestAnimationFrame(() => {
      const page = pageRefs.current.get(pageNumber);
      const stage = sourceStageRef.current;
      const wrapper = page?.closest<HTMLElement>(".exam-page-wrap");
      if (stage && wrapper) stage.scrollTo({ top: Math.max(0, wrapper.offsetTop - 8), behavior });
      scrollUnlockTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false;
        scrollUnlockTimerRef.current = null;
      }, behavior === "smooth" ? 600 : 0);
    });
  }

  function syncCurrentPageFromScroll() {
    if (programmaticScrollRef.current) return;
    const stage = sourceStageRef.current;
    if (!stage) return;
    const top = stage.getBoundingClientRect().top + 24;
    let nearest = currentPage;
    let distance = Number.POSITIVE_INFINITY;
    for (const [pageNumber, element] of pageRefs.current) {
      const candidateDistance = Math.abs(element.getBoundingClientRect().top - top);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        nearest = pageNumber;
      }
    }
    if (nearest !== currentPage) setCurrentPage(nearest);
  }

  function beginDrag(event: React.PointerEvent, mode: "move" | "resize") {
    if (!editableBox) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, page: currentPage, x: event.clientX, y: event.clientY, box: { ...editableBox } };
    pageRefs.current.get(currentPage)?.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent) {
    const drag = dragRef.current;
    const rect = drag ? pageRefs.current.get(drag.page)?.getBoundingClientRect() : undefined;
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
    const nextStatus = documentReadyForReview ? "approved" : "needs_attention";
    const response = await fetch("/api/questions/" + active.id, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...active, status: nextStatus }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setSaveError(result.error ?? "保存失败，请稍后重试");
      return;
    }
    patchActive({ status: nextStatus });
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
        recognition?: Pick<Question, "type" | "stem" | "options" | "answer" | "analysis" | "tags" | "confidence" | "needsHumanReview">;
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
        status: recognition.needsHumanReview ? "needs_attention" : "pending",
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

  function selectQuestion(question: QuestionWithSource, targetPage = question.page) {
    setActiveId(question.id);
    setActiveAssetId("");
    setBoxMode("region");
    showPage(targetPage);
    setSaveError("");
  }

  function switchPage(direction: -1 | 1) {
    const index = pageStates.findIndex((page) => page.pageNumber === currentPage);
    const next = pageStates[clamp(index + direction, 0, pageStates.length - 1)];
    if (!next) return;
    showPage(next.pageNumber);
    setActiveAssetId("");
    setBoxMode("region");
    const firstQuestion = questions.find((question) => question.regions.some((region) => region.page === next.pageNumber));
    if (firstQuestion) setActiveId(firstQuestion.id);
  }

  async function runBulkAction(action: "approve_without_review" | "remove_all_from_bank") {
    if (action === "approve_without_review" && !documentReadyForReview) { setSaveError(integrityMessage); return; }
    if (action === "remove_all_from_bank" && !window.confirm("将本试卷所有已入库题目移出题库？题目内容、页面框选和审核记录都会保留，可以之后重新入库。")) return;
    setBulkAction(action === "approve_without_review" ? "approve" : "remove");
    setSaveError("");
    setBulkNotice("");
    try {
      const response = await fetch(`/api/documents/${sourceDocument.id}/questions/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; changed?: number; reviewRequired?: number };
      if (!response.ok) throw new Error(result.error ?? "批量操作失败");
      if (action === "approve_without_review") {
        setQuestions((items) => items.map((item) => !item.needsHumanReview && item.status === "pending" ? { ...item, status: "approved" } : item));
        setShowUnapprovedSummary(true);
        setBulkNotice(`已入库 ${result.changed ?? 0} 道模型明确判定无需核查的题目${result.reviewRequired ? `；另有 ${result.reviewRequired} 道需要人工核查` : ""}`);
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
          <div><strong>{sourceDocument.name}</strong><span>第 {currentPage} / {sourceDocument.pageCount} 页　·　整卷提取 {questions.length} 道题　·　模型 {sourceDocument.modelDisplayName ?? sourceDocument.modelName ?? "记录缺失"}</span></div>
        </div>
        <div className="review-progress"><span>审核进度</span><div className="progress"><i style={{ width: progress + "%" }} /></div><b>{approvedCount} / {questions.length}</b></div>
        <div className="header-actions">
          <input ref={answerInputRef} hidden type="file" multiple accept="application/pdf,image/*" onChange={(event) => void importAnswers(event.target.files)} />
          {newResultsAvailable && <button className="btn btn-small" type="button" title="加载刚完成的识别结果" onClick={() => window.location.reload()}><RefreshCw size={14} /> 刷新结果</button>}
          {incompletePages.length > 0 && <button className="btn btn-small" type="button" disabled={retrying} onClick={() => void retryExtraction()}><RefreshCw size={14} /> {retrying ? "识别中…" : failedPages.length ? "重试整卷" : "继续整卷识别"}</button>}
          <button className="btn btn-primary btn-small" type="button" title={documentReadyForReview ? "仅入库模型明确判定无需人工核查的题目" : integrityMessage} disabled={Boolean(bulkAction) || !documentReadyForReview} onClick={() => void runBulkAction("approve_without_review")}><Check size={14} /> {bulkAction === "approve" ? "入库中…" : "自动入库"}</button>
          <details className="review-more-menu">
            <summary className="btn btn-small"><MoreHorizontal size={15} /> 更多</summary>
            <div>
              <button type="button" disabled={answerImporting || approvedCount === 0} title={approvedCount === 0 ? "请先审核入库题目" : ""} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); answerInputRef.current?.click(); }}><FileUp size={14} /><span><strong>{answerImporting ? "答案匹配中…" : "导入答案"}</strong><small>从答案 PDF 或图片匹配已入库题目</small></span></button>
              <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setDetailsOpen((value) => !value); }}><Info size={14} /><span><strong>试卷详情</strong><small>修改学科、年级、年份和来源信息</small></span></button>
              <button className="danger" type="button" disabled={Boolean(bulkAction)} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void runBulkAction("remove_all_from_bank"); }}><Trash2 size={14} /><span><strong>{bulkAction === "remove" ? "正在移出…" : "全部移出题库"}</strong><small>保留识别内容，可稍后重新入库</small></span></button>
            </div>
          </details>
        </div>
      </header>

      {(detailsOpen || answerImportMessage || bulkNotice) && <div className="review-notice-panel no-print">
        {detailsOpen && <div className="document-detail-editor"><label>学科<input value={documentMeta.subject} onChange={(event) => setDocumentMeta({ ...documentMeta, subject: event.target.value })} /></label><label>年级<input value={documentMeta.grade} onChange={(event) => setDocumentMeta({ ...documentMeta, grade: event.target.value })} /></label><label>年份<input type="number" value={documentMeta.year} onChange={(event) => setDocumentMeta({ ...documentMeta, year: event.target.value })} /></label><label>考试类型<input placeholder="如：中考 / 二模" value={documentMeta.examType} onChange={(event) => setDocumentMeta({ ...documentMeta, examType: event.target.value })} /></label><label>地区<input value={documentMeta.region} onChange={(event) => setDocumentMeta({ ...documentMeta, region: event.target.value })} /></label><label>学校<input value={documentMeta.school} onChange={(event) => setDocumentMeta({ ...documentMeta, school: event.target.value })} /></label><button type="button" className="btn btn-primary btn-small" onClick={() => void saveDocumentDetails()}>保存详情</button>{detailMessage && <span>{detailMessage}</span>}</div>}
        {answerImportMessage && <p className={/失败|超过|无效/.test(answerImportMessage) ? "form-error" : "form-note"}>{answerImportMessage}</p>}
        {bulkNotice && <p className="form-note">{bulkNotice}</p>}
      </div>}
      {!documentReadyForReview && <div className="review-integrity-alert no-print"><AlertTriangle size={16} /><div><strong>完整性检查未通过，审核已暂停</strong><p>{integrityMessage}</p></div>{missingSourcePageCount > 0 && <Link href="/" className="btn btn-small">重新上传补齐</Link>}</div>}

      <div className="review-body">
        <aside className="question-rail no-print">
          <div className="rail-title"><span>本卷题目</span><b>{questions.length}</b></div>
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
                      title={question.status === "needs_attention" ? `第 ${question.number} 题被模型标记为需要人工核查` : `第 ${question.number} 题尚未入库`}
                      onClick={() => selectQuestion(question)}
                    >{question.number}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {questions.map((question) => (
            <button type="button" key={question.id} onClick={() => selectQuestion(question)} className={question.id === active.id ? "active" : ""}>
              <span className="question-number">{question.number}</span>
              <span><strong>{typeLabels[question.type]}</strong><small>{question.assets.length
                ? `题图 ${question.assets.filter((asset) => asset.role === "question").length} · 答案图 ${question.assets.filter((asset) => asset.role === "answer").length}`
                : "无图片"}</small></span>
              {question.status === "approved" ? <Check size={14} className="status-ok" /> : question.status === "needs_attention" ? <AlertTriangle size={14} className="status-warn" /> : <i className="status-dot" />}
            </button>
          ))}
          {!questions.length && <p className="hint">本卷未提取到题目</p>}
          <button type="button" className="add-question" onClick={() => void addManualQuestion()}><Plus size={15} /> 手动补一道题</button>
        </aside>

        <section className="source-panel">
          <div className="source-toolbar no-print">
            <div><span className="pill gray">原始页 {String(currentPage).padStart(2, "0")}</span><span className="pill green">整卷识别完成</span><span className="pill source-model-pill" title={currentPageInfo.modelName && currentPageInfo.modelName !== currentModelLabel ? `${currentModelLabel}（${currentPageInfo.modelName}）` : currentModelLabel}><Sparkles size={11} />{currentModelLabel}</span><span className="hint"><Crop size={13} /> 上下滚动查看整卷；Delete 删除当前框</span></div>
            <div className="source-actions">{!activeRegion && <button type="button" className="add-current-region" onClick={() => addQuestionRegion(currentPage)}><Plus size={13} /> 将本页加入第 {active.number} 题</button>}<div className="zoom-control" aria-label="原卷缩放"><button type="button" aria-label="缩小原卷" title="缩小原卷" disabled={zoom <= 55} onClick={() => setZoom(clamp(zoom - 8, 55, 120))}><ZoomOut size={15} /></button><span aria-live="polite">{zoom}%</span><button type="button" aria-label="放大原卷" title="放大原卷" disabled={zoom >= 120} onClick={() => setZoom(clamp(zoom + 8, 55, 120))}><ZoomIn size={15} /></button></div></div>
          </div>
          <div ref={sourceStageRef} className="page-stage page-stage-continuous" style={{ display: "block" }} onScroll={syncCurrentPageFromScroll}>
            {pageStates.map((pageInfo, pageIndex) => {
              const questionsForPage = questions.filter((question) => question.regions.some((region) => region.page === pageInfo.pageNumber));
              const assetsForPage = active.assets.filter((asset) => asset.page === pageInfo.pageNumber);
              const isCurrentPage = pageInfo.pageNumber === currentPage;
              return (
                <div className="exam-page-wrap" key={pageInfo.id} style={{ position: "relative", display: "flex", justifyContent: "center", margin: "0 auto 30px", paddingTop: 20 }}>
                  <span className="continuous-page-label">第 {pageInfo.pageNumber} 页</span>
                  <div
                    ref={(element) => { if (element) pageRefs.current.set(pageInfo.pageNumber, element); else pageRefs.current.delete(pageInfo.pageNumber); }}
                    className={`exam-page${isCurrentPage ? " current" : ""}`}
                    style={{ width: zoom + "%" }}
                    onClick={() => setCurrentPage(pageInfo.pageNumber)}
                    onPointerMove={moveDrag}
                    onPointerUp={() => { dragRef.current = null; }}
                    onPointerCancel={() => { dragRef.current = null; }}
                  >
                    <NextImage src={pageInfo.imageUrl} alt={`原试卷第 ${pageInfo.pageNumber} 页`} width={pageInfo.width} height={pageInfo.height} draggable={false} priority={pageIndex === 0} unoptimized />
                    {questionsForPage.map((question) => {
                      const region = question.regions.find((item) => item.page === pageInfo.pageNumber)!;
                      return <button type="button" key={question.id} className={"question-box " + (question.id === active.id ? "active" : "")} style={{ left: region.bbox.x + "%", top: region.bbox.y + "%", width: region.bbox.width + "%", height: region.bbox.height + "%" }} onClick={(event) => { event.stopPropagation(); selectQuestion(question, pageInfo.pageNumber); }} aria-label={"第 " + question.number + " 题范围"}><span>Q{question.number}{question.regions.length > 1 ? ` · 跨${question.regions.length}页` : ""}</span></button>;
                    })}
                    {isCurrentPage && !activeAsset && activeRegion && editableBox && <div className="region-edit-box" style={{ left: editableBox.x + "%", top: editableBox.y + "%", width: editableBox.width + "%", height: editableBox.height + "%" }} onPointerDown={(event) => beginDrag(event, "move")}><span><Crop size={11} /> 拖动题框 · Del 删除</span><button type="button" className="resize-handle" onPointerDown={(event) => beginDrag(event, "resize")} aria-label="缩放题目范围" /></div>}
                    {assetsForPage.filter((asset) => !isCurrentPage || asset.id !== activeAsset?.id).map((asset, index) => <button type="button" key={asset.id} className={`asset-box asset-box-passive role-${asset.role}`} style={{ left: asset.bbox.x + "%", top: asset.bbox.y + "%", width: asset.bbox.width + "%", height: asset.bbox.height + "%" }} onClick={(event) => { event.stopPropagation(); setCurrentPage(pageInfo.pageNumber); setActiveAssetId(asset.id); setBoxMode("asset"); }} aria-label={`编辑${asset.role === "answer" ? "答案图" : "题图"} ${index + 1}`}><span><ImageIcon size={11} /> {asset.role === "answer" ? "答案图" : "题图"} {index + 1}</span></button>)}
                    {isCurrentPage && activeAsset?.page === pageInfo.pageNumber && editableBox && <div className={`asset-box role-${activeAsset.role}`} style={{ left: editableBox.x + "%", top: editableBox.y + "%", width: editableBox.width + "%", height: editableBox.height + "%" }} onPointerDown={(event) => beginDrag(event, "move")}><span><ImageIcon size={11} /> {activeAsset.role === "answer" ? "答案图" : "题图"} · Del 删除</span><button type="button" className="resize-handle" onPointerDown={(event) => beginDrag(event, "resize")} aria-label="缩放裁剪框" /></div>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="page-switch no-print"><button type="button" disabled={currentPage === pageStates[0]?.pageNumber} onClick={() => switchPage(-1)}><ChevronLeft size={15} /></button><span>第 {currentPage} 页 / 共 {pageStates.length} 页</span><button type="button" disabled={currentPage === pageStates.at(-1)?.pageNumber} onClick={() => switchPage(1)}><ChevronRight size={15} /></button></div>
        </section>

        <aside className="editor-panel no-print">
          <div className="editor-head">
            <div className="editor-title"><span className="eyebrow"><Sparkles size={12} /> AI 提取结果</span><h2>第 {active.number} 题 · {typeLabels[active.type]}</h2></div>
            <div className="model-assessment" title={`模型标记：${active.needsHumanReview ? "需要人工核查" : "无需人工核查"}；置信度仅供参考`}>
              <span className={active.needsHumanReview ? "needs-review" : "clear"}>{active.needsHumanReview ? <AlertTriangle size={12} /> : <Check size={12} />}{active.needsHumanReview ? "需人工核查" : "无需人工核查"}</span>
              <span className="confidence-score"><b>{Math.round(active.confidence * 100)}%</b><small>置信度</small></span>
            </div>
          </div>

          <section className="question-asset-gallery" aria-label="本题图片">
            <div className="asset-gallery-title"><span><ImageIcon size={13} /> 本题图片</span><small>选择题目后自动显示</small></div>
            {active.assets.length ? <div className="asset-gallery-grid">{active.assets.map((asset, index) => {
              const pageInfo = pageStates.find((page) => page.pageNumber === asset.page);
              if (!pageInfo) return null;
              return <button type="button" key={asset.id} className={activeAsset?.id === asset.id ? "active" : ""} onClick={() => { setActiveAssetId(asset.id); setBoxMode("asset"); showPage(asset.page); }}><CropPreview bbox={asset.bbox} imageUrl={pageInfo.imageUrl} /><span><b>{asset.role === "answer" ? "答案图" : "题图"} {index + 1}</b><small>第 {asset.page} 页 · 点击定位裁剪框</small></span></button>;
            })}</div> : <p className="asset-gallery-empty">本题没有需要保留为图片的题图或答案图。</p>}
          </section>

          <div className="cross-page-regions">
            <div><span>人工题目范围</span><small>{active.regions.length > 1 ? `跨 ${active.regions.length} 页` : active.regions.length ? "单页题目" : "尚未框选"}</small></div>
            <div className="region-chips">
              {active.regions.map((region) => (
                <button key={region.page} type="button" className={region.page === currentPage ? "active" : ""} onClick={() => { showPage(region.page); setBoxMode("region"); }}>第 {region.page} 页</button>
              ))}
              {!active.regions.length && <button type="button" className="add-region-chip" onClick={() => addQuestionRegion(currentPage)}><Plus size={11} /> 从第 {currentPage} 页开始框选</button>}
              {active.regions.length > 0 && Math.min(...active.regions.map((region) => region.page)) > (pageStates[0]?.pageNumber ?? 1) && <button type="button" className="add-region-chip" onClick={() => addQuestionRegion(Math.min(...active.regions.map((region) => region.page)) - 1)}><Plus size={11} /> 前一页</button>}
              {active.regions.length > 0 && Math.max(...active.regions.map((region) => region.page)) < (pageStates.at(-1)?.pageNumber ?? 1) && <button type="button" className="add-region-chip" onClick={() => addQuestionRegion(Math.max(...active.regions.map((region) => region.page)) + 1)}><Plus size={11} /> 后一页</button>}
            </div>
          </div>

          {!activeRegion && (
            <div className="missing-region-card">
              <Crop size={16} />
              <div><strong>当前按首行所在的第 {active.page} 页定位</strong><p>常规审核无需框选整题范围；只有需要重新识别本题时，再逐页添加并调整题框。</p></div>
              <button type="button" onClick={() => addQuestionRegion(currentPage)}><Plus size={12} /> 框选并重新识别</button>
            </div>
          )}

          {(editableBox || active.assets.length > 0) && (
            <div className="crop-card">
              <div className="box-mode-tabs">
                <button type="button" className={boxMode === "region" ? "active" : ""} onClick={() => setBoxMode("region")}><Crop size={12} /> 题目范围</button>
                {active.assets.map((asset, index) => <button type="button" key={asset.id} className={activeAsset?.id === asset.id ? "active" : ""} onClick={() => { setActiveAssetId(asset.id); setBoxMode("asset"); showPage(asset.page); }}><ImageIcon size={12} /> {asset.role === "answer" ? "答案图" : "题图"} {index + 1}</button>)}
                <button type="button" className="add-asset" onClick={() => addManualAsset("question")}><Plus size={12} /> 新增题图</button>
                <button type="button" className="add-asset answer" onClick={() => addManualAsset("answer")}><Plus size={12} /> 新增答案图</button>
                {activeAsset && <button type="button" className="remove-asset" onClick={removeActiveAsset}><X size={12} /> 删除此图</button>}
                {!activeAsset && activeRegion && <button type="button" className="remove-asset" onClick={removeActiveRegion}><X size={12} /> 删除此题框</button>}
              </div>
              {editableBox && <div className="field-label"><span>{activeAsset ? <ImageIcon size={13} /> : <Crop size={13} />} {activeAsset ? `${activeAsset.role === "answer" ? "答案图" : "题图"}裁剪` : `第 ${currentPage} 页题目范围`}</span><b>可拖动调整</b></div>}
              {activeAsset && <>
                {activeAssetPageInfo && <CropPreview bbox={activeAsset.bbox} imageUrl={activeAssetPageInfo.imageUrl} />}
                <label className="asset-label-edit"><span>图片用途</span><select value={activeAsset.role} onChange={(event) => patchActive({ assets: active.assets.map((asset) => asset.id === activeAsset.id ? { ...asset, role: event.target.value as "question" | "answer" } : asset) })}><option value="question">题目图片（会进入试卷）</option><option value="answer">答案图片（仅进入解析卷）</option></select></label>
                <label className="asset-label-edit"><span>图片名称</span><input value={activeAsset.label} onChange={(event) => patchActive({ assets: active.assets.map((asset) => asset.id === activeAsset.id ? { ...asset, label: event.target.value } : asset) })} /></label>
              </>}
              {editableBox && <div className="bbox-grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}><span>{key === "width" ? "宽" : key === "height" ? "高" : key.toUpperCase()}</span><input type="number" min="0" max="100" step=".1" value={editableBox[key].toFixed(1)} onChange={(event) => patchBox({ ...editableBox, [key]: Number(event.target.value) })} /><i>%</i></label>
                ))}
              </div>}
              {!activeAsset && activeRegion && (
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
          <div className="render-preview"><span className="render-preview-label">渲染预览</span><MathText text={active.stem} /></div>

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
          <div className="render-preview analysis-render-preview">
            <span className="render-preview-label">解析渲染预览</span>
            <div className="analysis-render-scroll" tabIndex={0}>
              {active.analysis.trim() ? <MathText text={active.analysis} /> : <em>暂无解析内容</em>}
            </div>
          </div>

          <div className="tag-editor">
            <span className="field-label"><Tag size={13} /> 标签</span>
            <div className="tag-list">{active.tags.map((tag) => <button key={tag} type="button" onClick={() => patchActive({ tags: active.tags.filter((item) => item !== tag) })}>{tag}<X size={11} /></button>)}</div>
            <div className="tag-suggestions">{tagCatalog.filter((item) => !active.tags.includes(item.name)).slice(0, 12).map((item) => <button type="button" key={item.name} onClick={() => patchActive({ tags: [...active.tags, item.name] })}>{item.name}{!item.isPreset && <i>自定义</i>}</button>)}</div>
            <div className="tag-input"><input list="controlled-tags" placeholder="选择标签，或输入新标签加入目录" value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addTag(); } }} /><datalist id="controlled-tags">{tagCatalog.map((item) => <option key={item.name} value={item.name} />)}</datalist><button type="button" onClick={() => void addTag()}><Plus size={14} /></button></div>
          </div>

          {saveError && <p className="form-error">{saveError}</p>}
          <button type="button" className="btn btn-primary save-review" title={!documentReadyForReview ? "先保存修正；完整性恢复后才能审核通过" : undefined} onClick={() => void saveQuestion()}><Check size={16} /> {saved ? (documentReadyForReview ? "已保存，审核通过" : "修改已保存") : (documentReadyForReview ? "保存并通过此题" : "保存修改")}</button>
        </aside>
      </div>
    </div>
  );
}

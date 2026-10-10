"use client";
import { useEffect, useRef, useState } from "react";
import type { ReviewDocument, ReviewPage } from "../../lib/types";
import { progressResponseSchema } from "../../lib/api-contracts";

export function useReviewProgress(initialDocument: ReviewDocument, pages: ReviewPage[]) {
  const [sourceDocument, setDocument] = useState(initialDocument);
  const [processorAvailable, setProcessorAvailable] = useState(false);
  const [newResultsAvailable, setNewResultsAvailable] = useState(false);
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

  const initialCompletedRef = useRef(sourceDocument.completedPageCount);
  const incompletePageCount = pageStates.filter(page => page.extractionStatus !== "complete").length;
  const missingSourcePageCount = Math.max(0, sourceDocument.pageCount - pageStates.length);
  useEffect(() => {
    const waitingForFinalization = ["queued", "processing", "retry_wait"].includes(job.status ?? "");
    const waitingForPages = sourceDocument.status === "uploading";
    if (!incompletePageCount && !missingSourcePageCount && !waitingForFinalization && !waitingForPages) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/documents/${sourceDocument.id}/progress`, { cache: "no-store", signal: controller.signal });
        if (!response.ok || cancelled) return;
        const result = progressResponseSchema.parse(await response.json());
        if (cancelled) return;
        if (result.document?.pageCount !== undefined && (!Number.isInteger(result.document.pageCount) || result.document.pageCount < 0 || result.document.pageCount > 250)) throw new Error("无效页数");
        setProcessorAvailable(Boolean(result.processorAvailable));
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
            modelDisplayName: page.modelDisplayName,
            modelName: page.modelName,
            modelProvider: page.modelProvider,
          })));
          if (completed > initialCompletedRef.current) {
            initialCompletedRef.current = completed;
            setNewResultsAvailable(true);
          }
        }
        const justCompleted = result.job?.status === "complete" && job.status !== "complete";
        const justReadyForReview = result.document?.status === "reviewing" && !["reviewing", "complete"].includes(sourceDocument.status);
        if (result.document) setDocument(previous => ({ ...previous, ...result.document }));
        if (justCompleted || justReadyForReview) {
          cancelled = true;
          window.location.reload();
        }
      } catch {
        // Startup and temporary network failures are retried without losing review state.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [incompletePageCount, job.status, missingSourcePageCount, sourceDocument.id, sourceDocument.status]);

  return { sourceDocument, pageStates, setPageStates, job, setJob, recognition, setRecognition, newResultsAvailable, setNewResultsAvailable, processorAvailable };
}

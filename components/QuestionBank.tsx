"use client";

import Link from "next/link";
import Image from "next/image";
import { isVariationQuestion } from "../lib/question-provenance";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  House,
  ImageIcon,
  LoaderCircle,
  Plus,
  SlidersHorizontal,
  PackageOpen,
  Pencil,
  Save,
  Search,
  ShoppingBasket,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import {
  chinaRegions,
  gradesByStage,
  textbookEditions,
  educationStages,
  subjects,
  stageLabel,
  type EducationStage,
  type EducationSubject,
} from "../lib/education-taxonomy";
import type { BankFacet, QuestionFolder, QuestionType, QuestionWithSource, TeacherProfile, VariationReview } from "../lib/types";
import type { ValidatedVariation } from "../lib/question-variations";
import { typeLabels } from "../lib/question-labels";
import { moveOrderedItem } from "../lib/ordered-selection";
import { stripLeadingQuestionNumber } from "../lib/question-text.js";
import { AnalysisWithImages } from "./AnalysisWithImages";
import { KnowledgeFilter } from "./KnowledgeFilter";
import { useQuestionBasket } from "./useQuestionBasket";
import { SelectionCheckbox } from "./SelectionCheckbox";
import { MathText } from "./MathText";
import { useEducationScope } from "./AppShell";

type BankStats = { total: number; approved: number; withAssets: number; papers: number };
type Pagination = { page: number; pageSize: number; total: number; pageCount: number };
type SourceFacet = {
  id: string;
  name: string;
  year: number | null;
  examType: string | null;
  region: string | null;
  textbook: string | null;
  school: string | null;
};

type ExplorerSelection = {
  kind: "all" | "unfiled" | "folder" | "grade" | "region" | "textbook";
  value?: string;
};

type VariationCandidate = {
  id: string;
  ordinal: number;
  status: string;
  question: ValidatedVariation;
  review: VariationReview;
  diagramPreviewUrl: string | null;
};

type VariationResult = {
  runId: string;
  status: string;
  qualityMode: "quick" | "reviewed";
  cached?: boolean;
  workflow: {
    generator?: string;
    reviewer?: string | null;
    plan?: { objective: string; prerequisites: string; difficultyRationale: string; misconception: string; changes: string[] };
    verification?: Array<{ index: number; explanation: string }>;
    rejectedCandidateCount?: number;
    passed?: number;
    revised?: number;
    rulesPassed?: number;
    diagrams?: number;
  };
  candidates: VariationCandidate[];
};

type VariationModelProfile = { id: string; displayName: string; enabled: boolean };

const defaultSelection: ExplorerSelection = { kind: "all" };

export function QuestionBank({
  ownerId,
  requestedDocumentId,
  initialQuestions,
  initialPagination,
  stats,
  availableTags,
  sources,
  folders,
  facets,
  initialProfile,
}: {
  ownerId: string;
  requestedDocumentId?: string;
  initialQuestions: QuestionWithSource[];
  initialPagination: Pagination;
  stats: BankStats;
  availableTags: string[];
  sources: SourceFacet[];
  folders: QuestionFolder[];
  facets: { grades: BankFacet[]; regions: BankFacet[]; textbooks: BankFacet[] };
  initialProfile: TeacherProfile;
}) {
  const { subject, stage, setSubject, setStage } = useEducationScope();
  const basket = useQuestionBasket(ownerId, subject, stage);
  const basketIds = new Set(basket.items.map(question => question.id));
  const basketPanel = useRef<HTMLElement>(null);
  const [questions, setQuestions] = useState(initialQuestions);
  const [pagination, setPagination] = useState(initialPagination);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [library, setLibrary] = useState<"personal" | "platform">("personal");
  const [gradeFilter, setGradeFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [textbookFilter, setTextbookFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [examFilter, setExamFilter] = useState("");
  const [platformCategory, setPlatformCategory] = useState<"model" | "school">("model");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | QuestionType>("all");
  const [selectedQuestions, setSelectedQuestions] = useState<QuestionWithSource[]>([]);
  const [basketOpen, setBasketOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, true>>({});
  const [activeTag, setActiveTag] = useState("全部");
  const [source, setSource] = useState(requestedDocumentId ?? "全部");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [bankStats, setBankStats] = useState(stats);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selection, setSelection] = useState<ExplorerSelection>(defaultSelection);
  const [bankFolders, setBankFolders] = useState(folders);
  const [bankSources, setBankSources] = useState(sources);
  const [bankFacets, setBankFacets] = useState(facets);
  const [viewMode, setViewMode] = useState<"list" | "tiles">("list");
  const [notice, setNotice] = useState("");
  const [operationError, setOperationError] = useState("");
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(initialProfile);
  const [profileDraft, setProfileDraft] = useState(initialProfile);
  const [savingProfile, setSavingProfile] = useState(false);
  const [variationTarget, setVariationTarget] = useState<QuestionWithSource | null>(null);
  const [variationDifficulty, setVariationDifficulty] = useState("similar");
  const [variationCount, setVariationCount] = useState(2);
  const [variationFocus, setVariationFocus] = useState("");
  const [variationInstructions, setVariationInstructions] = useState("");
  const [variationQualityMode, setVariationQualityMode] = useState<"quick" | "reviewed">("reviewed");
  const [variationDiagramMode, setVariationDiagramMode] = useState<"auto" | "never">("auto");
  const [variationReviewerProfileId, setVariationReviewerProfileId] = useState("");
  const [variationProfiles, setVariationProfiles] = useState<VariationModelProfile[]>([]);
  const [variationRequestKey, setVariationRequestKey] = useState("");
  const [variationResult, setVariationResult] = useState<VariationResult | null>(null);
  const [selectedVariationIds, setSelectedVariationIds] = useState<string[]>([]);
  const [variationLoading, setVariationLoading] = useState(false);
  const [variationAccepting, setVariationAccepting] = useState(false);
  const [variationDiscarding, setVariationDiscarding] = useState(false);
  const [variationError, setVariationError] = useState("");

  // Clear immediately on scope changes, before stale results can be selected.
  const selectionScope = JSON.stringify([library, query, type, activeTag, source, page, selection, stage, subject, gradeFilter, regionFilter, textbookFilter, originFilter, yearFilter, schoolFilter, examFilter]);
  const [previousScope, setPreviousScope] = useState(selectionScope);
  if (previousScope !== selectionScope) {
    setPreviousScope(selectionScope);
    setSelectedQuestions([]);
    setLoading(true);
    setDeleteError("");
  }
  const selectionBusy = loading || deleting || moving || Boolean(searchError);
  const selected = selectedQuestions;
  const selectedIds = new Set(selected.map((question) => question.id));
  const years = [...new Set(bankSources.map(item => item.year).filter((value): value is number => value !== null))].sort((a, b) => b - a);
  const schools = [...new Set(bankSources.flatMap(item => item.school ? [item.school] : []))];
  const exams = [...new Set(bankSources.flatMap(item => item.examType ? [item.examType] : []))];
  const textbookOptions = useMemo(() => {
    const options = textbookEditions(subject, stage);
    return options.includes(profileDraft.textbook) ? options : [profileDraft.textbook, ...options];
  }, [profileDraft.textbook, stage, subject]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError("");
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "50" });
        if (query.trim()) params.set("q", query.trim());
        if (type !== "all") params.set("type", type);
        if (activeTag !== "全部") params.set("tag", activeTag);
        if (source !== "全部") params.set("documentId", source);
        if (gradeFilter) params.set("grade", gradeFilter);
        if (regionFilter) params.set("region", regionFilter);
        if (textbookFilter) params.set("textbook", textbookFilter);
        if (originFilter) params.set("sourceKind", originFilter);
        if (yearFilter) params.set("year", yearFilter);
        if (schoolFilter) params.set("school", schoolFilter);
        if (examFilter) params.set("examType", examFilter);
        if (selection.kind === "unfiled") params.set("folderId", "unfiled");
        if (selection.kind === "folder" && selection.value) params.set("folderId", selection.value);
        if (selection.kind === "grade" && selection.value) params.set("grade", selection.value);
        if (selection.kind === "region" && selection.value && selection.value !== "未设置地区") params.set("region", selection.value);
        if (selection.kind === "textbook" && selection.value && selection.value !== "未设置教材") params.set("textbook", selection.value);
        if (!(requestedDocumentId && source === requestedDocumentId)) { params.set("subject", subject); params.set("stage", stage); }
        const response = await fetch(`/api/questions?${params}`, { signal: controller.signal });
        const result = await response.json().catch(() => ({})) as { questions?: QuestionWithSource[]; pagination?: Pagination; error?: string };
        if (!response.ok || !result.questions || !result.pagination) throw new Error(result.error ?? "题库查询失败");
        setQuestions(result.questions);
        setPagination(result.pagination);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError(error instanceof Error ? error.message : "题库查询失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTag, page, query, refreshKey, selection, source, stage, subject, type, requestedDocumentId, gradeFilter, regionFilter, textbookFilter, originFilter, yearFilter, schoolFilter, examFilter, library]);

  useEffect(() => {
    if (!variationTarget) return;
    const controller = new AbortController();
    void fetch("/api/model-profiles", { signal: controller.signal })
      .then((response) => response.json())
      .then((result: { profiles?: VariationModelProfile[] }) => {
        if (result.profiles) setVariationProfiles(result.profiles.filter((profile) => profile.enabled));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [variationTarget]);

  function chooseLocation(next: ExplorerSelection) {
    setSelection(next);
    setPage(1);
  }

  function toggle(question: QuestionWithSource) {
    if (selectedIds.has(question.id)) {
      setSelectedQuestions((items) => items.filter((item) => item.id !== question.id));
    } else setSelectedQuestions((items) => [...items, question]);
  }

  function toggleExpanded(questionId: string) {
    setExpandedIds((items) => {
      const next = { ...items };
      if (questionId in next) delete next[questionId];
      else next[questionId] = true;
      return next;
    });
  }

  function togglePage() {
    const allSelected = questions.length > 0 && questions.every((question) => selectedIds.has(question.id));
    setSelectedQuestions((items) => allSelected
      ? items.filter((item) => !questions.some((question) => question.id === item.id))
      : [...items, ...questions.filter((question) => !items.some((item) => item.id === question.id))]);
  }

  function addToBasket(incoming: QuestionWithSource[]) {
    if (basket.add(incoming)) {
      setNotice(`已加入选题篮，可继续筛选选题`);
    }
  }

  useEffect(() => {
    if (!basketOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    basketPanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBasketOpen(false);
      if (event.key !== "Tab") return;
      const controls = Array.from(basketPanel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, select:not(:disabled)') ?? []);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      // The collapsed trigger is remounted when the dialog closes.
      (document.querySelector<HTMLButtonElement>(".bank-explorer-page .question-basket-trigger") ?? (previous?.isConnected ? previous : null))?.focus();
    };
  }, [basketOpen]);

  function clearFilters() {
    setGradeFilter(""); setRegionFilter(""); setTextbookFilter(""); setOriginFilter("");
    setYearFilter(""); setSchoolFilter(""); setExamFilter("");
    setQuery("");
    setType("all");
    setActiveTag("全部");
    setSource("全部");
    setPage(1);
  }

  async function deleteSelectedQuestions() {
    if (library !== "personal" || !selected.length || selectionBusy) return;
    if (!window.confirm(`确定永久删除已选的 ${selected.length} 道题吗？\n\n已被组卷引用的题目会阻止本次删除。删除无法撤销；原试卷仍会保留。`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const ids = selected.map((question) => question.id);
      const response = await fetch("/api/questions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const result = await response.json().catch(() => ({})) as { deleted?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "题目删除失败");
      const deletedIds = new Set(ids);
      const deletedWithAssets = selected.filter((question) => question.assets.length > 0).length;
      setQuestions((items) => items.filter((question) => !deletedIds.has(question.id)));
      setBankStats((value) => ({
        ...value,
        total: Math.max(0, value.total - (result.deleted ?? ids.length)),
        approved: Math.max(0, value.approved - (result.deleted ?? ids.length)),
        withAssets: Math.max(0, value.withAssets - deletedWithAssets),
      }));
      setSelectedQuestions([]);
      basket.remove(ids);
      setBankFolders(items => items.map(folder => ({ ...folder, questionCount: Math.max(0, folder.questionCount - selected.filter(question => question.folderId === folder.id).length) })));
      setNotice(`已永久删除 ${result.deleted ?? ids.length} 道题`);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "题目删除失败");
    } finally {
      setDeleting(false);
    }
  }

  async function createFolder() {
    const name = window.prompt("新文件夹名称");
    if (!name?.trim()) return;
    setOperationError("");
    const parentId = selection.kind === "folder" ? selection.value : null;
    const response = await fetch("/api/question-folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    const result = await response.json().catch(() => ({})) as { folder?: QuestionFolder; error?: string };
    if (!response.ok || !result.folder) { setOperationError(result.error ?? "创建文件夹失败"); return; }
    setBankFolders((items) => [...items, result.folder!]);
    chooseLocation({ kind: "folder", value: result.folder.id });
    setNotice(`已创建“${result.folder.name}”`);
  }

  async function renameFolder(folder: QuestionFolder) {
    const name = window.prompt("重命名文件夹", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    const response = await fetch(`/api/question-folders/${encodeURIComponent(folder.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json().catch(() => ({})) as { folder?: Partial<QuestionFolder>; error?: string };
    if (!response.ok) { setOperationError(result.error ?? "重命名失败"); return; }
    setBankFolders((items) => items.map((item) => item.id === folder.id ? { ...item, name: String(result.folder?.name ?? name.trim()) } : item));
  }

  async function deleteFolder(folder: QuestionFolder) {
    if (!window.confirm(`删除空文件夹“${folder.name}”？`)) return;
    const response = await fetch(`/api/question-folders/${encodeURIComponent(folder.id)}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setOperationError(result.error ?? "删除文件夹失败"); return; }
    setBankFolders((items) => items.filter((item) => item.id !== folder.id));
    if (selection.kind === "folder" && selection.value === folder.id) chooseLocation(defaultSelection);
  }

  async function moveQuestions(folderId: string | null) {
    if (library !== "personal" || !selected.length || selectionBusy) return;
    setMoving(true); setOperationError("");
    try {
      const response = await fetch("/api/questions/folder", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selected.map((question) => question.id), folderId }),
      });
      const result = await response.json().catch(() => ({})) as { moved?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "移动题目失败");
      setBankFolders(items => items.map(folder => ({ ...folder, questionCount: Math.max(0, folder.questionCount - selected.filter(question => question.folderId === folder.id).length + (folderId === folder.id ? selected.length : 0)) })));
      setSelectedQuestions([]);
      setNotice(`已移动 ${result.moved ?? selected.length} 道题`);
      setLoading(true); setRefreshKey((value) => value + 1);
    } catch (error) { setOperationError(error instanceof Error ? error.message : "移动题目失败"); }
    finally { setMoving(false); }
  }

  async function importPackage(file: File) {
    setImporting(true);
    setOperationError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/imports/questions", { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as { imported?: number; rootFolderName?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "共享包导入失败");
      setNotice(`已导入 ${result.imported ?? 0} 道题，保存在“${result.rootFolderName ?? "导入题库"}”`);
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "共享包导入失败");
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  async function saveProfile() {
    setSavingProfile(true);
    setOperationError("");
    try {
      const response = await fetch("/api/teacher-profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profileDraft),
      });
      const result = await response.json().catch(() => ({})) as { profile?: TeacherProfile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error ?? "保存教学画像失败");
      setProfile(result.profile);
      setProfileDraft(result.profile);
      setProfileOpen(false);
      setNotice("教学画像已保存，后续识题会自动使用对应地区与教材标签");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "保存教学画像失败");
    } finally {
      setSavingProfile(false);
    }
  }

  function resetVariationDialog() {
    setVariationTarget(null);
    setVariationFocus("");
    setVariationInstructions("");
    setVariationResult(null);
    setSelectedVariationIds([]);
    setVariationReviewerProfileId("");
    setVariationRequestKey("");
    setVariationError("");
  }

  function openVariation(question: QuestionWithSource) {
    setVariationTarget(question);
    setVariationResult(null);
    setSelectedVariationIds([]);
    setVariationError("");
    setVariationDiagramMode("auto");
    setVariationRequestKey(crypto.randomUUID());
  }

  async function generateVariations() {
    if (!variationTarget || variationLoading) return;
    setVariationLoading(true);
    setVariationError("");
    let responseReceived = false;
    let renewRequestKeyOnFailure = true;
    try {
      const requestKey = variationRequestKey || crypto.randomUUID();
      if (!variationRequestKey) setVariationRequestKey(requestKey);
      const response = await fetch(`/api/questions/${encodeURIComponent(variationTarget.id)}/variations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          count: variationCount,
          difficulty: variationDifficulty,
          focus: variationFocus,
          instructions: variationInstructions,
          qualityMode: variationQualityMode,
          diagramMode: variationDiagramMode,
          reviewerProfileId: variationQualityMode === "reviewed" ? variationReviewerProfileId || undefined : undefined,
          idempotencyKey: requestKey,
        }),
      });
      responseReceived = true;
      const result = await response.json().catch(() => ({})) as VariationResult & { error?: string };
      if (response.status === 409 && ["generating", "validating", "reviewing"].includes(result.status)) {
        renewRequestKeyOnFailure = false;
      }
      if (!response.ok || !result.candidates) throw new Error(result.error ?? "变式题生成失败");
      setVariationResult(result);
      setSelectedVariationIds(result.candidates.map((candidate) => candidate.id));
    } catch (error) {
      setVariationError(error instanceof Error ? error.message : "变式题生成失败");
      if (responseReceived && renewRequestKeyOnFailure) setVariationRequestKey(crypto.randomUUID());
    } finally {
      setVariationLoading(false);
    }
  }

  async function acceptVariations() {
    if (!variationTarget || !variationResult || !selectedVariationIds.length || variationAccepting) return;
    const target = variationTarget;
    setVariationAccepting(true);
    setVariationError("");
    try {
      const response = await fetch(`/api/variation-runs/${encodeURIComponent(variationResult.runId)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateIds: selectedVariationIds }),
      });
      const result = await response.json().catch(() => ({})) as { accepted?: number; questions?: QuestionWithSource[]; error?: string };
      if (!response.ok || !result.questions) throw new Error(result.error ?? "候选题入库失败");
      const accepted = result.accepted ?? result.questions.length;
      const acceptedSource = result.questions[0]?.source;
      if (acceptedSource) setBankSources((items) => items.some((item) => item.id === acceptedSource.documentId) ? items : [{
        id: acceptedSource.documentId,
        name: acceptedSource.documentName,
        year: acceptedSource.year ?? null,
        examType: acceptedSource.examType ?? null,
        region: acceptedSource.region ?? null,
        textbook: acceptedSource.textbook ?? null,
        school: acceptedSource.school ?? null,
      }, ...items]);
      if (target.folderId) setBankFolders((items) => items.map((folder) => folder.id === target.folderId
        ? { ...folder, questionCount: folder.questionCount + accepted }
        : folder));
      const incrementFacet = (items: BankFacet[], value: string) => items.some((item) => item.value === value)
        ? items.map((item) => item.value === value ? { ...item, count: item.count + accepted } : item)
        : [...items, { value, count: accepted }];
      setBankFacets((current) => ({
        grades: incrementFacet(current.grades, target.source.grade || "未设置年级"),
        regions: incrementFacet(current.regions, target.source.region || "未设置地区"),
        textbooks: incrementFacet(current.textbooks, target.source.textbook || "未设置教材"),
      }));
      resetVariationDialog();
      setNotice(`已采用 ${accepted} 道变式题并加入原题文件夹${variationResult.qualityMode === "reviewed" ? "，审校记录已随题保存" : ""}`);
      setRefreshKey((value) => value + 1);
      setBankStats((value) => ({ ...value, total: value.total + accepted, approved: value.approved + accepted }));
    } catch (error) {
      setVariationError(error instanceof Error ? error.message : "候选题入库失败");
    } finally {
      setVariationAccepting(false);
    }
  }

  async function discardVariations() {
    if (!variationResult) { resetVariationDialog(); return; }
    if (variationDiscarding) return;
    setVariationDiscarding(true);
    setVariationError("");
    try {
      const response = await fetch(`/api/variation-runs/${encodeURIComponent(variationResult.runId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "放弃候选题失败");
      resetVariationDialog();
      setNotice("本批候选题已放弃，正式题库没有发生变化");
    } catch (error) {
      setVariationError(error instanceof Error ? error.message : "放弃候选题失败");
    } finally {
      setVariationDiscarding(false);
    }
  }

  function toggleVariationCandidate(candidateId: string) {
    setSelectedVariationIds((ids) => ids.includes(candidateId)
      ? ids.filter((id) => id !== candidateId)
      : [...ids, candidateId]);
  }

  function folderTrail(folderId: string | undefined) {
    const result: QuestionFolder[] = [];
    const visited = new Set<string>();
    let current = folderId ? bankFolders.find((folder) => folder.id === folderId) : undefined;
    while (current && !visited.has(current.id) && result.length < 8) {
      visited.add(current.id);
      result.unshift(current);
      current = current.parentId ? bankFolders.find((folder) => folder.id === current!.parentId) : undefined;
    }
    return result;
  }

  function renderFolders(parentId: string | null, depth = 0): React.ReactNode {
    return bankFolders.filter((folder) => folder.parentId === parentId).map((folder) => {
      const active = selection.kind === "folder" && selection.value === folder.id;
      return <div key={folder.id} className="bank-folder-node">
        <div className={`bank-folder-row${active ? " active" : ""}`} style={{ paddingLeft: `${8 + depth * 14}px` }}>
          <button type="button" onClick={() => chooseLocation({ kind: "folder", value: folder.id })}>
            {active ? <FolderOpen size={15} /> : <Folder size={15} />}
            <span title={folder.name}>{folder.name}</span><small>{folder.questionCount}</small>
          </button>
          <span className="bank-folder-actions"><button type="button" title="重命名" onClick={() => void renameFolder(folder)}><Pencil size={11} /></button><button type="button" title="删除空文件夹" onClick={() => void deleteFolder(folder)}><Trash2 size={11} /></button></span>
        </div>
        {renderFolders(folder.id, depth + 1)}
      </div>;
    });
  }

  const orderedSelectedIds = selected.map((question) => question.id);
  const basketHref = "/papers/new?ids=" + encodeURIComponent(basket.items.map(question => question.id).join(","));
  const basketExportIds = "?ids=" + encodeURIComponent(basket.items.map(question => question.id).join(",")) + "&";
  const exportIds = selected.length ? "?ids=" + encodeURIComponent(orderedSelectedIds.join(",")) + "&" : "?";
  const allPageSelected = questions.length > 0 && questions.every((question) => selectedIds.has(question.id));
  const activeFilterCount = Number(Boolean(query.trim())) + Number(type !== "all") + Number(activeTag !== "全部") + Number(source !== "全部") + Number(!!gradeFilter) + Number(!!regionFilter) + Number(!!textbookFilter) + Number(!!originFilter) + Number(!!yearFilter) + Number(!!schoolFilter) + Number(!!examFilter);
  const smartLabel = selection.kind === "grade" ? ["按年级", selection.value]
    : selection.kind === "region" ? ["按地区", selection.value]
      : selection.kind === "textbook" ? ["按教材", selection.value]
        : selection.kind === "unfiled" ? ["未分类"] : [];
  const trail = selection.kind === "folder" ? folderTrail(selection.value) : [];

  return (
    <div className="page-shell bank-page bank-explorer-page">
      <header className="bank-page-header">
        <div className="bank-title-row"><h1>题库</h1><p className="resource-intro">按知识点找题，边浏览边加入选题篮。</p></div>
        <div className="bank-header-actions"><Link className="btn btn-primary" href="/?import=1">导入试卷题目</Link>
          <input ref={importInput} type="file" accept=".jianti" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPackage(file); }} />
          <button type="button" className="btn" disabled={importing} onClick={() => importInput.current?.click()}>{importing ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />} 导入共享包</button>
          <details className="export-menu"><summary className="btn"><Download size={15} /> 导出 <ChevronDown size={13} /></summary><div>
            <a href={`/api/exports/questions${exportIds}format=package`}><PackageOpen size={13} /> 拣题共享包</a>
            <a href={`/api/exports/questions${exportIds}format=markdown`}>Markdown</a>
            <a href={`/api/exports/questions${exportIds}format=json`}>JSON</a>
            <small>{selected.length ? `仅导出已选 ${selected.length} 道题` : "导出当前教学范围内的全部题目"}</small>
          </div></details>
        </div>
      </header>

      <div className="resource-tabs" role="tablist" aria-label="题库范围"><button role="tab" aria-selected={library === "platform"} onClick={() => setLibrary("platform")}>基础题库</button><button role="tab" aria-selected={library === "personal"} onClick={() => setLibrary("personal")}>我的题库</button>{library === "personal" && <button className="resource-folder-toggle" aria-expanded={foldersOpen} onClick={() => setFoldersOpen(!foldersOpen)}><Folder size={15} /> 文件夹管理</button>}</div>
      {library === "platform" && <section className="resource-unavailable">
        <div className="bank-platform-categories" role="tablist" aria-label="平台资源分类"><button role="tab" aria-selected={platformCategory === "model"} onClick={() => setPlatformCategory("model")}>模卷</button><button role="tab" aria-selected={platformCategory === "school"} onClick={() => setPlatformCategory("school")}>名校试卷</button></div>
        <h2>平台精选资源尚未开放</h2><p>{platformCategory === "model" ? "模卷将按教学与考试场景组织。" : "名校试卷将按学校与试卷来源组织。"}目前还没有可供浏览的已发布资源。</p><p>个人上传、共享包和 AI 变式保存在「我的题库」，已有选题篮会继续保留。</p><button className="btn" onClick={() => setLibrary("personal")}>浏览我的题库</button>
      </section>}
      {library === "personal" && <>
      {(notice || operationError) && <div className={`bank-notice ${operationError ? "error" : "success"}`}><span>{operationError || notice}</span><button type="button" onClick={() => { setNotice(""); setOperationError(""); }}><X size={13} /></button></div>}

      <div className="bank-explorer card with-knowledge">
        <div className="bank-browse-pane">
          <KnowledgeFilter tags={availableTags} value={activeTag} onChange={tag => { setActiveTag(tag); setPage(1); }} />
        {foldersOpen && <aside className="bank-folder-pane" aria-label="题库文件夹">
          <div className="folder-pane-heading"><strong>个人文件夹</strong><button type="button" title="新建文件夹" onClick={() => void createFolder()}><FolderPlus size={15} /></button></div>
          <nav className="bank-quick-links">
            <button type="button" className={selection.kind === "all" ? "active" : ""} onClick={() => chooseLocation(defaultSelection)}><House size={15} /><span>全部题目</span><small>{bankStats.approved}</small></button>
            <button type="button" className={selection.kind === "unfiled" ? "active" : ""} onClick={() => chooseLocation({ kind: "unfiled" })}><Folder size={15} /><span>未分文件夹</span></button>
          </nav>
          <div className="folder-pane-scroll">
            <section className="folder-section"><div><span>我的文件夹</span><button type="button" onClick={() => void createFolder()}><FolderPlus size={12} /> 新建</button></div>{bankFolders.length ? renderFolders(null) : <p>新建文件夹，把常用题目按备课习惯归档。</p>}</section>
          </div>
          <section className={`teacher-profile-card${profileOpen ? " editing" : ""}`}>
            <button type="button" className="teacher-profile-summary" onClick={() => setProfileOpen((value) => !value)}><span><Sparkles size={14} /></span><div><strong>我的教学画像</strong><small>{profile.region} · {profile.textbook}{profile.grades.length ? ` · ${profile.grades.join("、")}` : ""}</small></div><ChevronDown size={13} /></button>
            {profileOpen && <div className="teacher-profile-form">
              <label><span>地区</span><select value={profileDraft.region} onChange={(event) => setProfileDraft((value) => ({ ...value, region: event.target.value }))}>{chinaRegions.map((region) => <option key={region}>{region}</option>)}</select></label>
              <label><span>教材版本</span><select value={profileDraft.textbook} onChange={(event) => setProfileDraft((value) => ({ ...value, textbook: event.target.value }))}>{textbookOptions.map((edition) => <option key={edition}>{edition}</option>)}</select></label>
              <div className="profile-grade-picker"><span>当前任教年级</span><div>{gradesByStage[stage].map((grade) => { const checked = profileDraft.grades.includes(grade); return <button type="button" key={grade} className={checked ? "active" : ""} onClick={() => setProfileDraft((value) => ({ ...value, grades: checked ? value.grades.filter((item) => item !== grade) : [...value.grades, grade] }))}>{checked && <Check size={10} />}{grade}</button>; })}</div></div>
              <button type="button" className="btn btn-primary profile-save" disabled={savingProfile} onClick={() => void saveProfile()}><Save size={12} /> {savingProfile ? "保存中…" : "保存画像"}</button>
            </div>}
          </section>
        </aside>}

        </div>
        <main className="bank-explorer-main">
          {selection.kind !== "all" && <nav className="explorer-addressbar" aria-label="当前位置"><button type="button" onClick={() => chooseLocation(defaultSelection)}><House size={13} /> 题库</button>{trail.map((folder) => <span key={folder.id}><ChevronRight size={12} /><button type="button" onClick={() => chooseLocation({ kind: "folder", value: folder.id })}>{folder.name}</button></span>)}{smartLabel.map((label) => <span key={label}><ChevronRight size={12} /><b>{label}</b></span>)}</nav>}

          <section className="bank-toolbar explorer-toolbar" aria-label="筛选题目">
            <div className="bank-search-row">
              <label className="search-box"><Search size={17} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="搜索题干、答案、知识点或来源" />{query && <button type="button" onClick={() => { setQuery(""); setPage(1); }} aria-label="清空搜索"><X size={14} /></button>}</label>
              <div className="bank-scope-controls"><select aria-label="学段" value={stage} onChange={event => { setStage(event.target.value as EducationStage); clearFilters(); }}>{educationStages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select aria-label="学科" value={subject} onChange={event => { setSubject(event.target.value as EducationSubject); clearFilters(); }}>{subjects.map(item => <option key={item}>{item}</option>)}</select></div>
              <button className="clear-filter" disabled={!activeFilterCount} type="button" onClick={clearFilters}>重置筛选{activeFilterCount ? ` (${activeFilterCount})` : ""}</button>
            </div>
            <div className="bank-filter-row"><span>题型</span><div className="bank-type-options" role="group" aria-label="筛选题型">{[["all", "全部"], ...Object.entries(typeLabels)].map(([value, label]) => <button type="button" key={value} aria-pressed={type === value} onClick={() => { setType(value as "all" | QuestionType); setPage(1); }}>{label}</button>)}</div></div>
            <div className="bank-filter-row bank-source-row"><span>范围</span>
              <label><span className="sr-only">年级</span><select aria-label="筛选年级" value={gradeFilter} onChange={event => { setGradeFilter(event.target.value); setPage(1); }}><option value="">全部年级</option>{bankFacets.grades.filter(f => f.value !== "未设置年级").map(f => <option key={f.value}>{f.value}</option>)}</select></label>
              <label className="bank-source-picker"><span className="sr-only">来源试卷</span><select aria-label="来源试卷" value={source} onChange={event => { setSource(event.target.value); setPage(1); }}><option value="全部">全部来源试卷</option>{bankSources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <details className="bank-more-filters"><summary><SlidersHorizontal size={14} />更多筛选{originFilter || regionFilter || textbookFilter || yearFilter || schoolFilter || examFilter ? " · 已应用" : ""}</summary><div>
                <label>题目来源<select aria-label="题目来源类型" value={originFilter} onChange={event => { setOriginFilter(event.target.value); setPage(1); }}><option value="">全部个人资源</option><option value="uploaded">上传原卷识别</option><option value="imported">共享包导入副本</option><option value="generated">AI 变式</option></select></label>
                {bankFacets.regions.some(f => f.value !== "未设置地区") && <label>地区<select aria-label="筛选地区" value={regionFilter} onChange={event => { setRegionFilter(event.target.value); setPage(1); }}><option value="">全部地区</option>{bankFacets.regions.filter(f => f.value !== "未设置地区").map(f => <option key={f.value}>{f.value}</option>)}</select></label>}
                {!!years.length && <label>年份<select aria-label="筛选年份" value={yearFilter} onChange={event => { setYearFilter(event.target.value); setPage(1); }}><option value="">全部年份</option>{years.map(year => <option key={year}>{year}</option>)}</select></label>}
                {!!schools.length && <label>学校<select aria-label="筛选学校" value={schoolFilter} onChange={event => { setSchoolFilter(event.target.value); setPage(1); }}><option value="">全部学校</option>{schools.map(school => <option key={school}>{school}</option>)}</select></label>}
                {!!exams.length && <label>考试类型<select aria-label="筛选考试类型" value={examFilter} onChange={event => { setExamFilter(event.target.value); setPage(1); }}><option value="">全部考试类型</option>{exams.map(exam => <option key={exam}>{exam}</option>)}</select></label>}
                {bankFacets.textbooks.some(f => f.value !== "未设置教材") && <label>教材<select aria-label="筛选教材" value={textbookFilter} onChange={event => { setTextbookFilter(event.target.value); setPage(1); }}><option value="">全部教材</option>{bankFacets.textbooks.filter(f => f.value !== "未设置教材").map(f => <option key={f.value}>{f.value}</option>)}</select></label>}
              </div></details>
            </div>
            {activeFilterCount > 0 && <div className="bank-applied-filters" aria-label="已应用筛选"><span>当前条件</span>{[
              { label: query.trim(), clear: () => setQuery("") }, { label: type !== "all" ? typeLabels[type] : "", clear: () => setType("all") },
              { label: activeTag !== "全部" ? activeTag : "", clear: () => setActiveTag("全部") }, { label: source !== "全部" ? bankSources.find(s => s.id === source)?.name ?? "指定来源试卷" : "", clear: () => setSource("全部") },
              { label: gradeFilter, clear: () => setGradeFilter("") }, { label: regionFilter, clear: () => setRegionFilter("") }, { label: textbookFilter, clear: () => setTextbookFilter("") },
              { label: yearFilter, clear: () => setYearFilter("") }, { label: schoolFilter, clear: () => setSchoolFilter("") }, { label: examFilter, clear: () => setExamFilter("") },
              { label: originFilter === "uploaded" ? "上传原卷识别" : originFilter === "imported" ? "共享包导入副本" : originFilter === "generated" ? "AI 变式" : "", clear: () => setOriginFilter("") },
            ].filter(item => item.label).map((item, index) => <button type="button" key={index} title={item.label} aria-label={`移除筛选 ${item.label}`} onClick={() => { item.clear(); setPage(1); }}>{item.label}<X size={12} /></button>)}</div>}
          </section>

          <div className="bank-content explorer-content">
            {selected.length > 0 && <div className="resource-bulkbar" role="region" aria-label="题目批量操作" aria-busy={deleting || moving}>
              <strong>已选 {selected.length} 道题</strong>
              <button className="btn btn-primary" disabled={selectionBusy || !basket.ready} onClick={() => { if (basket.add(selected)) { setNotice(`已将 ${selected.length} 道题加入选题篮`); setSelectedQuestions([]); } }}><ShoppingBasket size={15} />批量加入选题篮</button>
              <a className="btn" href={`/api/exports/questions${exportIds}format=package`}><Download size={14} />导出所选</a>
              <label>移动到<select aria-label="批量移动题目" disabled={selectionBusy} value="" onChange={event => { if (event.target.value) void moveQuestions(event.target.value === "unfiled" ? null : event.target.value); }}><option value="" disabled>选择文件夹</option><option value="unfiled">未分文件夹</option>{bankFolders.map(folder => <option key={folder.id} value={folder.id}>{folderTrail(folder.id).map(item => item.name).join(" / ")}</option>)}</select></label>
              <button className="btn resource-danger" disabled={selectionBusy} onClick={() => void deleteSelectedQuestions()}><Trash2 size={14} />{deleting ? "删除中…" : "删除所选题目"}</button>
              <button className="btn" disabled={deleting || moving} onClick={() => setSelectedQuestions([])}>取消选择</button>
              {moving && <span role="status">移动中…</span>}
            </div>}

            <div className="bank-list-head"><div><label className="resource-select-all"><SelectionCheckbox label="全选当前页题目" checked={allPageSelected} indeterminate={selected.length > 0 && !allPageSelected} disabled={!questions.length || selectionBusy} onChange={togglePage} />全选当前页</label><span>{loading ? <><LoaderCircle size={12} className="spin" /> 查询中…</> : `${pagination.total} 道题`}</span>{!loading && pagination.pageCount > 1 && <small>第 {pagination.page} / {pagination.pageCount} 页</small>}</div><div className="bank-list-tools"><span>批量选择仅当前页 · 选题篮跨页保留</span><select aria-label="题库视图" value={viewMode} onChange={event => setViewMode(event.target.value as "list" | "tiles")}><option value="list">列表阅读</option><option value="tiles">平铺浏览</option></select></div></div>
            {(searchError || deleteError) && <p className="form-error">{searchError || deleteError}</p>}
            <div className={`question-cards ${viewMode} ${loading ? "loading" : ""}`} aria-busy={loading} inert={selectionBusy}>
              {questions.map((question) => {
                const checked = selectedIds.has(question.id);
                const inBasket = basketIds.has(question.id);
                const expanded = question.id in expandedIds;
                const sourceLabel = [question.source.year, question.source.region, question.source.textbook, question.source.school, question.source.examType].filter(Boolean).join(" · ") || question.source.documentName;
                return <article key={question.id} className={`question-card ${checked ? "selected " : ""}${expanded ? "expanded" : ""}`}>
                  <SelectionCheckbox label={`选择第 ${question.number} 题 · ${question.source.documentName}`} checked={checked} disabled={selectionBusy} onChange={() => toggle(question)} />
                  <div className="question-card-main"><div className="question-meta"><span className="pill gray">{typeLabels[question.type]}</span><span>{question.source.grade} · {question.source.subject}</span><span className="source-question-number">· 原题号 {question.number}</span>{isVariationQuestion(question) && <span className="variation-badge"><WandSparkles size={11} /> AI 变式</span>}{question.variationReview?.mode === "multi_agent" && <span className={`variation-review-badge ${question.variationReview.status}`}><Check size={10} /> {question.variationReview.status === "revised" ? "审校后修订" : "双 Agent 审校"}</span>}{question.variationReview?.mode === "rules" && <span className="variation-review-badge rules"><Check size={10} /> 规则校验</span>}{question.source.origin === "imported" && <span className="shared-badge"><PackageOpen size={11} /> 共享包</span>}{question.assets.length > 0 && <span className="has-image"><ImageIcon size={12} /> 含图</span>}{question.tags.slice(0, 3).map((tag) => <button type="button" className="question-tag" key={tag} onClick={() => { setActiveTag(tag); setPage(1); }}>{tag}</button>)}{question.tags.length > 3 && <span className="question-tag">+{question.tags.length - 3}</span>}</div>
                    <button type="button" className="question-stem" onClick={() => toggleExpanded(question.id)} aria-expanded={expanded}><span className="question-stem-text"><MathText text={stripLeadingQuestionNumber(question.stem, question.number)} /></span></button>
                    <div className="question-details">{question.assets.some((asset) => asset.role === "question" && asset.url) && <div className="bank-question-assets">{question.assets.filter((asset) => asset.role === "question" && asset.url).map((asset) => <figure key={asset.id}><Image src={asset.url!} width={asset.width ?? 720} height={asset.height ?? 480} alt={asset.label || "题图"} unoptimized /><figcaption>{asset.label || "题图"}</figcaption></figure>)}</div>}{question.options?.length ? <div className="bank-options">{question.options.map((option) => <span key={option.key}><b>{option.key}</b><MathText text={option.content} /></span>)}</div> : null}{expanded && (question.answer || question.analysis || question.assets.some(a => a.role === "answer")) && <div className="answer-preview">{question.answer && <div><b>答案</b><MathText text={question.answer} /></div>}{(question.analysis || question.assets.some(a => a.role === "answer")) && <div><b>解析</b><AnalysisWithImages text={question.analysis} assets={question.assets} /></div>}</div>}{expanded && question.variationKind && <p className="variation-note"><WandSparkles size={12} /> 变式说明：{question.variationKind.split(":").slice(1).join(":") || "基于原题生成"}</p>}{expanded && question.variationReview && <div className="variation-review-detail"><strong>{question.variationReview.mode === "multi_agent" ? `独立审校${question.variationReview.score !== null ? ` · ${question.variationReview.score} 分` : ""}` : "已通过结构与安全规则校验"}</strong>{question.variationReview.reviewer && <span>审校：{question.variationReview.reviewer}</span>}{question.variationReview.issues.length > 0 && <span>修订记录：{question.variationReview.issues.join("；")}</span>}</div>}</div>
                  </div>
                  <div className="question-source-line" title={`${question.source.documentName} · ${sourceLabel}`}><span>来源</span><button type="button" onClick={() => { setSource(question.source.documentId); setPage(1); }}>{question.source.documentName}</button>{question.source.year && <small>{question.source.year}</small>}{question.source.region && <small>{question.source.region}</small>}</div>
                  <div className="question-actions">
                    <button type="button" className="row-action expand-action" onClick={() => toggleExpanded(question.id)} aria-expanded={expanded}>{expanded ? "收起答案解析" : "查看答案解析"}<ChevronDown size={13} /></button>
                    {question.source.origin === "original" && !question.source.sourceRemoved && <Link className="row-action" href={`/review/${question.source.documentId}?question=${encodeURIComponent(question.id)}`}><Pencil size={13} /> 编辑</Link>}
                    {!isVariationQuestion(question) && !question.needsHumanReview ? <button type="button" className="row-action" onClick={() => openVariation(question)}><WandSparkles size={13} /> 生成变式</button> : question.needsHumanReview ? <span className="source-removed">复核后可生成</span> : null}
                    <button type="button" className={`btn question-add-to-basket${inBasket ? " in-basket" : " btn-primary"}`} disabled={!basket.ready} aria-pressed={inBasket} onClick={() => inBasket ? basket.replace(basket.items.filter(item => item.id !== question.id)) : addToBasket([question])}>{inBasket ? <Check size={15} /> : <Plus size={15} />}{inBasket ? "移出选题篮" : "加入选题篮"}</button>
                  </div>
                </article>;
              })}
            </div>
            {!questions.length && !loading && !searchError && <div className="empty-state explorer-empty"><FolderOpen size={42} /><h2>{activeFilterCount ? "没有匹配的题目" : selection.kind === "folder" || selection.kind === "unfiled" ? "当前文件夹没有题目" : bankStats.approved ? "当前学科、学段没有已入库题目" : "我的题库还没有已入库题目"}</h2><p>{activeFilterCount ? "清除部分条件后重新查找；来源试卷中尚未审核的题目不会出现在题库。" : "上传试卷并完成审核后，题目会出现在这里。也可以导入共享包积累个人题目。"}</p>{activeFilterCount > 0 && <button className="btn btn-primary" type="button" onClick={clearFilters}>清除筛选</button>}</div>}
            {pagination.pageCount > 1 && <nav className="bank-pagination" aria-label="题库分页"><button type="button" disabled={pagination.page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={14} /> 上一页</button><span>第 {pagination.page} / {pagination.pageCount} 页</span><button type="button" disabled={pagination.page >= pagination.pageCount || loading} onClick={() => setPage((value) => Math.min(pagination.pageCount, value + 1))}>下一页 <ChevronRight size={14} /></button></nav>}
          </div>
        </main>
      </div>

      </>}
      {(basket.error || basket.message) && <p className="bank-basket-message" role={basket.error ? "alert" : "status"}>{basket.error || basket.message}</p>}
      {basketOpen && <button type="button" className="question-basket-backdrop" aria-label="收起选题篮" onClick={() => setBasketOpen(false)} />}
      {basketOpen ? <aside ref={basketPanel} className="question-basket persistent-basket" role="dialog" aria-modal="true" aria-labelledby="basket-title">
        <header><div><span><ShoppingBasket size={18} /></span><div><strong id="basket-title">选题篮 · {basket.items.length} 道题</strong><small>{stageLabel(stage)}{subject} · 本机保存，跨页保留</small></div></div><button type="button" aria-label="收起选题篮" onClick={() => setBasketOpen(false)}><X size={16} /></button></header>
        <p className="basket-save-explainer">选题篮用于积累题目。进入编辑器后点击“保存试卷”，才会保存为组卷作品。</p>
        {basket.error && <p className="form-error" role="alert">{basket.error}</p>}
        {!basket.ready && !basket.error && <p className="basket-empty" role="status">正在校验选题篮…</p>}
        {basket.ready && !basket.items.length && <p className="basket-empty">还没有选题。点击题目右下方“加入选题篮”，或勾选后批量加入。</p>}
        <ol>{basket.items.map((question, index) => <li key={question.id}><b>{index + 1}</b><div><span>{typeLabels[question.type]} · {question.source.grade}</span><p><MathText text={question.stem} /></p><small>{question.source.documentName}</small></div><div className="basket-item-actions"><button type="button" aria-label={`上移第 ${index + 1} 题`} disabled={!basket.ready || index === 0} onClick={() => basket.replace(moveOrderedItem(basket.items, index, -1))}><ArrowUp size={13} /></button><button type="button" aria-label={`下移第 ${index + 1} 题`} disabled={!basket.ready || index === basket.items.length - 1} onClick={() => basket.replace(moveOrderedItem(basket.items, index, 1))}><ArrowDown size={13} /></button><button type="button" aria-label={`移出选题篮第 ${index + 1} 题`} disabled={!basket.ready} onClick={() => basket.replace(basket.items.filter(item => item.id !== question.id))}><X size={13} /></button></div></li>)}</ol>
        <footer><button type="button" className="btn" disabled={!basket.items.length && !basket.error} onClick={() => { if (window.confirm("清空本机选题篮？不会删除题库中的题目或已保存的试卷。")) basket.replace([]); }}>清空选题篮</button><div>{basket.ready && basket.items.length > 0 && <><a href={`/api/exports/questions${basketExportIds}format=package`}><PackageOpen size={13} />导出选题</a><Link href={basketHref} className="btn btn-primary"><FilePlus2 size={15} />进入组卷</Link></>}</div></footer>
      </aside> : <button type="button" className="question-basket-trigger" aria-label={`打开选题篮，${basket.items.length} 道题`} aria-expanded="false" onClick={() => setBasketOpen(true)}><span><ShoppingBasket size={20} /><b>{basket.items.length}</b></span><i><strong>选题篮</strong><small>{basket.ready ? "本机保存 · 跨页保留" : basket.error ? "需要检查" : "正在恢复…"}</small></i><ChevronRight size={16} /></button>}


      {variationTarget && <div className="variation-dialog-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !variationLoading && !variationAccepting && !variationDiscarding) {
          if (variationResult) void discardVariations(); else resetVariationDialog();
        }
      }}>
        <section className={`variation-dialog${variationResult ? " reviewing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="variation-title">
          <header>
            <span><WandSparkles size={18} /></span>
            <div><h2 id="variation-title">{variationResult ? "核对变式题候选" : "生成变式题"}</h2><p>{variationResult ? "候选题尚未进入正式题库，请核对后选择采用" : "生成、校验、审校，再由老师决定是否入库"}</p></div>
            <button type="button" disabled={variationLoading || variationAccepting || variationDiscarding} onClick={() => { if (variationResult) void discardVariations(); else resetVariationDialog(); }} aria-label="关闭"><X size={16} /></button>
          </header>
          <div className="variation-source"><small>原题</small><p><MathText text={stripLeadingQuestionNumber(variationTarget.stem, variationTarget.number)} /></p></div>

          {!variationResult && !variationLoading && <div className="variation-form">
            <fieldset className="variation-quality wide">
              <legend>质量模式</legend>
              <button type="button" className={variationQualityMode === "reviewed" ? "active" : ""} onClick={() => setVariationQualityMode("reviewed")}><span><b>独立审校</b><em>推荐</em></span><small>生成 Agent 命题，另一个审校修订后再次复核最终版本</small></button>
              <button type="button" className={variationQualityMode === "quick" ? "active" : ""} onClick={() => setVariationQualityMode("quick")}><span><b>快速生成</b></span><small>生成后只做结构、重复与格式规则校验</small></button>
            </fieldset>
            <label><span>难度</span><select value={variationDifficulty} onChange={(event) => setVariationDifficulty(event.target.value)}><option value="easier">更简单</option><option value="similar">难度相近</option><option value="harder">更有挑战</option><option value="mixed">由易到难</option></select></label>
            <label><span>数量</span><select value={variationCount} onChange={(event) => setVariationCount(Number(event.target.value))}><option value={1}>1 道</option><option value={2}>2 道</option><option value={3}>3 道</option></select></label>
            <label className="wide"><span>题图工具</span><select value={variationDiagramMode} onChange={(event) => setVariationDiagramMode(event.target.value as "auto" | "never")}><option value="auto">按需生成题图（推荐）</option><option value="never">无需题图，改写为纯文字题</option></select><small className="field-help">模型只能调用受控几何图元，软件会安全渲染并随题入库。</small></label>
            {variationQualityMode === "reviewed" && variationProfiles.length > 0 && <label className="wide"><span>审校模型（可选）</span><select value={variationReviewerProfileId} onChange={(event) => setVariationReviewerProfileId(event.target.value)}><option value="">与生成模型相同，但使用独立上下文</option>{variationProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label>}
            <label className="wide"><span>希望重点改变什么（可选）</span><input maxLength={120} value={variationFocus} onChange={(event) => setVariationFocus(event.target.value)} placeholder="例如：改为实际生活情境，考查逆向思维" /></label>
            <label className="wide"><span>补充要求（可选）</span><textarea maxLength={500} value={variationInstructions} onChange={(event) => setVariationInstructions(event.target.value)} placeholder="例如：数值保持为整数，解析写出关键步骤" /></label>
          </div>}

          {variationLoading && <div className="variation-workflow-loading" aria-live="polite">
            <LoaderCircle size={28} className="spin" />
            <strong>{variationQualityMode === "reviewed" ? "正在生成并独立审校…" : "正在生成并校验…"}</strong>
            <ol><li className="active"><span>1</span>制定教学目标与候选计划</li><li className="active"><span>2</span>生成候选并检查结构与选项</li><li className={variationQualityMode === "reviewed" ? "active" : "skipped"}><span>3</span>{variationQualityMode === "reviewed" ? "审校修订后再次复核最终版本" : "已选择快速模式"}</li></ol>
            <p>页面会保留本次请求标识；即使网络短暂中断，重试也不会重复生成。</p>
          </div>}

          {variationResult && <div className="variation-candidate-area">
            <div className="variation-workflow-summary"><span><Check size={13} /> {variationResult.qualityMode === "reviewed" ? "独立审校完成" : "规则校验完成"}</span><small>{variationResult.workflow.generator && `命题：${variationResult.workflow.generator}`}{variationResult.workflow.reviewer && ` · 审校：${variationResult.workflow.reviewer}`}{variationResult.workflow.revised ? ` · 修订 ${variationResult.workflow.revised} 道` : ""}</small></div>
            {variationResult.workflow.plan && <details open><summary>命题计划与难度依据</summary><p>目标：{variationResult.workflow.plan.objective}</p><p>先修知识：{variationResult.workflow.plan.prerequisites}</p><p>难度预测：{variationResult.workflow.plan.difficultyRationale}</p><p>常见误区：{variationResult.workflow.plan.misconception}</p><small>难度与误区为模型预测，需结合真实作答验证。</small></details>}<div className="variation-candidate-list">{variationResult.candidates.map((candidate) => {
              const checked = selectedVariationIds.includes(candidate.id);
              return <article key={candidate.id} className={`variation-candidate${checked ? " selected" : ""}`}>
                <button type="button" className="variation-candidate-check" onClick={() => toggleVariationCandidate(candidate.id)} aria-label={`${checked ? "取消采用" : "采用"}候选 ${candidate.ordinal}`}>{checked && <Check size={12} />}</button>
                <div className="variation-candidate-content">
                  <header><b>候选 {candidate.ordinal}</b><span className={`review-verdict ${candidate.review.status}`}>{candidate.review.status === "revised" ? "审校后已修订" : candidate.review.status === "passed" ? "审校通过" : "规则通过"}{candidate.review.score !== null ? ` · ${candidate.review.score} 分` : ""}</span></header>
                  <div className="candidate-stem"><MathText text={candidate.question.stem} /></div>
                  {candidate.diagramPreviewUrl && <figure className="candidate-diagram"><Image src={candidate.diagramPreviewUrl} width={720} height={480} alt={candidate.question.diagram?.altText || `候选 ${candidate.ordinal} 题图`} unoptimized /><figcaption>{candidate.question.diagram?.altText}</figcaption></figure>}
                  {candidate.question.options.length > 0 && <div className="candidate-options">{candidate.question.options.map((option) => <span key={option.key}><b>{option.key}</b><MathText text={option.content} /></span>)}</div>}
                  <details><summary>查看答案与解析</summary><div><b>答案</b><MathText text={candidate.question.answer} /></div><div><b>解析</b><MathText text={candidate.question.analysis} /></div></details>
                  {variationResult.workflow.verification?.find(check => check.index === candidate.ordinal) && <p>最终复核：{variationResult.workflow.verification.find(check => check.index === candidate.ordinal)?.explanation}</p>}<p className="candidate-change">变化：{candidate.question.changeNote}</p>
                  {candidate.review.issues.length > 0 && <p className="candidate-issues">审校发现并处理：{candidate.review.issues.join("；")}</p>}
                </div>
              </article>;
            })}</div>
          </div>}

          {variationError && <p className="form-error">{variationError}</p>}
          <footer>
            <p>{variationResult ? `已选 ${selectedVariationIds.length} / ${variationResult.candidates.length} 道；只有点击“采用已选”后才会进入正式题库。` : variationQualityMode === "reviewed" ? "先规划，再生成、审校与最终复核；任一质量门槛失败即停止，仍需教师确认。" : "快速模式成本更低，建议老师更仔细核对答案。"}</p>
            <div>{variationResult ? <>
              <button type="button" className="btn" disabled={variationAccepting || variationDiscarding} onClick={() => void discardVariations()}>{variationDiscarding ? "放弃中…" : "放弃本批"}</button>
              <button type="button" className="btn btn-primary" disabled={!selectedVariationIds.length || variationAccepting || variationDiscarding} onClick={() => void acceptVariations()}>{variationAccepting ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} {variationAccepting ? "正在入库…" : `采用已选 (${selectedVariationIds.length})`}</button>
            </> : <>
              <button type="button" className="btn" disabled={variationLoading} onClick={resetVariationDialog}>取消</button>
              <button type="button" className="btn btn-primary" disabled={variationLoading} onClick={() => void generateVariations()}><WandSparkles size={14} /> 开始生成</button>
            </>}</div>
          </footer>
        </section>
      </div>}
    </div>
  );
}

import { ClipboardCheck, Database, LoaderCircle } from "lucide-react";
import type { SourceDocument } from "../lib/types";
import type { DocumentGroup } from "../lib/workbench-documents";

export function WorkbenchOverview({ documents, approvedQuestions, onSelect }: {
  documents: SourceDocument[]; approvedQuestions: number; onSelect: (group: DocumentGroup) => void;
}) {
  // Preserve the original metrics: pending/approved questions, but processing papers.
  const pendingQuestions = documents.filter(document => document.status === "reviewing" && document.approvedCount < document.questionCount)
    .reduce((total, document) => total + Math.max(0, document.questionCount - document.approvedCount), 0);
  const processing = documents.filter(document => ["uploading", "extracting"].includes(document.status) || ["queued", "processing", "retry_wait"].includes(document.jobStatus ?? "")).length;
  return <section className="wb-overview" aria-label="工作概况">
    {[
      { group: "pending_review" as const, label: "待审核", value: pendingQuestions, unit: "道题", icon: ClipboardCheck },
      { group: "preprocessing" as const, label: "处理中", value: processing, unit: "份试卷", icon: LoaderCircle },
      { group: "reviewed" as const, label: "已入库", value: approvedQuestions, unit: "道题", icon: Database },
    ].map(({ group, label, value, unit, icon: Icon }) => <button type="button" key={group} onClick={() => onSelect(group)} aria-label={`${label} ${value} ${unit}，查看对应试卷`}>
      <span className="wb-metric-label">{label}<Icon size={16} /></span>
      <span className="wb-metric-value">{value.toLocaleString("zh-CN")}<small>{unit}</small></span>
    </button>)}
  </section>;
}

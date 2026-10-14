import { ClipboardCheck, Database, LoaderCircle } from "lucide-react";
import type { DocumentListResult } from "../lib/document-list";
import type { DocumentGroup } from "../lib/workbench-documents";
import type { ExtractionSpeed } from "../lib/extraction-speed";

export function WorkbenchOverview({ stats, speed, onSelect }: {
  stats: DocumentListResult["stats"]; speed?: ExtractionSpeed; onSelect: (group: DocumentGroup) => void;
}) {
  const { pendingQuestions, processing, approvedQuestions } = stats;
  return <section className="wb-overview" aria-label="工作概况">
    {[
      { group: "preprocessing" as const, label: "处理中", value: processing, unit: "份试卷", icon: LoaderCircle },
      { group: "pending_review" as const, label: "待审核", value: pendingQuestions, unit: "道题", icon: ClipboardCheck },
      { group: "reviewed" as const, label: "已入库", value: approvedQuestions, unit: "道题", icon: Database },
    ].map(({ group, label, value, unit, icon: Icon }) => <button type="button" key={group} onClick={() => onSelect(group)} aria-label={`${label} ${value} ${unit}，查看对应试卷`}>
      <span className="wb-metric-label">{label}<Icon size={16} /></span>
      <span className="wb-metric-value">{value.toLocaleString("zh-CN")}<small>{unit}</small></span>
      {group === "preprocessing" && <span className="wb-metric-speed" aria-label="AI 处理速度"
        title={speed ? `最近 ${Number(speed.windowSeconds.toFixed(1))} 秒新增完成识别 ${speed.completedQuestions} 题；起步按实际经过时间估算，最长取近 10 秒。不计人工审核、导入和重复识别。每 2 秒更新。` : "正在获取运行数据"}>
        <span>AI 处理速度</span><strong>{speed ? `≈ ${speed.questionsPerSecond.toFixed(2)} 题/s` : "— 题/s"}</strong>
      </span>}
    </button>)}
  </section>;
}

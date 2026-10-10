import type { SourceDocument } from "./types";

export type DocumentGroup = "all" | "preprocessing" | "pending_review" | "reviewed";
export type DocumentSort = "newest" | "oldest" | "name";

export const documentGroups: Array<{ id: DocumentGroup; title: string; description: string; empty: string }> = [
  { id: "all", title: "全部", description: "全部试卷", empty: "还没有试卷，点击“导入试卷”开始。" },
  { id: "preprocessing", title: "待处理", description: "上传、排队、识别、暂停或异常的试卷", empty: "暂无待处理试卷" },
  { id: "pending_review", title: "待审核", description: "识别完成，等待人工确认", empty: "暂无待审核试卷" },
  { id: "reviewed", title: "已入库", description: "全部题目已确认并进入题库", empty: "暂无已入库试卷" },
];

export function documentGroup(document: SourceDocument): Exclude<DocumentGroup, "all"> {
  if (document.completedPageCount < document.pageCount) return "preprocessing";
  if (document.status === "complete") return "reviewed";
  if (document.status === "reviewing") return "pending_review";
  return "preprocessing";
}

export function filterDocuments(documents: SourceDocument[], group: DocumentGroup, search: string, sort: DocumentSort) {
  const query = search.trim().toLocaleLowerCase();
  return documents.filter(document => (group === "all" || documentGroup(document) === group) && document.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh-CN", { numeric: true }) :
      (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * (sort === "oldest" ? 1 : -1));
}

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAssignmentDetail } from "../../../../lib/backend-data";

export const metadata = { title: "作业答题卡 · 拣题" };

export default async function AnswerSheetPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const detail = await getAssignmentDetail(ownerId, (await params).assignmentId).catch(() => null);
  if (!detail) notFound();
  const assignment = detail.assignment as { title: string; assignmentCode: string; totalScore: number };
  return <main className="answer-sheet-page"><p className="answer-sheet-print">请使用浏览器打印（Ctrl+P）</p>{detail.classes.map((teachingClass) => <section className="answer-sheet" key={teachingClass.id}><header><div><h1>{assignment.title} · 答题卡</h1><p>{teachingClass.name}　姓名：________________　学号：________________</p></div><aside><small>作业码</small><strong>{assignment.assignmentCode}</strong><span>满分 {assignment.totalScore} 分</span></aside></header><div className="answer-sheet-notice">请在题号对应区域内作答；客观题填写答案，解答题写出必要步骤。</div><div className="answer-sheet-grid">{detail.items.map((item) => <article key={item.questionId} className={(item.snapshot as { type?: string }).type === "solution" ? "large" : ""}><header><b>{item.position + 1}</b><span>{item.maxScore} 分</span></header><div /></article>)}</div><footer>拣题 · {assignment.assignmentCode} · {teachingClass.name}</footer></section>)}</main>;
}

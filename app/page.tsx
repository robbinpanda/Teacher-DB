import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, FileStack, ScanText } from "lucide-react";
import { UploadWorkbench } from "../components/UploadWorkbench";
import { RecentDocuments } from "../components/RecentDocuments";
import { getBankData, getDocuments } from "../lib/question-repository";
import { headers } from "next/headers";
import { kickExtractionQueue } from "../lib/extraction-queue";

export const metadata = { title: "工作台 · 拾题" };

export default async function Home() {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const [sourceDocuments, bankData] = await Promise.all([getDocuments(ownerId), getBankData(ownerId)]);
  void kickExtractionQueue();

  const reviewDocuments = sourceDocuments.filter((document) => document.status === "reviewing" && document.approvedCount < document.questionCount);
  const nextReview = reviewDocuments[0] ?? sourceDocuments.find((document) => document.status === "reviewing");
  const processingDocuments = sourceDocuments.filter((document) =>
    ["uploading", "extracting"].includes(document.status) || ["queued", "processing", "retry_wait"].includes(document.jobStatus ?? ""),
  );
  const failedDocuments = sourceDocuments.filter((document) => document.status === "failed" || document.jobStatus === "failed");
  const approvedQuestions = bankData.stats.approved;
  const pendingQuestions = reviewDocuments.reduce((total, document) => total + Math.max(0, document.questionCount - document.approvedCount), 0);
  const todoDocuments = [...failedDocuments, ...reviewDocuments.filter((document) => document.id !== nextReview?.id), ...processingDocuments]
    .filter((document) => document.id !== nextReview?.id)
    .filter((document, index, items) => items.findIndex((item) => item.id === document.id) === index)
    .slice(0, 4);

  return (
    <div className="page-shell dashboard workspace-page">
      <header className="workspace-header">
        <div><h1>工作台</h1><p>导入试卷、完成审核，题目就会进入题库。</p></div>
        <div className="header-actions">
          <Link className="btn" href="/bank"><FileStack size={16} /> 打开题库</Link>
          {nextReview && <Link className="btn btn-primary" href={`/review/${nextReview.id}`}><ScanText size={16} /> 继续审核</Link>}
        </div>
      </header>

      <section className="workspace-status" aria-label="工作概况">
        <article className={pendingQuestions ? "needs-action" : ""}><span>待审核</span><strong>{pendingQuestions}</strong><small>道题</small></article>
        <article><span>处理中</span><strong>{processingDocuments.length}</strong><small>份试卷</small></article>
        <article><span>已入库</span><strong>{approvedQuestions}</strong><small>道题</small></article>
      </section>

      <section className="dashboard-grid">
        <UploadWorkbench />
        <aside className="todo-card card">
          <div className="section-title">
            <div><h2>接着处理</h2><p>需要你关注的试卷</p></div>
            {failedDocuments.length > 0 && <span className="todo-warning"><AlertCircle size={13} /> {failedDocuments.length} 项异常</span>}
          </div>
          {nextReview ? <Link href={`/review/${nextReview.id}`} className="next-review">
            <span className="next-review-icon"><ScanText size={19} /></span>
            <div><small>下一项</small><strong>{nextReview.name}</strong><span>已审核 {nextReview.approvedCount}/{nextReview.questionCount} 题</span></div>
            <ArrowRight size={17} />
          </Link> : <div className="todo-clear"><CheckCircle2 size={22} /><div><strong>没有待审核试卷</strong><p>新试卷识别完成后会出现在这里。</p></div></div>}
          {todoDocuments.length > 0 && <div className="todo-list">{todoDocuments.map((document) => {
            const failed = document.status === "failed" || document.jobStatus === "failed";
            const reviewing = document.status === "reviewing";
            const label = failed ? "处理异常" : reviewing ? `待审核 ${Math.max(0, document.questionCount - document.approvedCount)} 题` : document.jobStatus === "retry_wait" ? "等待重试" : "正在处理";
            return <Link key={document.id} href={document.status === "uploading" ? "/" : `/review/${document.id}`}><span className={failed ? "failed" : ""}>{label}</span><strong>{document.name}</strong><ArrowRight size={14} /></Link>;
          })}</div>}
        </aside>
      </section>

      <section className="recent-section">
        <div className="section-title"><div><h2>全部试卷</h2><p>{sourceDocuments.length ? `共 ${sourceDocuments.length} 份，按最近更新排序` : "导入后可在这里查看进度"}</p></div></div>
        <RecentDocuments initialDocuments={sourceDocuments} />
      </section>
    </div>
  );
}

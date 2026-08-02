import Link from "next/link";
import { ArrowRight, Clock3, FileStack, ScanText, Sparkles } from "lucide-react";
import { UploadWorkbench } from "../components/UploadWorkbench";
import { getDocuments } from "../lib/question-repository";
import { headers } from "next/headers";

export const metadata = { title: "处理中心 · 拾题" };

export default async function Home() {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const sourceDocuments = await getDocuments(ownerId);
  const nextReview = sourceDocuments.find((document) => document.status === "reviewing");
  return (
    <div className="page-shell dashboard">
      <header className="page-header">
        <div>
          <span className="eyebrow"><Sparkles size={14} /> Question workspace</span>
          <h1>把整份试卷，变成<br />随时可用的题库。</h1>
          <p>上传 PDF、DOCX 或图片，系统按页渲染后交给多模态模型识别。文字、LaTeX 公式、题图和答案会保持对应，并进入人工复核。</p>
        </div>
        <div className="header-actions">
          <Link className="btn" href="/bank"><FileStack size={16} /> 查看题库</Link>
          {nextReview && <Link className="btn btn-primary" href={`/review/${nextReview.id}`}><ScanText size={16} /> 继续审核</Link>}
        </div>
      </header>
      <section className="dashboard-grid">
        <UploadWorkbench />
        <aside className="pipeline-card card">
          <div className="section-title"><div><h2>处理流水线</h2><p>每一步都保留原始证据</p></div><span className="pill green">方案 1</span></div>
          <ol className="pipeline-list">
            <li className="done"><span>01</span><div><strong>原卷页面化</strong><small>PDF / DOCX / 图片 → 高清页面图</small></div></li>
            <li className="active"><span>02</span><div><strong>视觉模型抽题</strong><small>题干、LaTeX、答案、坐标框 → JSON</small></div></li>
            <li><span>03</span><div><strong>人工复核</strong><small>修文字、拖选区、补标签</small></div></li>
            <li><span>04</span><div><strong>题库与组卷</strong><small>筛选、排版、打印或导出 PDF</small></div></li>
          </ol>
          <div className="evidence-note"><ScanText size={18} /><div><strong>不丢原始页面</strong><p>每道题都记录来源页码和归一化坐标，审核时可随时回看。</p></div></div>
        </aside>
      </section>
      <section className="recent-section">
        <div className="section-title"><div><h2>最近处理的试卷</h2><p>从上传到落库的状态一目了然</p></div></div>
        <div className="document-list">
          {sourceDocuments.map((doc) => {
            const progress = doc.questionCount ? Math.round((doc.approvedCount / doc.questionCount) * 100) : doc.status === "extracting" ? 42 : 0;
            return (
              <Link href={doc.status === "complete" ? "/bank" : `/review/${doc.id}`} className="document-row card" key={doc.id}>
                <span className={"document-icon " + doc.subject}>{doc.subject.slice(0, 1)}</span>
                <div className="document-main"><strong>{doc.name}</strong><span><Clock3 size={12} /> {new Date(doc.createdAt).toLocaleString("zh-CN")}　·　{doc.pageCount} 页　·　{doc.grade}</span></div>
                <div className="document-progress"><div><span>{doc.status === "extracting" ? "AI 识别中" : doc.status === "complete" ? "已入库" : "已审核 " + doc.approvedCount + "/" + doc.questionCount}</span><b>{progress}%</b></div><div className="progress"><span style={{ width: progress + "%" }} /></div></div>
                <ArrowRight size={17} className="row-arrow" />
              </Link>
            );
          })}
          {!sourceDocuments.length && <div className="card empty-state"><h3>还没有处理记录</h3><p>在上方上传第一份 PDF、DOCX 或图片试卷。</p></div>}
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";
import { FileStack, ScanText, Sparkles } from "lucide-react";
import { UploadWorkbench } from "../components/UploadWorkbench";
import { RecentDocuments } from "../components/RecentDocuments";
import { getDocuments } from "../lib/question-repository";
import { headers } from "next/headers";
import { kickExtractionQueue } from "../lib/extraction-queue";

export const metadata = { title: "处理中心 · 拾题" };

export default async function Home() {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  const sourceDocuments = await getDocuments(ownerId);
  void kickExtractionQueue();
  const nextReview = sourceDocuments.find((document) => document.status === "reviewing");
  return (
    <div className="page-shell dashboard">
      <header className="page-header">
        <div>
          <span className="eyebrow"><Sparkles size={14} /> Question workspace</span>
          <h1>把整份试卷，变成<br />随时可用的题库。</h1>
          <p>批量上传 PDF 试卷，系统按页渲染后交给多模态模型识别。文字、LaTeX 公式、题图和答案会保持对应，并进入人工复核。</p>
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
            <li className="done"><span>01</span><div><strong>原卷页面化</strong><small>PDF → 高清页面图</small></div></li>
            <li className="active"><span>02</span><div><strong>视觉模型抽题</strong><small>题干、LaTeX、答案、坐标框 → JSON</small></div></li>
            <li><span>03</span><div><strong>人工复核</strong><small>修文字、拖选区、补标签</small></div></li>
            <li><span>04</span><div><strong>题库与组卷</strong><small>筛选、排版、打印或导出 PDF</small></div></li>
          </ol>
          <div className="evidence-note"><ScanText size={18} /><div><strong>不丢原始页面</strong><p>每道题都记录来源页码和归一化坐标，审核时可随时回看。</p></div></div>
        </aside>
      </section>
      <section className="recent-section">
        <div className="section-title"><div><h2>最近处理的试卷</h2><p>从上传到落库的状态一目了然</p></div></div>
        <RecentDocuments initialDocuments={sourceDocuments} />
      </section>
    </div>
  );
}

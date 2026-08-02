import { Suspense } from "react";
import { PaperBuilder } from "../../../components/PaperBuilder";
import { demoQuestions } from "../../../lib/demo-data";

export const metadata = { title: "智能组卷 · 拾题" };

export default function NewPaperPage() {
  return <Suspense fallback={<div className="empty-note">正在加载组卷器…</div>}><PaperBuilder questions={demoQuestions} /></Suspense>;
}

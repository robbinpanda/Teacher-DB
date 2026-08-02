import { PaperBuilder } from "../../../components/PaperBuilder";
import { demoQuestions } from "../../../lib/demo-data";

export const metadata = { title: "智能组卷 · 拾题" };

export default function NewPaperPage() {
  return <PaperBuilder questions={demoQuestions} />;
}

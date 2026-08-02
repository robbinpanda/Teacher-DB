import { ReviewWorkspace } from "../../../components/ReviewWorkspace";
import { demoQuestions } from "../../../lib/demo-data";

export const metadata = { title: "人工审核 · 拾题" };

export default function ReviewPage() {
  return <ReviewWorkspace initialQuestions={demoQuestions.slice(0, 4)} />;
}

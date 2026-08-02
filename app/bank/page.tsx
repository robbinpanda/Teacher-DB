import { QuestionBank } from "../../components/QuestionBank";
import { demoQuestions } from "../../lib/demo-data";

export const metadata = { title: "我的题库 · 拾题" };

export default function BankPage() {
  return <QuestionBank initialQuestions={demoQuestions} />;
}

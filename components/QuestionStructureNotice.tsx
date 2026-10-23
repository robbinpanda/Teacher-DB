import Link from 'next/link';
import type {QuestionStructureIssue} from '../lib/question-structure';

export function QuestionStructureNotice({issues=[],documentId,questionId}:{issues?:QuestionStructureIssue[];documentId:string;questionId:string}) {
  if(!issues.length)return null;
  const blocked=issues.some(issue=>issue.severity==='error');
  return <div className={blocked?'studio-error':'studio-gap'} aria-label="题目结构检查">
    <strong>{blocked?'结构需修复，自动选题暂不使用':'题型与答案需核对'}</strong>
    <ul>{issues.map(issue=><li key={issue.code}>{issue.message}</li>)}</ul>
    <Link href={`/review/${encodeURIComponent(documentId)}?question=${encodeURIComponent(questionId)}`} target="_blank" rel="noopener noreferrer">打开原题核对与修复</Link>
  </div>;
}

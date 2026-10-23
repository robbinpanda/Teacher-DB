"use client";
import Image from "next/image";
import { useEducationScope } from "./AppShell";
import { MathText } from "./MathText";
import { difficultyLabels, knowledgeCatalog } from "../lib/knowledge-catalog";
import type { AuthoringChapter, AuthoringChapterVersion } from "../lib/authoring-content";

export function ChapterHistory({ history, version, busy, canRestore, onView, onRestore, onClose }: {
  history: NonNullable<AuthoringChapter["history"]>; version: AuthoringChapterVersion | null;
  busy: boolean; canRestore: boolean; onView: (id: string) => void; onRestore: (id: string) => void; onClose: () => void;
}) {
  const scope = useEducationScope(), catalog = knowledgeCatalog(scope.subject, scope.stage);
  const plan = version?.plan, content = version?.content;
  return <section className="studio-chapter-history">
    <details className="studio-history"><summary>已保存的历史版本（{history.length}）</summary>
      {history.map(entry => <p key={entry.id}>版本 {entry.revision} · {new Date(entry.createdAt).toLocaleString()} · {entry.reason}
        <small>{entry.hasPlan ? entry.hasContent ? "计划与正文" : "仅计划，尚无正文" : "旧版仅保存正文"}</small>
        <button className="btn" disabled={busy} onClick={() => onView(entry.id)}>查看版本 {entry.revision}</button>
      </p>)}
    </details>
    {version && <section className="studio-historical-content" aria-label={`历史版本 ${version.revision}`}>
      <h4>历史版本 {version.revision} · {plan?.title ?? "正文预览"}</h4>
      <p>{version.reason} · {new Date(version.createdAt).toLocaleString()}</p>
      {!plan && <p className="studio-gap">该旧版本没有保存当时的计划。恢复时会按当前计划检查正文，不能恢复旧题量和分值。</p>}
      {plan && <>
        <h5>当时的章节计划</h5><p>{plan.knowledgeIds.map(id => catalog.find(node => node.id === id)?.label ?? id).join("、")}</p>
        <ul>{plan.objectives.map((objective, index) => <li key={index}>{objective}</li>)}</ul>
        <p><MathText text={plan.teachingNotes}/></p>
        <div className="studio-history-table"><table><thead><tr><th>用途与选题目的</th><th>题型</th><th>难度</th><th>题量</th><th>每题分值</th></tr></thead><tbody>
          {plan.slots.map((slot, index) => <tr key={index}><td>{({ example: "例题", practice: "练习", assessment: "检测" })[slot.role]} · {slot.purpose}</td><td>{({ any: "不限", single: "单选", multiple: "多选", fill: "填空", answer: "解答" })[slot.type]}</td><td>{difficultyLabels[slot.difficulty]}</td><td>{slot.count}</td><td>{slot.score}</td></tr>)}
        </tbody></table></div>
      </>}
      {content ? <>
        <h5>当时的正文与选题</h5><p><MathText text={content.introduction}/></p>
        {content.knowledge.map(item => <section key={item.id}><h5>{item.title}</h5><p><MathText text={item.explanation}/></p>
          {item.formulas.map((formula, index) => <p key={index}><MathText text={`$${formula.latex}$`}/> · 条件：<MathText text={formula.conditions}/></p>)}
          <p><MathText text={item.method}/></p>{item.misconceptions.map((entry, index) => <p key={index}>易错：<MathText text={entry.mistake}/>；纠正：<MathText text={entry.correction}/></p>)}
        </section>)}
        {content.items.map((item, index) => {
          const question = content.questions.find(question => question.id === item.questionId);
          return <section key={item.questionId}><h5>第 {index + 1} 道题{question ? ` · 来源：${question.source.documentName} 原第 ${question.number} 题` : ""}</h5>
            {question && <><p><MathText text={question.stem}/></p>{question.options?.map(option => <p key={option.key}>{option.key}. <MathText text={option.content}/></p>)}
              {question.assets.filter(asset => asset.url).map(asset => <Image key={asset.id} src={asset.url!} alt={asset.label} width={asset.width ?? 600} height={asset.height ?? 400} unoptimized style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: 400 }}/>)}</>}
            <p>选入理由：<MathText text={item.selectionReason}/></p><p><MathText text={item.teachingExplanation}/></p>
          </section>;
        })}
        <p><strong>本章小结：</strong><MathText text={content.conclusion}/></p>
        {!!content.gaps.length && <p className="studio-gap">该版本仍有 {content.gaps.length} 组缺题，恢复后需补齐。</p>}
      </> : <p>此版本尚未编写正文，恢复后需要重新生成本章。</p>}
      <p>恢复后需重新核对采用。当前版本会保留到历史，其他章节继续保留。</p>
      <div className="studio-plan-actions"><button className="btn" onClick={onClose}>关闭历史预览</button>
        <button className="btn btn-primary" disabled={busy || !canRestore} onClick={() => onRestore(version.id)}>{plan ? content ? "恢复计划与正文" : "恢复此计划" : "按当前计划恢复正文"}</button>
      </div>
    </section>}
  </section>;
}

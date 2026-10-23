import type { WorkCoverage } from "../lib/authoring-coverage";
import { difficultyLabels } from "../lib/knowledge-catalog";

export function AuthoringCoverage({ coverage, educational }: { coverage: WorkCoverage; educational: boolean }) {
  return <details className="studio-work-coverage">
    <summary>整份作品覆盖 · {coverage.rows.filter(row => row.complete).length}/{coverage.rows.length} 个考点完成核对 · 已选 {coverage.selectedQuestions}/{coverage.plannedQuestions} 题</summary>
    <p>“已选”来自已保存的正文，“教师采用”表示老师已核对该章。难度是大纲中的教学目标；本表不把章节标题或关键词命中当作已完成覆盖。</p>
    {!!coverage.staleQuestionIds.length && <p className="studio-error">{coverage.staleQuestionIds.length} 道引用题目已变化或不可用，已从有效覆盖中移除，请修订对应章节。</p>}
    {!!coverage.duplicateQuestionIds.length && <p className="studio-error">发现 {coverage.duplicateQuestionIds.length} 道重复题，未重复计算覆盖，请替换后重新核对。</p>}
    <div className="studio-coverage-table"><table><thead><tr><th>考点与核对状态</th>{educational && <th>知识讲解</th>}<th>例题：已选/计划</th><th>练习：已选/计划</th><th>检测：已选/计划</th></tr></thead>
      <tbody>{coverage.rows.map(row => <tr key={row.id}><th scope="row">{row.label}<small>{row.complete ? "已完成核对" : "尚未完成"}</small></th>{educational && <td>{row.adoptedKnowledge ? "教师已采用" : row.written ? "已编写，待核对" : "尚未编写"}</td>}
        {(["example", "practice", "assessment"] as const).map(role => <td key={role}>{row.roles[role].selected}/{row.roles[role].planned}<small>教师采用 {row.roles[role].adopted} 题</small>{!!row.roles[role].difficulties.length && <small>目标：{row.roles[role].difficulties.map(level => difficultyLabels[level]).join(" → ")}</small>}</td>)}
        </tr>)}</tbody></table></div>
    <p>教师已采用 {coverage.adoptedQuestions}/{coverage.plannedQuestions} 道题。{coverage.ready ? "整份作品的计划配额与采用状态已满足。" : "请按表补足正文与选题，并逐章核对采用。"}</p>
  </details>;
}

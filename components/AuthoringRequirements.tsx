"use client";
import { inspectPlanRequirements, metricLabels, operatorLabels, requirementLabel, type AuthoringRequirements as Requirements, type NumericRequirement } from "../lib/authoring-requirements";
import type { AuthoringPlan } from "../lib/authoring-plan";
import type { KnowledgeNode } from "../lib/knowledge-catalog";
import type { EducationScope } from "../lib/education-scope";

export function AuthoringRequirements({ value, plan, nodes, scope, editable, onChange }: { value: Requirements; plan: AuthoringPlan | null; nodes: KnowledgeNode[]; scope: EducationScope; editable: boolean; onChange: (next: Requirements) => void }) {
  const checks = plan ? inspectPlanRequirements(plan, value, scope) : [];
  const change = (index: number, patch: Partial<NumericRequirement>) => onChange({ ...value, numeric: value.numeric.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return <section className="studio-requirements" aria-label="教学要求核对">
    <h2>教学要求核对</h2><p>以下是从原话识别的要求，请核对是否完整、准确。{value.editedByTeacher ? "已包含教师调整。" : "数量核算通过不代表模型已理解全部教学意图。"}</p>
    {value.numeric.map((item, index) => <article key={index}>
      <strong>{requirementLabel(item)}：{operatorLabels[item.operator]} {item.value}</strong>
      <blockquote>“{item.evidence}”</blockquote>
      {checks[index] && <p className={checks[index].passed ? "" : "studio-gap"}>{checks[index].passed ? "核算符合" : "不符合要求"} · {checks[index].actual}</p>}
      {editable && <details><summary>修改第 {index + 1} 项要求</summary><div className="studio-requirement-fields">
        <label>核算项目<select value={item.metric} onChange={e => change(index, { metric: e.target.value as NumericRequirement["metric"] })}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>核算范围<select value={item.scope} onChange={e => change(index, { scope: e.target.value as NumericRequirement["scope"] })}><option value="work">整份</option><option value="eachChapter">每章</option><option value="eachKnowledge">每个考点</option></select></label>
        <label>数量关系<select aria-label={`要求 ${index + 1} 数量关系`} value={item.operator} onChange={e => change(index, { operator: e.target.value as NumericRequirement["operator"] })}>{Object.entries(operatorLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>数值<input aria-label={`要求 ${index + 1} 数值`} type="number" min={0} step="any" value={item.value} onChange={e => change(index, { value: Number(e.target.value) })}/></label>
        <label>原话依据<input value={item.evidence} onChange={e => change(index, { evidence: e.target.value })}/></label>
      </div>
        {(["roles", "types", "levels", ...(item.metric === "percent" ? ["withinRoles", "withinTypes"] : [])] as const).map(field => {
          const options: Array<[string | number, string]> = field === "levels" ? [1, 2, 3, 4, 5].map(n => [n, `难度 ${n}`]) : field.toLowerCase().includes("roles") ? [["example", "例题"], ["practice", "练习"], ["assessment", "检测"]] : [["single", "单选"], ["multiple", "多选"], ["fill", "填空"], ["answer", "解答"]];
          const key = field as "roles" | "types" | "levels" | "withinRoles" | "withinTypes";
          return <fieldset key={key}><legend>{({ roles: "用途", types: "题型", levels: "难度", withinRoles: "占比分母的用途", withinTypes: "占比分母的题型" })[key]}（不选表示不限）</legend>{options.map(([option, label]) => <label key={option}><input type="checkbox" checked={(item[key] as Array<string | number>).includes(option)} onChange={e => change(index, { [key]: e.target.checked ? [...item[key], option] : (item[key] as Array<string | number>).filter(v => v !== option) })}/>{label}</label>)}</fieldset>;
        })}
        <button className="btn" onClick={() => onChange({ ...value, numeric: value.numeric.filter((_, i) => i !== index) })}>删除第 {index + 1} 项要求</button>
      </details>}
    </article>)}
    {!value.numeric.length && <p>没有识别出明确的数量要求。</p>}
    {(value.questionTypes ?? []).map((item, index) => <article key={`types-${index}`}><strong>限定题型：{item.types.map(type => ({ single: "单选", multiple: "多选", fill: "填空", answer: "解答" })[type]).join("、")}</strong><blockquote>“{item.evidence}”</blockquote>
      {checks[value.numeric.length + index] && <p className={checks[value.numeric.length + index].passed ? "" : "studio-gap"}>{checks[value.numeric.length + index].actual}</p>}
      {editable && <button className="btn" onClick={() => onChange({ ...value, questionTypes: value.questionTypes.filter((_, i) => i !== index) })}>移除误识别题型限制</button>}
    </article>)}
    {editable && <button className="btn" onClick={() => onChange({ ...value, numeric: [...value.numeric, { metric: "questions", scope: "work", roles: [], types: [], levels: [], withinRoles: [], withinTypes: [], operator: "eq", value: 1, evidence: "" }] })}>补充数量要求</button>}
    {!!value.knowledge.length && <div><h3>原话指定的知识范围</h3>{value.knowledge.map(item => <p key={item.id}>{nodes.find(node => node.id === item.id)?.label ?? item.id} · “{item.evidence}” {editable && <button className="btn" onClick={() => onChange({ ...value, knowledge: value.knowledge.filter(entry => entry.id !== item.id) })}>移除误识别范围</button>}</p>)}</div>}
    {!!value.questions.length && <div className="studio-gap"><h3>需要核对后再规划</h3>{value.questions.map((item, index) => <p key={index}>“{item.evidence}”：{item.question} {editable && <button className="btn" onClick={() => onChange({ ...value, questions: value.questions.filter((_, i) => i !== index) })}>已处理，移除此疑问</button>}</p>)}<p>可在上方补充明确数量；若不作为硬性要求，可移除疑问后保存。</p></div>}
    {!!value.assumptions.length && <ul>{value.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul>}
  </section>;
}

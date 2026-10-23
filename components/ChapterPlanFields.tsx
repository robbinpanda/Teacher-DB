import type { AuthoringChapterPlan } from "../lib/authoring-plan";
import { difficultyLabels } from "../lib/knowledge-catalog";

export function ChapterPlanFields({ plan, onChange }: { plan: AuthoringChapterPlan; onChange: (plan: AuthoringChapterPlan) => void }) {
  const changeSlot = (index: number, value: Partial<AuthoringChapterPlan["slots"][number]>) => onChange({ ...plan, slots: plan.slots.map((slot, i) => i === index ? { ...slot, ...value } : slot) });
  return <div className="studio-chapter-plan-editor">
    <label>本章标题<input value={plan.title} onChange={event => onChange({ ...plan, title: event.target.value })}/></label>
    <label>本章讲解与衔接要求<textarea rows={4} value={plan.teachingNotes} onChange={event => onChange({ ...plan, teachingNotes: event.target.value })}/></label>
    {plan.slots.map((slot, index) => <fieldset key={index}><legend>第 {index + 1} 组 · {({ example: "例题", practice: "练习", assessment: "检测" })[slot.role]}</legend>
      <label>选题目的<textarea value={slot.purpose} onChange={event => changeSlot(index, { purpose: event.target.value })}/></label>
      <div className="studio-filters">
        <label>题量<input aria-label={`本章第 ${index + 1} 组题量`} type="number" min={1} max={30} value={slot.count} onChange={event => changeSlot(index, { count: Number(event.target.value) })}/></label>
        <label>目标难度<select aria-label={`本章第 ${index + 1} 组难度`} value={slot.difficulty} onChange={event => changeSlot(index, { difficulty: Number(event.target.value) })}>{difficultyLabels.slice(1).map((label, i) => <option key={label} value={i + 1}>{i + 1} · {label}</option>)}</select></label>
        <label>题型<select aria-label={`本章第 ${index + 1} 组题型`} value={slot.type} onChange={event => changeSlot(index, { type: event.target.value as typeof slot.type })}>{Object.entries({ any: "不限", single: "单选", multiple: "多选", fill: "填空", answer: "解答" }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>每题分值<input aria-label={`本章第 ${index + 1} 组分值`} type="number" min={0} max={100} value={slot.score} onChange={event => changeSlot(index, { score: Number(event.target.value) })}/></label>
      </div>
    </fieldset>)}
  </div>;
}

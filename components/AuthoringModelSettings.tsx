"use client";
export function AuthoringModelSettings({ models, profileId, reviewerProfileId, disabled, running, onChange }: {
  models: Array<{ id: string; displayName: string }>; profileId: string; reviewerProfileId?: string;
  disabled: boolean; running: boolean; onChange: (writerId: string, reviewerId?: string) => void;
}) {
  const missing = (id?: string) => id && !models.some(model => model.id === id);
  return <details className="studio-model-settings"><summary>本作品模型设置</summary>
    <p>选择后立即保存，用于后续规划、编写或重新审校。已保存的正文和审校记录保留；需要复核时点击章节中的“重新审校”。</p>
    {running && <p>任务正在处理，请先暂停并等待当前任务结束。</p>}
    <div className="studio-filters">
      <label>本作品规划与编写模型<select disabled={disabled || running} value={profileId} onChange={event => onChange(event.target.value, reviewerProfileId)}>
        {missing(profileId) && <option value={profileId} disabled>原模型已停用或移除</option>}{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}
      </select></label>
      <label>本作品审校模型<select disabled={disabled || running} value={reviewerProfileId ?? ""} onChange={event => onChange(profileId, event.target.value || undefined)}>
        <option value="">使用编写模型独立复核</option>{missing(reviewerProfileId) && <option value={reviewerProfileId} disabled>原审校模型已停用或移除</option>}{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}
      </select></label>
    </div>
  </details>;
}

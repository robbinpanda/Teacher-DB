"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, Check, ChevronLeft, ChevronRight, CircleDollarSign, Coins,
  KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, Wifi, X,
} from "lucide-react";
import { MODEL_PROTOCOL_LABELS, MODEL_PROTOCOLS, type ModelProtocol } from "../lib/model-protocols";

type Profile = {
  id: string;
  displayName: string;
  provider: ModelProtocol;
  baseUrl: string;
  model: string;
  apiKeyMask: string | null;
  isManaged: boolean;
  isMultimodal: boolean;
  timeoutMs: number;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  cachePricePerMillion: number | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
};

type UsageSummary = {
  profileId: string;
  displayName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  costCny: number | null;
  processedPages: number;
  pricedPages: number;
  pageCostCny: number;
  pagePricedEventCount: number;
  averageCostPerPage: number | null;
  todayTokens: number;
  todayCostCny: number | null;
};

type UsageResponse = {
  month: string;
  today: string;
  summaries: UsageSummary[];
  daily: Array<{ date: string; models: Array<{ profileId: string; tokens: number; costCny: number | null }> }>;
  trackingStartedAt: string | null;
  error?: string;
};

type ModelForm = {
  displayName: string;
  provider: ModelProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  cachePricePerMillion: string;
};

const emptyForm: ModelForm = {
  displayName: "",
  provider: "openai-chat-completions",
  baseUrl: "",
  model: "",
  apiKey: "",
  timeoutMs: 90000,
  inputPricePerMillion: "",
  outputPricePerMillion: "",
  cachePricePerMillion: "",
};

const chartColors = ["#18845d", "#5c6fc5", "#d18342", "#9263bb", "#3194a6", "#b85f75"];

function localMonth() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function localToday() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const value = new Date(year, monthNumber - 1 + delta, 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year} 年 ${monthNumber} 月`;
}

function numberText(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function moneyText(value: number | null, compact = false) {
  if (value === null) return "未配置价格";
  if (value === 0) return "¥0.00";
  if (compact && value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(value < 1 ? 4 : 2)}`;
}

function priceText(value: number | null) {
  return value === null ? "—" : `¥${value}/1M`;
}

export function ModelSettings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState("");
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [month, setMonth] = useState(localMonth);
  const [modelFilter, setModelFilter] = useState("all");
  const [chartMetric, setChartMetric] = useState<"tokens" | "cost">("tokens");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ModelForm>(emptyForm);

  async function loadProfiles() {
    const response = await fetch("/api/model-profiles", { cache: "no-store" });
    const result = await response.json() as { profiles?: Profile[]; selectedProfileId?: string; error?: string };
    if (!response.ok) throw new Error(result.error ?? "模型配置读取失败");
    setProfiles(result.profiles ?? []);
    setSelected(result.selectedProfileId ?? "");
  }

  async function loadUsage(targetMonth = month) {
    const query = new URLSearchParams({
      month: targetMonth,
      today: localToday(),
      timezoneOffset: String(new Date().getTimezoneOffset()),
    });
    const response = await fetch(`/api/model-usage?${query}`, { cache: "no-store" });
    const result = await response.json() as UsageResponse;
    if (!response.ok) throw new Error(result.error ?? "用量统计读取失败");
    setUsage(result);
  }

  async function refresh(targetMonth = month) {
    setLoading(true);
    try {
      await Promise.all([loadProfiles(), loadUsage(targetMonth)]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(month); }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const visibleSummaries = useMemo(() => (
    (usage?.summaries ?? []).filter((item) => modelFilter === "all" || item.profileId === modelFilter)
  ), [modelFilter, usage]);

  const totals = useMemo(() => {
    const current = month === localMonth();
    const tokens = visibleSummaries.reduce((sum, item) => sum + (current ? item.todayTokens : item.totalTokens), 0);
    const costs = visibleSummaries.map((item) => current ? item.todayCostCny : item.costCny).filter((value): value is number => value !== null);
    const pricedPages = visibleSummaries.filter((item) => item.pagePricedEventCount > 0);
    const pageCount = visibleSummaries.reduce((sum, item) => sum + item.processedPages, 0);
    const pricedPageCount = pricedPages.reduce((sum, item) => sum + item.pricedPages, 0);
    const pageCost = pricedPages.reduce((sum, item) => sum + item.pageCostCny, 0);
    return {
      current,
      tokens,
      cost: costs.length > 0 ? costs.reduce((sum, value) => sum + value, 0) : null,
      pageCount,
      averageCostPerPage: pricedPageCount > 0 ? pageCost / pricedPageCount : null,
    };
  }, [month, visibleSummaries]);

  async function selectProfile(profileId: string) {
    setBusy(`select:${profileId}`);
    setMessage("");
    try {
      const response = await fetch("/api/model-profiles", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedProfileId: profileId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "切换失败");
      setSelected(profileId);
      setMessage("默认识别模型已切换");
    } catch (error) { setMessage(error instanceof Error ? error.message : "切换失败"); }
    finally { setBusy(""); }
  }

  async function testProfile(profileId: string) {
    setBusy(`test:${profileId}`);
    setMessage("正在发送一张最小测试图片…");
    try {
      const response = await fetch("/api/model-profiles/test", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "连接失败");
      setMessage(`模型连接成功：${result.message ?? "OK"}`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(""); }
  }

  function startEdit(profile: Profile) {
    setEditingId(profile.id);
    setForm({
      displayName: profile.displayName,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: "",
      timeoutMs: profile.timeoutMs,
      inputPricePerMillion: profile.inputPricePerMillion?.toString() ?? "",
      outputPricePerMillion: profile.outputPricePerMillion?.toString() ?? "",
      cachePricePerMillion: profile.cachePricePerMillion?.toString() ?? "",
    });
    window.setTimeout(() => document.getElementById("model-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function resetEditor() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    const action = editingId ? `save:${editingId}` : "create";
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch(editingId ? `/api/model-profiles/${editingId}` : "/api/model-profiles", {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, ...(!editingId ? { select: true } : {}) }),
      });
      const result = await response.json() as { error?: string; repricedEvents?: number };
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setMessage(editingId
        ? `模型配置已更新，${result.repricedEvents ?? 0} 条历史调用已按当前价格重新计算`
        : "模型配置已加密保存并设为默认");
      resetEditor();
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(""); }
  }

  async function removeProfile(profileId: string) {
    if (!window.confirm("确定删除这个自定义模型吗？历史 Token 与费用记录会保留。")) return;
    setBusy(`delete:${profileId}`);
    try {
      const response = await fetch(`/api/model-profiles/${profileId}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "删除失败");
      }
      if (editingId === profileId) resetEditor();
      setMessage("自定义模型已删除，历史用量记录仍然保留");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(""); }
  }

  const editingProfile = editingId ? profiles.find((profile) => profile.id === editingId) ?? null : null;

  return (
    <div className="page-shell model-settings-page">
      <header className="page-header model-settings-header">
        <div><span className="eyebrow"><Activity size={14} /> 模型与用量</span><h1>模型设置</h1><p>管理识别模型、Token 用量与估算成本。价格按每百万 Token 填写，全部选填。</p></div>
        <button className="btn" type="button" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} size={15} /> 刷新数据</button>
      </header>

      {message && <div className="settings-message" role="status">{message}</div>}

      <section className="card usage-panel" aria-labelledby="usage-heading">
        <div className="usage-panel-head">
          <div><span className="section-kicker"><BarChart3 size={14} /> Usage</span><h2 id="usage-heading">用量与成本</h2><p>费用按模型当前配置的价格估算；保存价格后，全部历史调用会立即重新计算。</p></div>
          <div className="usage-controls">
            <div className="month-stepper">
              <button type="button" aria-label="上个月" onClick={() => setMonth((value) => shiftMonth(value, -1))}><ChevronLeft size={16} /></button>
              <strong>{monthLabel(month)}</strong>
              <button type="button" aria-label="下个月" disabled={month >= localMonth()} onClick={() => setMonth((value) => shiftMonth(value, 1))}><ChevronRight size={16} /></button>
            </div>
            <select aria-label="筛选模型" value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
              <option value="all">所有模型</option>
              {(usage?.summaries ?? []).map((item) => <option value={item.profileId} key={item.profileId}>{item.displayName}</option>)}
            </select>
            <div className="metric-switch" role="group" aria-label="图表指标">
              <button type="button" className={chartMetric === "tokens" ? "active" : ""} onClick={() => setChartMetric("tokens")}>Token</button>
              <button type="button" className={chartMetric === "cost" ? "active" : ""} onClick={() => setChartMetric("cost")}>费用</button>
            </div>
          </div>
        </div>

        <div className="usage-metrics">
          <MetricCard icon={<Activity size={18} />} label={totals.current ? "今日 Token" : "本月 Token"} value={numberText(totals.tokens)} detail="输入 + 缓存 + 输出" />
          <MetricCard icon={<CircleDollarSign size={18} />} label={totals.current ? "今日估算费用" : "本月估算费用"} value={moneyText(totals.cost)} detail="仅统计已配置价格的调用" />
          <MetricCard icon={<BarChart3 size={18} />} label="本月处理页次" value={numberText(totals.pageCount)} detail="按模型去重页面，重试不重复计页" />
          <MetricCard icon={<Coins size={18} />} label="平均每页" value={moneyText(totals.averageCostPerPage, true)} detail="页面识别成本 ÷ 去重页数" />
        </div>

        {loading && !usage ? <div className="usage-loading"><LoaderCircle className="spin" size={20} /> 正在读取用量…</div> : (
          <UsageChart month={month} summaries={visibleSummaries} daily={usage?.daily ?? []} metric={chartMetric} />
        )}

        <div className="usage-model-grid">
          {visibleSummaries.map((summary, index) => (
            <article className="usage-model-card" key={summary.profileId}>
              <div className="usage-model-title"><i style={{ background: chartColors[index % chartColors.length] }} /><div><strong>{summary.displayName}</strong><small>{summary.model}</small></div><b>{moneyText(summary.costCny)}</b></div>
              <div className="token-breakdown">
                <span><small>输入</small><strong>{numberText(summary.inputTokens)}</strong></span>
                <span><small>缓存</small><strong>{numberText(summary.cachedInputTokens)}</strong></span>
                <span><small>输出</small><strong>{numberText(summary.outputTokens)}</strong></span>
                <span><small>每页均价</small><strong>{moneyText(summary.averageCostPerPage, true)}</strong></span>
              </div>
            </article>
          ))}
          {!loading && visibleSummaries.length === 0 && <div className="usage-empty">尚无模型用量。启用本版本后，新的模型调用会从这里开始记录。</div>}
        </div>
        <p className="usage-footnote">Token 用量从本版本启用后开始记录，不会虚构补齐历史数据。费用始终按当前配置价格估算；价格全部留空时费用显示为“未配置价格”，缓存价格留空时按输入价格估算。</p>
      </section>

      <section className="model-manager" aria-labelledby="models-heading">
        <div className="model-manager-heading"><div><span className="section-kicker"><KeyRound size={14} /> Configuration</span><h2 id="models-heading">模型配置</h2><p>选择默认识别模型，测试连接或修改服务参数和价格。</p></div><button className="btn btn-primary" type="button" onClick={resetEditor}><Plus size={15} /> 添加模型</button></div>
        <div className="model-manager-grid">
          <div className="profile-list model-profile-list">
            {profiles.map((profile) => (
              <article key={profile.id} className={`model-profile-card${selected === profile.id ? " selected" : ""}${editingId === profile.id ? " editing" : ""}`}>
                <div className="model-profile-main">
                  <button className="profile-default" type="button" onClick={() => void selectProfile(profile.id)} disabled={Boolean(busy)} aria-label={`将 ${profile.displayName} 设为默认模型`}>
                    <span>{selected === profile.id && <Check size={13} />}</span>
                  </button>
                  <div className="model-profile-copy"><div><strong>{profile.displayName}</strong>{selected === profile.id && <em>默认</em>}{profile.isManaged && <em className="neutral">内置</em>}</div><p>{profile.model}</p><small>{MODEL_PROTOCOL_LABELS[profile.provider]} · {profile.baseUrl}</small></div>
                </div>
                <div className="model-price-line"><span>输入 {priceText(profile.inputPricePerMillion)}</span><span>输出 {priceText(profile.outputPricePerMillion)}</span><span>缓存 {priceText(profile.cachePricePerMillion)}</span></div>
                <div className="model-profile-footer">
                  <span className={`connection-state ${profile.lastTestStatus ?? "unknown"}`}>{profile.lastTestedAt ? (profile.lastTestStatus === "success" ? "连接正常" : "连接异常") : "尚未测试"}</span>
                  <div>
                    <button className="btn btn-small" type="button" disabled={Boolean(busy) || !profile.apiKeyMask} onClick={() => void testProfile(profile.id)}>{busy === `test:${profile.id}` ? <LoaderCircle className="spin" size={13} /> : <Wifi size={13} />} 测试</button>
                    <button className="btn btn-small" type="button" disabled={Boolean(busy)} onClick={() => startEdit(profile)}><Pencil size={13} /> 编辑</button>
                    {!profile.isManaged && <button className="icon-danger" title="删除模型" type="button" disabled={Boolean(busy)} onClick={() => void removeProfile(profile.id)}><Trash2 size={14} /></button>}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <form id="model-editor" className="card model-editor" onSubmit={saveProfile}>
            <div className="model-editor-head"><div><h3>{editingProfile ? `编辑 ${editingProfile.displayName}` : "添加自定义模型"}</h3><p>{editingProfile?.isManaged ? "内置连接参数由系统管理，你可以补充价格。" : "修改连接参数后，建议重新进行连接测试。"}</p></div>{editingProfile && <button className="icon-button" type="button" aria-label="取消编辑" onClick={resetEditor}><X size={16} /></button>}</div>
            <div className="model-editor-fields">
              <label><span>显示名称</span><input required disabled={Boolean(editingProfile?.isManaged)} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="例如：校内 Qwen-VL" /></label>
              <label><span>接口协议</span><select required disabled={Boolean(editingProfile?.isManaged)} value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as ModelProtocol })}>{MODEL_PROTOCOLS.map((protocol) => <option key={protocol} value={protocol}>{MODEL_PROTOCOL_LABELS[protocol]}</option>)}</select></label>
              <label className="wide"><span>API Base URL</span><input required disabled={Boolean(editingProfile?.isManaged)} type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
              <label><span>Model Name</span><input required disabled={Boolean(editingProfile?.isManaged)} value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="qwen-vl-max" /></label>
              <label><span>超时时间（毫秒）</span><input required disabled={Boolean(editingProfile?.isManaged)} type="number" min={15000} max={300000} value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value) })} /></label>
              {!editingProfile?.isManaged && <label className="wide"><span>API Key {editingProfile && <small>留空则保持原密钥</small>}</span><input required={!editingProfile} type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={editingProfile ? `当前 ${editingProfile.apiKeyMask ?? "已保存"}` : "sk-…"} /></label>}
            </div>
            <div className="price-editor">
              <div><strong>Token 价格</strong><span>人民币 / 1M Token · 选填</span></div>
              <div className="price-fields">
                <label><span>输入</span><div><b>¥</b><input type="number" min="0" step="any" value={form.inputPricePerMillion} onChange={(event) => setForm({ ...form, inputPricePerMillion: event.target.value })} placeholder="选填" /></div></label>
                <label><span>输出</span><div><b>¥</b><input type="number" min="0" step="any" value={form.outputPricePerMillion} onChange={(event) => setForm({ ...form, outputPricePerMillion: event.target.value })} placeholder="选填" /></div></label>
                <label><span>缓存</span><div><b>¥</b><input type="number" min="0" step="any" value={form.cachePricePerMillion} onChange={(event) => setForm({ ...form, cachePricePerMillion: event.target.value })} placeholder="默认按输入价" /></div></label>
              </div>
            </div>
            <p className="security-note"><ShieldCheck size={14} /> API Key 使用 AES-GCM 加密且接口不回传明文。价格仅用于本地估算，实际账单以模型服务商为准。</p>
            <button className="btn btn-primary model-save" disabled={Boolean(busy)} type="submit">{busy === (editingId ? `save:${editingId}` : "create") ? <LoaderCircle className="spin" size={15} /> : editingId ? <Save size={15} /> : <Plus size={15} />} {editingId ? "保存修改" : "保存并设为默认"}</button>
          </form>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <article className="usage-metric"><i>{icon}</i><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function UsageChart({ month, summaries, daily, metric }: {
  month: string;
  summaries: UsageSummary[];
  daily: UsageResponse["daily"];
  metric: "tokens" | "cost";
}) {
  const [year, monthNumber] = month.split("-").map(Number);
  const dayCount = new Date(year, monthNumber, 0).getDate();
  const dates = Array.from({ length: dayCount }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  const values = new Map(daily.map((day) => [day.date, new Map(day.models.map((item) => [item.profileId, item]))]));
  const data = dates.flatMap((date) => summaries.map((summary) => {
    const point = values.get(date)?.get(summary.profileId);
    return metric === "tokens" ? (point?.tokens ?? 0) : (point?.costCny ?? 0);
  }));
  const maximum = Math.max(0, ...data);
  const width = 1000;
  const height = 280;
  const left = 58;
  const right = 18;
  const top = 18;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const dayWidth = plotWidth / dayCount;
  const groupCount = Math.max(1, summaries.length);
  const barWidth = Math.max(1.5, Math.min(11, (dayWidth - 2) / groupCount));
  const tickValue = (ratio: number) => metric === "tokens" ? numberText(maximum * ratio) : moneyText(maximum * ratio, true);

  return (
    <div className="usage-chart-shell">
      <div className="usage-chart-scroll">
        <svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${monthLabel(month)}按模型统计的${metric === "tokens" ? "Token" : "费用"}图表`}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = top + plotHeight * (1 - ratio);
            return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} /><text x={left - 9} y={y + 4} textAnchor="end">{tickValue(ratio)}</text></g>;
          })}
          {dates.map((date, dayIndex) => summaries.map((summary, modelIndex) => {
            const point = values.get(date)?.get(summary.profileId);
            const value = metric === "tokens" ? (point?.tokens ?? 0) : (point?.costCny ?? 0);
            const barHeight = maximum > 0 ? value / maximum * plotHeight : 0;
            const x = left + dayIndex * dayWidth + (dayWidth - barWidth * groupCount) / 2 + modelIndex * barWidth;
            return <rect key={`${date}:${summary.profileId}`} x={x} y={top + plotHeight - barHeight} width={Math.max(1, barWidth - 1)} height={barHeight} rx="2" fill={chartColors[modelIndex % chartColors.length]}><title>{`${date.slice(5)} · ${summary.displayName}: ${metric === "tokens" ? numberText(value) + " Token" : moneyText(value, true)}`}</title></rect>;
          }))}
          {dates.map((date, index) => ((index === 0 || index === dates.length - 1 || (index + 1) % 5 === 0) ? <text key={date} x={left + index * dayWidth + dayWidth / 2} y={height - 17} textAnchor="middle">{date.slice(8)}</text> : null))}
        </svg>
        {maximum === 0 && <div className="chart-empty"><BarChart3 size={22} /><strong>这个月还没有用量</strong><span>新调用完成后，Token 会按模型出现在这里。</span></div>}
      </div>
      <div className="usage-legend">{summaries.map((summary, index) => <span key={summary.profileId}><i style={{ background: chartColors[index % chartColors.length] }} />{summary.displayName}</span>)}</div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Copy, FileText, RefreshCw, AlertTriangle } from "lucide-react";
import type { ModelTraceContent, ModelTraceDetail, ModelTraceSummary } from "../../lib/model-trace-types";

type Tab = "overview" | "prompt" | "reply" | "advanced";
const statuses = { complete: "成功", failed: "失败", unfinished: "未结束 / 中断" };
const purposes: Record<string, string> = { page_extraction: "整卷识别", question_reextract: "单题识别 / 补图", answer_import: "答案匹配" };
const tabs: Array<{ id: Tab; label: string }> = [{ id: "overview", label: "错误与校验" }, { id: "prompt", label: "提示词" }, { id: "reply", label: "原始回复" }, { id: "advanced", label: "原始流与更多" }];
function time(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function size(value: number) { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function prompts(text: string) {
  try {
    const body = object(object(JSON.parse(text)).body);
    const contentText = (value: unknown) => typeof value === "string" ? value : Array.isArray(value)
      ? value.flatMap(block => { const item = object(block); return typeof item.text === "string" ? [item.text] : []; }).join("\n") : "";
    const sections: Array<{ title: string; text: string }> = [];
    const system = contentText(body.system ?? body.instructions);
    if (system) sections.push({ title: "系统提示词", text: system });
    const messages = body.messages ?? body.input;
    for (const message of Array.isArray(messages) ? messages : []) {
      const item = object(message), text = contentText(item.content);
      if (text) sections.push({ title: item.role === "system" ? "系统提示词" : item.role === "user" ? "本次识别提示词" : String(item.role ?? "提示词"), text });
    }
    return sections;
  } catch { return []; }
}
async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) throw new Error(body?.error ?? "日志加载失败，请稍后刷新");
  return body as T;
}

export function DocumentModelLogs({ documentId, documentName, documentError }: { documentId: string; documentName: string; documentError?: string | null }) {
  const base = `/api/documents/${encodeURIComponent(documentId)}/model-traces`;
  const [traces, setTraces] = useState<ModelTraceSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<ModelTraceDetail | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [file, setFile] = useState("");
  const [content, setContent] = useState<ModelTraceContent | null>(null);
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [contentError, setContentError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void request<{ traces: ModelTraceSummary[]; nextCursor: string | null }>(base, controller.signal).then(data => {
      setTraces(data.traces); setCursor(data.nextCursor); setListError("");
      setSelected(current => data.traces.some(trace => trace.id === current) ? current : data.traces[0]?.id ?? "");
    }).catch(error => { if (!controller.signal.aborted) setListError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [base, refresh]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void request<{ trace: ModelTraceDetail }>(`${base}/${selected}`, controller.signal).then(data => {
      setDetail(data.trace); setDetailError("");
    }).catch(error => { if (!controller.signal.aborted) setDetailError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [base, selected, refresh]);

  const files = detail?.id === selected ? detail.files : [];
  const options = tab === "prompt" ? files.filter(item => /^request-\d+\.json$/.test(item.name))
    : tab === "reply" ? files.filter(item => item.name === "output.txt") : files;
  const activeFile = options.some(item => item.name === file) ? file : options[0]?.name ?? "";
  const offset = offsets.at(-1) ?? 0;
  useEffect(() => {
    if (tab === "overview" || !activeFile || !selected) return;
    const controller = new AbortController();
    void request<ModelTraceContent>(`${base}/${selected}/content?file=${encodeURIComponent(activeFile)}&offset=${offset}`, controller.signal).then(data => {
      setContent(data); setContentError("");
    }).catch(error => { if (!controller.signal.aborted) setContentError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setContentLoading(false); });
    return () => controller.abort();
  }, [base, selected, activeFile, offset, tab, refresh]);

  function selectTrace(id: string) { if (id === selected) return; setSelected(id); setDetail(null); setDetailLoading(true); setDetailError(""); setTab("overview"); setContent(null); setOffsets([0]); setFile(""); }
  function selectTab(value: Tab) { setTab(value); setFile(""); setContent(null); setContentLoading(value !== "overview"); setContentError(""); setOffsets([0]); setCopyMessage(""); }
  async function more() {
    if (!cursor) return;
    setListLoading(true);
    try { const data = await request<{ traces: ModelTraceSummary[]; nextCursor: string | null }>(`${base}?before=${encodeURIComponent(cursor)}`);
      setTraces(current => [...current, ...data.traces.filter(trace => !current.some(item => item.id === trace.id))]); setCursor(data.nextCursor); setListError("");
    } catch (error) { setListError(error instanceof Error ? error.message : "日志加载失败"); }
    finally { setListLoading(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(tab === "overview" ? JSON.stringify({ result: detail?.result, validation: detail?.validation }, null, 2) : content?.text ?? ""); setCopyMessage("已复制当前内容"); }
    catch { setCopyMessage("复制失败，可选中文字复制"); }
  }
  const visible = traces.filter(trace => !onlyFailed || trace.status === "failed");
  const promptSections = tab === "prompt" && content && !content.nextOffset && content.offset === 0 ? prompts(content.text) : [];
  return <div className="page-shell model-logs-page">
    <header className="model-logs-header">
      <div><Link href={`/review/${documentId}`} className="model-logs-back"><ArrowLeft size={15} /> 返回试卷审核</Link><h1><FileText size={23} /> 识别日志</h1><p>{documentName}</p></div>
      <button className="btn" type="button" onClick={() => { setListLoading(true); setDetailLoading(Boolean(selected)); setContentLoading(tab !== "overview"); setRefresh(value => value + 1); }}><RefreshCw size={15} /> 刷新日志</button>
    </header>
    {listError && <p className="form-error" role="alert">{listError}</p>}
    {!traces.length && !listLoading && !listError ? <section className="card model-logs-empty"><FileText size={32} /><h2>暂无模型调用日志</h2><p>启用日志记录前的识别无法补回原始回复。今后的模型调用会自动保留提示词、回复和错误。</p>{documentError && <p className="form-error">当前试卷错误：{documentError}</p>}</section>
      : <div className="model-logs-grid">
        <aside className="card model-trace-list" aria-label="历次识别记录">
          <div className="model-trace-list-heading"><strong>调用历史</strong><label><input type="checkbox" checked={onlyFailed} onChange={event => { setOnlyFailed(event.target.checked); const failed = traces.find(trace => trace.status === "failed"); if (event.target.checked && failed && !traces.some(trace => trace.id === selected && trace.status === "failed")) selectTrace(failed.id); }} /> 只看失败</label></div>
          {visible.map(trace => <button type="button" key={trace.id} aria-pressed={selected === trace.id} className={`model-trace-item ${selected === trace.id ? "selected" : ""}`} onClick={() => selectTrace(trace.id)}>
            <span><b>{purposes[trace.purpose] ?? "模型调用"}</b><em className={`model-trace-status ${trace.status}`}>{statuses[trace.status]}</em></span>
            <strong>{trace.model}</strong><small>{time(trace.startedAt)}{trace.attempt ? ` · 尝试 ${trace.attempt}` : ""}</small>{trace.error && <p>{trace.error}</p>}
          </button>)}
          {!visible.length && <p className="model-log-hint">{listLoading ? "正在加载调用记录…" : "当前已加载记录中没有失败调用。"}</p>}
          {cursor && <button type="button" className="btn btn-small" disabled={listLoading} onClick={() => void more()}>加载更早记录</button>}
        </aside>
        <section className="card model-trace-detail" aria-label="调用详情">
          {detailLoading ? <p className="model-log-hint" role="status">正在加载调用详情…</p> : detailError ? <p className="form-error" role="alert">{detailError}</p> : !detail || detail.id !== selected ? <p className="model-log-hint">请选择一条调用记录。</p> : <>
            <header><div><h2>{detail.model}<span className={`model-trace-status ${detail.status}`}>{statuses[detail.status]}</span></h2><p>{time(detail.startedAt)} · {purposes[detail.purpose] ?? "模型调用"}</p></div><small title={detail.id}>记录 {detail.id.slice(0, 8)}</small></header>
            {detail.error && <div className="model-log-error" role="alert"><AlertTriangle size={18} /><div><strong>{detail.validationStatus === "failed" ? "识别结果校验失败" : "模型调用失败"}</strong><p>{detail.error}</p></div></div>}
            {detail.status === "unfinished" && <p className="model-log-hint">尚未记录完整结束状态，可能仍在处理或已中断。已收到的回复保留在日志中，可刷新查看。</p>}
            <nav className="model-log-tabs" aria-label="日志内容">{tabs.map(item => <button type="button" key={item.id} aria-pressed={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => selectTab(item.id)}>{item.label}</button>)}</nav>
            {tab === "overview" ? <div className="model-log-overview">
              <div className="model-log-stages"><div><CheckCircle2 size={17} /><span>模型调用</span><b>{detail.callStatus === "complete" ? "返回完成" : detail.callStatus === "failed" ? "调用失败" : "未记录结束"}</b></div><div><FileText size={17} /><span>结果校验</span><b>{detail.validationStatus === "complete" ? "校验通过" : detail.validationStatus === "failed" ? "校验失败" : "未记录校验"}</b></div></div>
              <h3>结果校验详情</h3><pre>{detail.validation ? JSON.stringify(detail.validation, null, 2) : "本次调用没有独立的结果校验记录。"}</pre>
              <h3>模型调用结果与错误</h3><pre>{detail.result ? JSON.stringify(detail.result, null, 2) : "没有结束记录；请查看已收到的原始回复。"}</pre>
            </div> : <div className="model-log-content">
              {options.length > 0 && <div className="model-log-filebar"><label>{tab === "prompt" ? "本次请求" : tab === "reply" ? "模型正文" : "日志文件"}<select aria-label="日志文件" value={activeFile} onChange={event => { setFile(event.target.value); setOffsets([0]); setContent(null); setContentLoading(true); setContentError(""); }}>{options.map(item => <option value={item.name} key={item.name}>{item.name} · {size(item.bytes)}</option>)}</select></label><button type="button" className="btn btn-small" disabled={!content || contentLoading} onClick={() => void copy()}><Copy size={13} /> 复制当前内容</button></div>}
              {contentLoading && activeFile ? <p className="model-log-hint" role="status">正在读取日志内容…</p> : contentError ? <p className="form-error" role="alert">{contentError}</p> : !activeFile ? <p className="model-log-hint">{tab === "reply" ? "本次调用没有可解析的模型正文，请在“原始流与更多”查看HTTP错误或已收到的原始流。" : "暂无该类日志内容。"}</p> : content && promptSections.length ? promptSections.map((section, index) => <div className="model-log-prompt" key={index}><h3>{section.title}</h3><pre>{section.text}</pre></div>) : content ? <pre>{content.text || "（空内容）"}</pre> : null}
              {content && <div className="model-log-pagination"><span>第 {offsets.length} 段 · 共 {size(content.bytes)}{copyMessage && ` · ${copyMessage}`}</span><div><button type="button" className="btn btn-small" disabled={offsets.length < 2 || contentLoading} onClick={() => { setContentLoading(true); setOffsets(current => current.slice(0, -1)); }}><ChevronLeft size={14} /> 上一段</button><button type="button" className="btn btn-small" disabled={content.nextOffset === null || contentLoading} onClick={() => { setContentLoading(true); setOffsets(current => [...current, content.nextOffset!]); }} >下一段 <ChevronRight size={14} /></button></div></div>}
            </div>}
          </>}
        </section>
      </div>}
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2, Wifi } from "lucide-react";
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
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
};

export function ModelSettings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<ModelForm>({
    displayName: "",
    provider: "openai-chat-completions",
    baseUrl: "",
    model: "",
    apiKey: "",
    timeoutMs: 90000,
  });

  async function load() {
    try {
      const response = await fetch("/api/model-profiles", { cache: "no-store" });
      const result = await response.json() as { profiles?: Profile[]; selectedProfileId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "模型配置读取失败");
      setProfiles(result.profiles ?? []);
      setSelected(result.selectedProfileId ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取失败");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function selectProfile(profileId: string) {
    setBusy(profileId);
    setMessage("");
    try {
      const response = await fetch("/api/model-profiles", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedProfileId: profileId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "切换失败");
      setSelected(profileId);
      setMessage("默认识题模型已切换");
    } catch (error) { setMessage(error instanceof Error ? error.message : "切换失败"); }
    finally { setBusy(""); }
  }

  async function testProfile(profileId: string) {
    setBusy("test:" + profileId);
    setMessage("正在发送一张最小测试图片…");
    try {
      const response = await fetch("/api/model-profiles/test", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "连接失败");
      setMessage("多模态连接成功：" + (result.message ?? "OK"));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(""); }
  }

  async function createProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setMessage("");
    try {
      const response = await fetch("/api/model-profiles", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, select: true }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setForm({ displayName: "", provider: "openai-chat-completions", baseUrl: "", model: "", apiKey: "", timeoutMs: 90000 });
      setMessage("模型配置已加密保存并设为默认");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(""); }
  }

  async function removeProfile(profileId: string) {
    setBusy("delete:" + profileId);
    try {
      const response = await fetch("/api/model-profiles/" + profileId, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "删除失败");
      }
      setMessage("自定义模型已删除，默认模型已安全回退到 MiMo 2.5 Free");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(""); }
  }

  return (
    <div className="page-shell settings-page">
      <header className="page-header">
        <div><span className="eyebrow"><KeyRound size={14} /> MULTIMODAL MODELS</span><h1>模型与密钥</h1><p>内置 MiMo 2.5 Free 自动使用 OpenCode 公共凭据；自定义模型支持 Chat Completions、OpenAI Responses 和 Anthropic Messages。识题与连通性测试均使用无推理模式。</p></div>
        <button className="btn" type="button" onClick={() => void load()}><RefreshCw size={15} /> 刷新</button>
      </header>
      {message && <div className="settings-message" role="status">{message}</div>}
      <section className="settings-grid">
        <div className="card settings-card">
          <div className="section-title"><div><h2>可用模型</h2><p>只有明确支持图片输入的模型才应添加</p></div><span className="pill green"><ShieldCheck size={12} /> API Key 加密保存</span></div>
          {loading ? <div className="empty-note"><LoaderCircle className="spin" size={20} /> 正在读取…</div> : (
            <div className="profile-list">
              {profiles.map((profile) => (
                <article key={profile.id} className={"profile-row " + (selected === profile.id ? "selected" : "")}>
                  <button className="profile-select" type="button" onClick={() => void selectProfile(profile.id)} disabled={Boolean(busy)}>
                    <span className="profile-radio">{selected === profile.id && <Check size={13} />}</span>
                    <span><strong>{profile.displayName}</strong><small>{profile.model} · {profile.baseUrl}</small></span>
                  </button>
                  <div className="profile-meta"><span className="pill green">{MODEL_PROTOCOL_LABELS[profile.provider]}</span>{profile.isManaged && <span className="pill gray">内置免费 · 无需账号</span>}<code>{profile.isManaged ? "公共凭据" : profile.apiKeyMask}</code></div>
                  <div className="profile-actions">
                    <button className="btn btn-small" type="button" disabled={Boolean(busy) || !profile.apiKeyMask} onClick={() => void testProfile(profile.id)}>{busy === "test:" + profile.id ? <LoaderCircle className="spin" size={13} /> : <Wifi size={13} />} 测试</button>
                    {!profile.isManaged && <button className="icon-danger" title="删除" type="button" disabled={Boolean(busy)} onClick={() => void removeProfile(profile.id)}><Trash2 size={14} /></button>}
                  </div>
                  {profile.lastTestedAt && <small className={"test-state " + profile.lastTestStatus}>{profile.lastTestStatus === "success" ? "最近测试成功" : "最近测试失败"} · {new Date(profile.lastTestedAt).toLocaleString()}</small>}
                </article>
              ))}
            </div>
          )}
        </div>
        <form className="card settings-card model-form" onSubmit={createProfile}>
          <div className="section-title"><div><h2>添加自定义模型</h2><p>选择模型服务实际支持的接口协议</p></div><Plus size={18} /></div>
          <label><span>显示名称</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="例如：校内 Qwen-VL" /></label>
          <label><span>接口协议</span><select required value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as ModelProtocol })}>{MODEL_PROTOCOLS.map((protocol) => <option key={protocol} value={protocol}>{MODEL_PROTOCOL_LABELS[protocol]}</option>)}</select></label>
          <label><span>API Base URL</span><input required type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
          <label><span>Model Name</span><input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="qwen-vl-max" /></label>
          <label><span>API Key</span><input required type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="sk-…" /></label>
          <label><span>超时时间（毫秒）</span><input required type="number" min={15000} max={300000} value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value) })} /></label>
          <p className="security-note"><ShieldCheck size={14} /> 自定义密钥使用 AES-GCM 加密；服务端必须配置 <code>MODEL_KEY_ENCRYPTION_SECRET</code>，接口永不回传明文。</p>
          <button className="btn btn-primary" disabled={Boolean(busy)} type="submit">{busy === "create" ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} 加密保存并设为默认</button>
        </form>
      </section>
    </div>
  );
}

type ModelForm = {
  displayName: string;
  provider: ModelProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

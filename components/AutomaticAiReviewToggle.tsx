"use client";

import { useEffect, useState } from "react";

export function AutomaticAiReviewToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/extraction-queue", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("无法读取 AI 复核设置，请刷新重试");
      const data = await response.json();
      if (!cancelled) setEnabled(data.automaticAiReviewEnabled === true);
    }).catch(caught => { if (!cancelled) setError(caught.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/extraction-queue", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ automaticAiReviewEnabled: !enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "AI 复核设置保存失败");
      setEnabled(data.automaticAiReviewEnabled === true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "AI 复核设置保存失败"); }
    finally { setBusy(false); }
  }

  return <div className="wb-ai-review-setting">
    <button type="button" role="switch" aria-label="独立 AI 复核" aria-checked={enabled} disabled={busy}
      className="wb-button" title="默认关闭；保存后用于之后开始的识别及编辑后的自动复核，不改变正在识别的试卷。"
      onClick={() => void toggle()}>
      <span className="wb-toggle-track" aria-hidden="true"><i /></span>独立 AI 复核：{enabled ? "开启" : "关闭"}
    </button>
    {error && <small className="wb-field-error" role="alert">{error}</small>}
  </div>;
}

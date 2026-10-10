"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="zh-CN"><body style={{ margin: 0, fontFamily: "system-ui", background: "#f6f7f9", color: "#243047" }}>
      <main style={{ maxWidth: 560, margin: "15vh auto", padding: 32, background: "white", borderRadius: 16 }}>
        <h1>工作台暂时无法加载</h1>
        <p>服务可能正在启动或恢复。已保存的试卷和任务会保留，稍后可以重新加载。</p>
        <button onClick={() => reset()} style={{ padding: "10px 20px", cursor: "pointer" }}>重新加载</button>
      </main>
    </body></html>
  );
}

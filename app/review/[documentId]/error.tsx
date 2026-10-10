"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ReviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("审核页加载失败", error); }, [error]);

  return (
    <div className="page-shell">
      <section className="card extraction-empty">
        <div className="empty-progress-panel">
          <h1>审核页暂时无法加载</h1>
          <p>请重试加载，或返回工作台查看试卷状态。已保存的题目仍保留在题库中。</p>
          <div className="header-actions">
            <button type="button" className="btn btn-primary" onClick={reset}>重试加载</button>
            <Link href="/" className="btn">返回工作台</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

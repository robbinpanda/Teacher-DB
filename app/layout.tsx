import { scopeFromCookieHeader } from "../lib/education-scope";
import type { Metadata } from "next";
import { headers } from "next/headers";
import "katex/dist/katex.min.css";
import { AppShell } from "../components/AppShell";
import { RuntimeDiagnostics } from "../components/RuntimeDiagnostics";
import { getTeacherMode } from "../lib/backend-data";
import "./globals.css";
import "./resource-management.css";
import "./workbench.css";
import "./select-controls.css";
import "./studio.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL || "http://localhost:3050"),
  title: "拣题 · 教师题库助手",
  description: "把 PDF 试卷转换为可审核、可检索、可组卷的结构化题库。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "拣题 · 教师题库助手",
    description: "上传试卷，自动识题，审核后进入题库，一键完成组卷。",
    images: ["/og-cover.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const anonymousRemote = process.env.JIANTI_DEPLOYMENT_MODE === "remote" && !requestHeaders.get("authorization") && !requestHeaders.get("cookie")?.includes("jianti-session=");
  const initialMode = anonymousRemote ? "personal" : await getTeacherMode(requestHeaders.get("oai-authenticated-user-id") ?? "local-demo");
  return (
    <html lang="zh-CN">
      <body><RuntimeDiagnostics /><AppShell initialMode={initialMode} initialScope={scopeFromCookieHeader(requestHeaders.get("cookie"))}>
        {process.env.JIANTI_PILOT_COPY === "1" && <aside className="no-print" style={{ padding: "10px 16px", marginBottom: 16, background: "#fff5d6", color: "#664d03", borderRadius: 8 }} aria-label="试用环境说明">试用副本 · 这里的修改独立保存，不会同步到 3050 题库。生成内容须核对后采用。</aside>}
        {children}
      </AppShell></body>
    </html>
  );
}

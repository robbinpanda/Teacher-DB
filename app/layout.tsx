import type { Metadata } from "next";
import { headers } from "next/headers";
import "katex/dist/katex.min.css";
import { AppShell } from "../components/AppShell";
import { getTeacherMode } from "../lib/school-workflow";
import "./globals.css";

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
  const initialMode = await getTeacherMode(requestHeaders.get("oai-authenticated-user-id") ?? "local-demo");
  return (
    <html lang="zh-CN">
      <body><AppShell initialMode={initialMode}>{children}</AppShell></body>
    </html>
  );
}

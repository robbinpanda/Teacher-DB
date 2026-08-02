import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import { AppShell } from "../components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL || "http://localhost:3000"),
  title: "拾题 · 教师题库助手",
  description: "把 PDF、Word 试卷转换为可审核、可检索、可组卷的结构化题库。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "拾题 · 教师题库助手",
    description: "上传试卷，自动识题，审核后进入题库，一键完成组卷。",
    images: ["/og-cover.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}

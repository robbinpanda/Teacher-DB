"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Boxes,
  FilePlus2,
  LayoutDashboard,
  Settings,
  Sparkles,
} from "lucide-react";

const navigation = [
  { href: "/", label: "处理中心", icon: LayoutDashboard },
  { href: "/bank", label: "我的题库", icon: Boxes },
  { href: "/papers/new", label: "智能组卷", icon: FilePlus2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark"><BookOpen size={21} strokeWidth={2.2} /></span>
          <span><strong>拾题</strong><small>教师题库助手</small></span>
        </Link>
        <nav className="side-nav" aria-label="主导航">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" || pathname.startsWith("/review") : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={active ? "active" : ""}>
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-card">
          <Sparkles size={17} />
          <strong>视觉识题引擎</strong>
          <p>页面图像 → 题目 JSON<br />公式、插图与答案一并识别</p>
          <span>演示模式</span>
        </div>
        <div className="sidebar-foot">
          <button type="button"><Settings size={17} /> 模型与存储设置</button>
          <div className="user-row"><span className="avatar">林</span><span><strong>林老师</strong><small>数学教研组</small></span></div>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}


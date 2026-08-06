"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  LibraryBig,
  FilePlus2,
  House,
  SlidersHorizontal,
} from "lucide-react";

const navigation = [
  { href: "/", label: "工作台", icon: House },
  { href: "/bank", label: "题库", icon: LibraryBig },
  { href: "/papers/new", label: "组卷", icon: FilePlus2 },
  { href: "/settings/models", label: "识别设置", icon: SlidersHorizontal },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (/^\/papers\/[^/]+\/print$/.test(pathname)) return <>{children}</>;

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark"><BookOpen size={21} strokeWidth={2.2} /></span>
          <span><strong>拾题</strong><small>试卷工作台</small></span>
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
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}

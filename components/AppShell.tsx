"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { BookOpen, Boxes, FilePlus2, LayoutDashboard, Settings, Sparkles } from "lucide-react";
import { educationStages, subjects, type EducationStage } from "../lib/education-taxonomy";

type EducationScopeValue = {
  subject: string;
  stage: EducationStage;
  setSubject: (value: string) => void;
  setStage: (value: EducationStage) => void;
};

const EducationScopeContext = createContext<EducationScopeValue>({
  subject: "数学",
  stage: "middle",
  setSubject: () => undefined,
  setStage: () => undefined,
});

export function useEducationScope() {
  return useContext(EducationScopeContext);
}

const navigation = [
  { href: "/", label: "处理中心", icon: LayoutDashboard },
  { href: "/bank", label: "我的题库", icon: Boxes },
  { href: "/papers/new", label: "智能组卷", icon: FilePlus2 },
  { href: "/settings/models", label: "模型设置", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [subject, setSubject] = useState("数学");
  const [stage, setStage] = useState<EducationStage>("middle");

  useEffect(() => {
    const savedSubject = window.localStorage.getItem("teacher-db-subject");
    const savedStage = window.localStorage.getItem("teacher-db-stage") as EducationStage | null;
    const frame = window.requestAnimationFrame(() => {
      if (savedSubject && subjects.includes(savedSubject as (typeof subjects)[number])) setSubject(savedSubject);
      if (educationStages.some((item) => item.value === savedStage)) setStage(savedStage!);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const scope = useMemo<EducationScopeValue>(() => ({
    subject,
    stage,
    setSubject: (value) => { setSubject(value); window.localStorage.setItem("teacher-db-subject", value); },
    setStage: (value) => { setStage(value); window.localStorage.setItem("teacher-db-stage", value); },
  }), [stage, subject]);

  if (/^\/papers\/[^/]+\/print$/.test(pathname)) return <>{children}</>;

  return (
    <EducationScopeContext.Provider value={scope}>
      <div className="app-frame">
        <aside className="sidebar">
          <Link href="/" className="brand">
            <span className="brand-mark"><BookOpen size={21} strokeWidth={2.2} /></span>
            <span><strong>拾题</strong><small>教师题库助手</small></span>
          </Link>
          <div className="education-switcher" aria-label="教学范围">
            <span>当前教学范围</span>
            <div>{educationStages.map((item) => <button type="button" key={item.value} className={stage === item.value ? "active" : ""} onClick={() => scope.setStage(item.value)}>{item.label}</button>)}</div>
            <select aria-label="学科" value={subject} onChange={(event) => scope.setSubject(event.target.value)}>
              {subjects.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <nav className="side-nav" aria-label="主导航">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" || pathname.startsWith("/review") : pathname.startsWith(href);
              return <Link key={href} href={href} className={active ? "active" : ""}><Icon size={18} /><span>{label}</span></Link>;
            })}
          </nav>
          <div className="sidebar-card">
            <Sparkles size={17} />
            <strong>受控知识标签</strong>
            <p>模型只会从当前学科、学段的标签库中选择，教师可按需扩充。</p>
            <span>{educationStages.find((item) => item.value === stage)?.label} · {subject}</span>
          </div>
          <div className="sidebar-foot">
            <Link href="/settings/models" className="settings-link"><Settings size={17} /> 模型与存储设置</Link>
            <div className="user-row"><span className="avatar">林</span><span><strong>林老师</strong><small>{subject}教研组</small></span></div>
          </div>
        </aside>
        <main className="app-main">{children}</main>
      </div>
    </EducationScopeContext.Provider>
  );
}

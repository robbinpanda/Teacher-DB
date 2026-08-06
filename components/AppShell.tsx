"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  LibraryBig,
  FilePlus2,
  FolderOpen,
  House,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
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
  { href: "/", label: "工作台", icon: House },
  { href: "/bank", label: "题库", icon: LibraryBig },
  { href: "/papers", label: "试卷库", icon: FolderOpen },
  { href: "/papers/new", label: "组卷", icon: FilePlus2 },
  { href: "/settings/models", label: "识别设置", icon: SlidersHorizontal },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [subject, setSubject] = useState("数学");
  const [stage, setStage] = useState<EducationStage>("middle");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedSubject = window.localStorage.getItem("teacher-db-subject");
    const savedStage = window.localStorage.getItem("teacher-db-stage") as EducationStage | null;
    const frame = window.requestAnimationFrame(() => {
      if (savedSubject && subjects.includes(savedSubject as (typeof subjects)[number])) setSubject(savedSubject);
      if (educationStages.some((item) => item.value === savedStage)) setStage(savedStage!);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!scopeOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setScopeOpen(false);
        setSubjectOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (subjectOpen) setSubjectOpen(false);
      else setScopeOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [scopeOpen, subjectOpen]);

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
            <span><strong>拾题</strong><small>试卷工作台</small></span>
          </Link>
          <div ref={switcherRef} className={`education-switcher${scopeOpen ? " open" : ""}`} aria-label="教学范围">
            <button
              type="button"
              className="scope-trigger"
              aria-expanded={scopeOpen}
              aria-controls="education-scope-settings"
              onClick={() => { setScopeOpen((value) => !value); setSubjectOpen(false); }}
            >
              <span><small>教学范围</small><strong>{educationStages.find((item) => item.value === stage)?.label} · {subject}</strong></span>
              <i><Settings2 size={15} aria-hidden="true" /></i>
            </button>
            {scopeOpen && (
              <div id="education-scope-settings" className="scope-settings">
                <div className="scope-field-heading"><span>学段</span><small>影响题库、导入与组卷范围</small></div>
                <div className="stage-switch" role="group" aria-label="学段">
                  {educationStages.map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      className={stage === item.value ? "active" : ""}
                      aria-pressed={stage === item.value}
                      onClick={() => scope.setStage(item.value)}
                    >{item.label}</button>
                  ))}
                </div>
                <div className={`subject-picker${subjectOpen ? " open" : ""}`}>
                  <span id="subject-picker-label">学科</span>
                  <button
                    type="button"
                    className="subject-trigger"
                    aria-haspopup="listbox"
                    aria-expanded={subjectOpen}
                    aria-labelledby="subject-picker-label subject-current-value"
                    onClick={() => setSubjectOpen((value) => !value)}
                  >
                    <strong id="subject-current-value">{subject}</strong><ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {subjectOpen && (
                    <div className="subject-menu" role="listbox" aria-labelledby="subject-picker-label">
                      {subjects.map((item) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={subject === item}
                          key={item}
                          onClick={() => { scope.setSubject(item); setSubjectOpen(false); }}
                        ><span>{item}</span>{subject === item && <Check size={13} aria-hidden="true" />}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <nav className="side-nav" aria-label="主导航">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = href === "/"
                ? pathname === "/" || pathname.startsWith("/review")
                : href === "/papers/new"
                  ? pathname === href
                  : href === "/papers"
                    ? pathname === "/papers" || (/^\/papers\/[^/]+$/.test(pathname) && pathname !== "/papers/new")
                    : pathname.startsWith(href);
              return <Link key={href} href={href} className={active ? "active" : ""}><Icon size={18} /><span>{label}</span></Link>;
            })}
          </nav>
        </aside>
        <main className="app-main">{children}</main>
      </div>
    </EducationScopeContext.Provider>
  );
}

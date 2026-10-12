"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronRight, FilePlus2, FileText, Files, Folder, FolderPlus, Inbox, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { stageLabel } from "../lib/education-taxonomy";
import type { PaperFolderRecord, PaperLibraryRecord } from "../lib/paper-library";
import { useTeacherMode } from "./AppShell";

type RenameTarget = { kind: "folder" | "paper" | "uploaded"; id: string; name: string } | null;
type SortMode = "updated" | "name" | "questions";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function PaperLibrary({ initialFolders, initialPapers, requestedFolderId }: { initialFolders: PaperFolderRecord[]; initialPapers: PaperLibraryRecord[]; requestedFolderId: string | null }) {
  const router = useRouter();
  const { mode } = useTeacherMode();
  const [folders, setFolders] = useState(initialFolders);
  const [papers, setPapers] = useState(initialPapers);
  const [previousPapers, setPreviousPapers] = useState(initialPapers);
  if (previousPapers !== initialPapers) {
    setPreviousPapers(initialPapers);
    setPapers(initialPapers);
    setFolders(initialFolders);
  }
  const [search, setSearch] = useState("");
  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [kind, setKind] = useState<"all" | "uploaded" | "assembled">("all");
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestedFolder = requestedFolderId && requestedFolderId !== "root" ? folders.find((folder) => folder.id === requestedFolderId) : undefined;
  const allPapersView = !requestedFolderId || (!!requestedFolderId && requestedFolderId !== "root" && !requestedFolder);
  const rootView = requestedFolderId === "root";
  const currentFolderId = requestedFolder?.id ?? null;
  const currentFolder = requestedFolder;
  const createParent = createParentId ? folders.find((folder) => folder.id === createParentId) : undefined;

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCreateParentId(undefined);
      setRenameTarget(null);
      setOpenMenu(null);
      setError("");
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const breadcrumbs = useMemo(() => {
    const path: PaperFolderRecord[] = [];
    let cursor = currentFolder;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      path.unshift(cursor);
      cursor = folders.find((folder) => folder.id === cursor?.parentId);
    }
    return path;
  }, [currentFolder, folders]);

  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const locationFolders = allPapersView ? [] : folders.filter((folder) => folder.parentId === currentFolderId);
  const locationPapers = allPapersView ? papers : papers.filter((paper) => paper.folderId === currentFolderId);
  const visibleFolders = (normalizedSearch
    ? folders.filter((folder) => `${folderPath(folder)} ${folder.name}`.toLocaleLowerCase("zh-CN").includes(normalizedSearch))
    : locationFolders).toSorted((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const visiblePapers = locationPapers.filter((paper) => (kind === "all" || paper.kind === kind)
    && `${paper.title} ${paper.subtitle} ${paper.subject} ${paper.grade}`.toLocaleLowerCase("zh-CN").includes(normalizedSearch))
    .toSorted((left, right) => sortMode === "name" ? left.title.localeCompare(right.title, "zh-CN")
      : sortMode === "questions" ? right.questionCount - left.questionCount : Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  }
  function apiPath(paper: PaperLibraryRecord) { return `/api/${paper.kind === "uploaded" ? "documents" : "papers"}/${paper.id}`; }
  function paperKey(paper: PaperLibraryRecord) { return `${paper.kind}:${paper.id}`; }
  const statusLabels: Record<string, string> = { uploading: "上传中", awaiting_model: "待识别", extracting: "识别中", reviewing: "待审核", failed: "识别失败", complete: "已入库", saved: "已保存" };

  function openFolder(folderId: string | null) {
    setSearch("");
    setOpenMenu(null);
    router.push(folderId ? `/papers?folder=${encodeURIComponent(folderId)}` : "/papers?folder=root");
  }

  function openAllPapers() {
    setSearch("");
    setOpenMenu(null);
    router.push("/papers");
  }

  function beginCreateFolder(parentId: string | null) {
    setCreateParentId(parentId);
    setNewFolderName("");
    setError("");
  }

  function closeCreateFolder() {
    setCreateParentId(undefined);
    setNewFolderName("");
    setError("");
  }

  function closeRename() {
    setRenameTarget(null);
    setRenameValue("");
    setError("");
  }

  async function createFolder() {
    if (createParentId === undefined) return;
    const response = await fetch("/api/paper-folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newFolderName, parentId: createParentId }) });
    const result = await response.json().catch(() => ({})) as { folder?: PaperFolderRecord; error?: string };
    if (!response.ok || !result.folder) { setError(result.error ?? "无法创建文件夹"); return; }
    setFolders((items) => [...items, result.folder!]); setNewFolderName(""); setCreateParentId(undefined); setError(""); router.refresh();
  }

  async function renameItem() {
    if (!renameTarget) return;
    const url = renameTarget.kind === "folder" ? `/api/paper-folders/${renameTarget.id}` : `/api/${renameTarget.kind === "uploaded" ? "documents" : "papers"}/${renameTarget.id}`;
    const response = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [renameTarget.kind !== "paper" ? "name" : "title"]: renameValue }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "重命名失败"); return; }
    if (renameTarget.kind === "folder") setFolders((items) => items.map((item) => item.id === renameTarget.id ? { ...item, name: renameValue.trim() } : item));
    else setPapers((items) => items.map((item) => item.id === renameTarget.id && item.kind === (renameTarget.kind === "paper" ? "assembled" : "uploaded") ? { ...item, title: renameValue.trim() } : item));
    setRenameTarget(null); setOpenMenu(null); setError(""); router.refresh();
  }

  async function movePaper(paper: PaperLibraryRecord, folderId: string | null) {
    const response = await fetch(apiPath(paper), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [paper.kind === "uploaded" ? "paperFolderId" : "folderId"]: folderId }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "移动失败"); return; }
    setPapers((items) => items.map((item) => paperKey(item) === paperKey(paper) ? { ...item, folderId } : item)); setOpenMenu(null); setError(""); router.refresh();
  }

  async function removeFolder(folder: PaperFolderRecord) {
    if (!window.confirm(`删除空文件夹“${folder.name}”？`)) return;
    const response = await fetch(`/api/paper-folders/${folder.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "删除失败"); return; }
    setFolders((items) => items.filter((item) => item.id !== folder.id)); setOpenMenu(null); setError(""); router.refresh();
  }

  async function removePaper(paper: PaperLibraryRecord) {
    if (!window.confirm(paper.kind === "uploaded" ? `删除“${paper.title}”的原始文件？保留已入库题目及组卷引用；原文件删除后无法恢复。` : `删除组卷作品“${paper.title}”？此操作不会删除题库中的题目。`)) return;
    const response = await fetch(apiPath(paper), { method: "DELETE", headers: { "content-type": "application/json" }, body: paper.kind === "uploaded" ? JSON.stringify({ mode: "source_only" }) : undefined });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "删除失败"); return; }
    setPapers((items) => paper.kind === "uploaded" ? items.map((item) => paperKey(item) === paperKey(paper) ? { ...item, sourceRemoved: true, originalUrl: null } : item) : items.filter((item) => paperKey(item) !== paperKey(paper))); setOpenMenu(null); setError(""); router.refresh();
  }

  function beginRename(target: NonNullable<RenameTarget>) {
    setRenameTarget(target); setRenameValue(target.name); setOpenMenu(null); setError("");
  }

  function folderPath(folder: PaperFolderRecord) {
    const names = [folder.name];
    let parent = folders.find((item) => item.id === folder.parentId);
    const visited = new Set([folder.id]);
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id); names.unshift(parent.name); parent = folders.find((item) => item.id === parent?.parentId);
    }
    return names.join(" / ");
  }

  function treeChildren(parentId: string | null, depth = 0): React.ReactNode {
    return folders.filter((folder) => folder.parentId === parentId).map((folder) => {
      const itemCount = folders.filter((item) => item.parentId === folder.id).length + papers.filter((paper) => paper.folderId === folder.id).length;
      return <div key={folder.id}><button type="button" className={folder.id === currentFolderId ? "active" : ""} style={{ paddingLeft: `${10 + depth * 13}px` }} onClick={() => openFolder(folder.id)}><Folder size={13} /><span>{folder.name}</span><b>{itemCount}</b></button>{treeChildren(folder.id, depth + 1)}</div>;
    });
  }

  function menuToggle(key: string, open: boolean) {
    if (open) setOpenMenu(key);
    else setOpenMenu((current) => current === key ? null : current);
  }

  return <div className="paper-library-page">
    <header className="paper-library-header"><div><h1>试卷库</h1><p>统一管理上传原卷与组卷作品，保留题目来源与可编辑版式。</p></div><div className="resource-actions"><Link href="/?import=1" className="btn">上传原卷</Link><Link href="/papers/new" className="btn btn-primary"><FilePlus2 size={15} /> 新建组卷</Link></div></header>
    <div className="resource-tabs" role="tablist" aria-label="试卷类型">{([['all', '全部试卷'], ['uploaded', '上传原卷'], ['assembled', '组卷作品']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={kind === value} onClick={() => { setKind(value); setOpenMenu(null); }}>{label}<span>{papers.filter(p => value === 'all' || p.kind === value).length}</span></button>)}<button className="resource-folder-toggle" aria-expanded={foldersOpen} onClick={() => setFoldersOpen(!foldersOpen)}><Folder size={15} /> 文件夹管理</button></div>
    <div className={`paper-library-shell asset-library${foldersOpen || !allPapersView ? " with-folders" : ""}`}>
      {(foldersOpen || !allPapersView) && <aside className="paper-folder-tree">
        <button type="button" className={allPapersView ? "active" : ""} onClick={openAllPapers}><Files size={14} /><span>所有文件夹</span></button>
        <button type="button" className={rootView ? "active" : ""} onClick={() => openFolder(null)}><Inbox size={14} /><span>未分文件夹</span></button>
        <div className="paper-folder-heading paper-folder-heading-spaced"><strong>我的文件夹</strong><button type="button" aria-label="新建主文件夹" onClick={() => beginCreateFolder(null)}><Plus size={14} /></button></div>
        {treeChildren(null)}
      </aside>}
      <main className="paper-library-main">
        <div className="paper-library-toolbar">
          <nav className="paper-breadcrumbs" aria-label="当前位置">
            {allPapersView ? <button type="button" onClick={openAllPapers}>全部试卷</button> : rootView ? <button type="button" onClick={() => openFolder(null)}>未分文件夹</button> : <><button type="button" onClick={openAllPapers}>试卷库</button>{breadcrumbs.map((folder) => <span key={folder.id}><ChevronRight size={12} /><button type="button" onClick={() => openFolder(folder.id)}>{folder.name}</button></span>)}</>}
          </nav>
          <div className="paper-library-controls">
            <label className="paper-library-search"><Search size={13} /><input aria-label="搜索当前范围试卷" placeholder="搜索试卷名称、学科…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <select aria-label="试卷排序" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="updated">最近更新</option><option value="name">按名称</option><option value="questions">题目最多</option></select>

            {!allPapersView && <button type="button" className="btn btn-small" onClick={() => beginCreateFolder(currentFolderId)}><FolderPlus size={14} /> {currentFolderId ? "新建子文件夹" : "新建文件夹"}</button>}
          </div>
        </div>
        {error && createParentId === undefined && !renameTarget && <p className="paper-library-error">{error}</p>}
        <div className="paper-library-summary"><strong>{normalizedSearch ? `搜索“${search.trim()}”` : allPapersView ? "全部试卷" : rootView ? "未分文件夹" : currentFolder?.name}</strong><span>{visibleFolders.length ? `${visibleFolders.length} 个文件夹 · ` : ""}{visiblePapers.length} 份试卷</span></div>
        {visibleFolders.length > 0 && <div className="asset-folders">{visibleFolders.map(folder => <div key={folder.id}><button className="btn" onClick={() => openFolder(folder.id)}><Folder size={15} /> {folder.name}</button><button className="btn btn-small" aria-label={`重命名${folder.name}`} onClick={() => beginRename({ kind: "folder", id: folder.id, name: folder.name })}><Pencil size={13} /></button><button className="btn btn-small" aria-label={`删除空文件夹${folder.name}`} disabled={busy} onClick={() => void run(() => removeFolder(folder))}><Trash2 size={13} /></button></div>)}</div>}
        <div className="asset-table-scroll"><table className="asset-table"><thead><tr><th>试卷名称</th><th>类型</th><th>学科 / 年级</th><th>题量</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
          {visiblePapers.map(paper => {
            const menuKey = paperKey(paper);
            const uploaded = paper.kind === "uploaded";
            const editUrl = uploaded ? `/review/${paper.id}` : `/papers/${paper.id}`;
            return <tr key={menuKey} data-kind={paper.kind}>
              <td><Link className="asset-title" href={uploaded && paper.sourceRemoved ? `/bank?documentId=${paper.id}` : editUrl}>{paper.title}</Link><small>{paper.sourceRemoved ? "原文件已删除 · 保留题目来源" : statusLabels[paper.status] ?? paper.status}{paper.subtitle ? ` · ${paper.subtitle}` : ""}</small></td>
              <td><span className="resource-badge">{uploaded ? "上传原卷" : "组卷作品"}</span></td>
              <td>{[paper.subject, paper.grade || (paper.stage ? stageLabel(paper.stage as "primary" | "middle" | "high") : "")].filter(Boolean).join(" · ") || "未设置"}</td>
              <td>{paper.questionCount} 题{uploaded && paper.questionCount > paper.approvedCount && <small>{paper.approvedCount} 题已入库</small>}</td><td><time dateTime={paper.updatedAt}>{formatTime(paper.updatedAt)}</time></td>
              <td><div className="asset-row-actions">{uploaded ? paper.sourceRemoved ? <Link href={`/bank?documentId=${paper.id}`}>查看题目</Link> : <Link href={editUrl}>{paper.status === "reviewing" ? "继续审核" : "查看识别结果"}</Link> : <Link href={editUrl}>继续编辑</Link>}
                <details className="asset-menu" open={openMenu === menuKey} onToggle={event => menuToggle(menuKey, event.currentTarget.open)}><summary aria-label={`${paper.title} 操作`}><MoreHorizontal size={18} /></summary><div>
                  {uploaded ? <>{paper.originalUrl && <a href={paper.originalUrl} target="_blank" rel="noreferrer">查看原始试卷</a>}{!paper.sourceRemoved && <Link href={editUrl}>查看识别结果 / 审核</Link>}{paper.approvedCount > 0 && <Link href={`/bank?documentId=${paper.id}`}>进入相关题目</Link>}</> : <><Link href={`/papers/${paper.id}/preview`} target="_blank">预览试卷</Link><a href={`/api/papers/${paper.id}/pdf`}>下载试卷 PDF</a><a href={`/api/papers/${paper.id}/pdf?answers=1`}>下载答案解析</a>{mode === "school" && <Link href={`/assignments/new?paper=${paper.id}`}><CalendarPlus size={13} /> 布置作业</Link>}</>}
                  <button onClick={() => beginRename({ kind: uploaded ? "uploaded" : "paper", id: paper.id, name: paper.title })}>重命名</button>
                  <label>移动到文件夹<select aria-label={`移动${paper.title}`} disabled={busy} value={paper.folderId ?? ""} onChange={event => void run(() => movePaper(paper, event.target.value || null))}><option value="">未分文件夹</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder)}</option>)}</select></label>
                  {(!uploaded || !paper.sourceRemoved) && <button className="danger" disabled={busy} onClick={() => void run(() => removePaper(paper))}>{uploaded ? "删除原文件（保留题目）" : "删除组卷作品"}</button>}
                </div></details></div></td>
            </tr>;
          })}
        </tbody></table></div>
        {!visiblePapers.length && <div className="paper-library-empty"><FileText size={28} /><h2>{normalizedSearch ? "没有匹配的试卷" : !allPapersView ? "当前文件夹没有此类试卷" : kind === "uploaded" ? "还没有上传原卷" : kind === "assembled" ? "还没有组卷作品" : "还没有试卷资产"}</h2><p>{normalizedSearch ? "试试其他名称，或清空搜索条件。" : "上传原卷后可识别入库；从题库选题组卷并保存后，可在这里继续编辑。"}</p>{normalizedSearch ? <button className="btn" onClick={() => setSearch("")}>清空搜索</button> : <Link href={kind === "uploaded" ? "/?import=1" : "/papers/new"} className="btn">{kind === "uploaded" ? "上传原卷" : "新建组卷"}</Link>}</div>}

      </main>
    </div>
    {createParentId !== undefined && <div className="paper-library-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreateFolder(); }}><form role="dialog" aria-modal="true" aria-labelledby="create-folder-title" onSubmit={(event) => { event.preventDefault(); void run(createFolder); }}><span className="paper-library-modal-icon"><FolderPlus size={18} /></span><h2 id="create-folder-title">{createParentId ? "新建子文件夹" : "新建主文件夹"}</h2><p>{createParentId ? `创建位置：试卷库 / ${createParent ? folderPath(createParent) : "当前文件夹"}` : "创建位置：试卷库未分文件夹"}</p><label><span>文件夹名称</span><input autoFocus placeholder="例如：2026 二模" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} /></label>{error && <p className="paper-library-modal-error">{error}</p>}<div><button type="button" className="btn" onClick={closeCreateFolder}>取消</button><button type="submit" className="btn btn-primary" disabled={busy || !newFolderName.trim()}>创建</button></div></form></div>}
    {renameTarget && <div className="paper-library-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRename(); }}><form role="dialog" aria-modal="true" aria-labelledby="rename-title" onSubmit={(event) => { event.preventDefault(); void run(renameItem); }}><h2 id="rename-title">重命名{renameTarget.kind === "folder" ? "文件夹" : "试卷"}</h2><label><span>新名称</span><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></label>{error && <p className="paper-library-modal-error">{error}</p>}<div><button type="button" className="btn" onClick={closeRename}>取消</button><button type="submit" className="btn btn-primary" disabled={busy || !renameValue.trim()}>保存</button></div></form></div>}
  </div>;
}

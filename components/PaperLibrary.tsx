"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronRight, FilePlus2, FileText, Files, Folder, FolderPlus, Inbox, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { stageLabel } from "../lib/education-taxonomy";
import type { PaperFolderRecord, PaperLibraryRecord } from "../lib/paper-library";
import { SelectionCheckbox } from "./SelectionCheckbox";
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
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const selectionScope = JSON.stringify([requestedFolderId, search, kind, sortMode]);
  const [previousScope, setPreviousScope] = useState(selectionScope);
  if (previousScope !== selectionScope) {
    setPreviousScope(selectionScope);
    setSelectedKeys([]);
    setNotice("");
  }
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

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    const closeOutsideMenu = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".asset-menu")) close();
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", closeOutsideMenu, true);
    document.addEventListener("pointerdown", closeOutsideMenu);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", closeOutsideMenu, true);
      document.removeEventListener("pointerdown", closeOutsideMenu);
    };
  }, [openMenu]);

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

  const selectedPapers = visiblePapers.filter(paper => selectedKeys.includes(paperKey(paper)));
  const allSelected = visiblePapers.length > 0 && selectedPapers.length === visiblePapers.length;
  const canDeleteSelection = selectedPapers.length > 0 && selectedPapers.every(paper => paper.kind === "assembled" || !paper.sourceRemoved);

  function togglePaper(paper: PaperLibraryRecord) {
    const key = paperKey(paper);
    setSelectedKeys(items => items.includes(key) ? items.filter(item => item !== key) : [...items, key]);
  }

  async function batchManage(action: "move" | "delete", folderId: string | null = null) {
    if (busy || !selectedPapers.length || (action === "delete" && !canDeleteSelection)) return;
    const uploads = selectedPapers.filter(paper => paper.kind === "uploaded").length;
    if (action === "delete" && !window.confirm(`确定批量删除已选 ${selectedPapers.length} 份资源？\n上传原卷 ${uploads} 份：只删除原文件，保留题目、来源记录及组卷引用。\n组卷作品 ${selectedPapers.length - uploads} 份：删除作品，保留题库题目。\n此操作无法撤销。`)) return;
    setNotice("");
    await run(async () => {
      const succeeded = new Set<string>();
      const failures: string[] = [];
      // Existing endpoints are not a cross-resource transaction: retain failed selections for retry.
      for (const paper of selectedPapers) {
        try {
          const response = await fetch(apiPath(paper), {
            method: action === "move" ? "PATCH" : "DELETE",
            headers: { "content-type": "application/json" },
            body: action === "move" ? JSON.stringify({ [paper.kind === "uploaded" ? "paperFolderId" : "folderId"]: folderId })
              : paper.kind === "uploaded" ? JSON.stringify({ mode: "source_only" }) : JSON.stringify({}),
          });
          const result = await response.json().catch(() => ({})) as { error?: string };
          if (!response.ok) throw new Error(result.error ?? "操作失败");
          succeeded.add(paperKey(paper));
        } catch (caught) { failures.push(`${paper.title}：${caught instanceof Error ? caught.message : "请求失败"}`); }
      }
      setPapers(items => items.flatMap(paper => !succeeded.has(paperKey(paper)) ? [paper]
        : action === "move" ? [{ ...paper, folderId }]
          : paper.kind === "uploaded" ? [{ ...paper, sourceRemoved: true, originalUrl: null }] : []));
      setSelectedKeys(items => items.filter(key => !succeeded.has(key)));
      setNotice(`已${action === "move" ? "移动" : "删除"} ${succeeded.size} 份${failures.length ? `，${failures.length} 份失败，保留选择可重试` : ""}${action === "delete" && uploads ? "；原卷来源记录和题目已保留" : ""}`);
      setError(failures.join("；"));
      setOpenMenu(null);
      router.refresh();
    });
  }

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
    if (busy) return;
    setSelectedKeys([]);
    setSearch("");
    setOpenMenu(null);
    router.push(folderId ? `/papers?folder=${encodeURIComponent(folderId)}` : "/papers?folder=root");
  }

  function openAllPapers() {
    if (busy) return;
    setSelectedKeys([]);
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
    setSelectedKeys([]);
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
    const response = await fetch(apiPath(paper), { method: "DELETE", headers: { "content-type": "application/json" }, body: paper.kind === "uploaded" ? JSON.stringify({ mode: "source_only" }) : JSON.stringify({}) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "删除失败"); return; }
    setSelectedKeys(items => items.filter(key => key !== paperKey(paper)));
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

  function menuToggle(key: string, details: HTMLDetailsElement) {
    if (details.open) {
      const menu = details.querySelector<HTMLDivElement>(":scope > div");
      if (menu) {
        const anchor = details.getBoundingClientRect();
        const bounds = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12))}px`;
        menu.style.top = `${Math.max(12, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 12))}px`;
      }
      setOpenMenu(key);
    }
    else setOpenMenu((current) => current === key ? null : current);
  }

  return <div className="paper-library-page">
    <header className="paper-library-header"><div><h1>试卷库</h1><p>收藏每一份原卷，打磨每一份作品。</p></div><div className="resource-actions"><Link href="/?import=1" className="btn"><FileText size={16} />上传原卷</Link><Link href="/papers/new" className="btn btn-primary"><Plus size={17} /> 新建组卷</Link></div></header>
    <div className="resource-tabs" role="tablist" aria-label="试卷类型">{([['all', '全部试卷'], ['uploaded', '上传原卷'], ['assembled', '组卷作品']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={kind === value} disabled={busy} onClick={() => { setKind(value); setOpenMenu(null); }}>{label}<span>{papers.filter(p => value === 'all' || p.kind === value).length}</span></button>)}<button className="resource-folder-toggle" aria-expanded={foldersOpen} onClick={() => setFoldersOpen(!foldersOpen)}><Folder size={15} /> 文件夹管理</button></div>
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
            {allPapersView ? <strong>{kind === "uploaded" ? "上传原卷" : kind === "assembled" ? "组卷作品" : "全部试卷"}</strong> : rootView ? <button type="button" onClick={() => openFolder(null)}>未分文件夹</button> : <><button type="button" onClick={openAllPapers}>试卷库</button>{breadcrumbs.map((folder) => <span key={folder.id}><ChevronRight size={12} /><button type="button" onClick={() => openFolder(folder.id)}>{folder.name}</button></span>)}</>}
            <span className="asset-result-count">{visiblePapers.length} 份{normalizedSearch ? "匹配" : ""}</span>
          </nav>
          <div className="paper-library-controls">
            <label className="paper-library-search"><Search size={13} /><input aria-label="搜索当前范围试卷" placeholder="搜索试卷名称、学科…" disabled={busy} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <select aria-label="试卷排序" disabled={busy} value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="updated">最近更新</option><option value="name">按名称</option><option value="questions">题目最多</option></select>

            {!allPapersView && <button type="button" className="btn btn-small" onClick={() => beginCreateFolder(currentFolderId)}><FolderPlus size={14} /> {currentFolderId ? "新建子文件夹" : "新建文件夹"}</button>}
          </div>
        </div>
        {error && createParentId === undefined && !renameTarget && <p className="paper-library-error">{error}</p>}
        {visibleFolders.length > 0 && <div className="asset-folders">{visibleFolders.map(folder => <div key={folder.id}><button className="btn" onClick={() => openFolder(folder.id)}><Folder size={15} /> {folder.name}</button><button className="btn btn-small" aria-label={`重命名${folder.name}`} onClick={() => beginRename({ kind: "folder", id: folder.id, name: folder.name })}><Pencil size={13} /></button><button className="btn btn-small" aria-label={`删除空文件夹${folder.name}`} disabled={busy} onClick={() => void run(() => removeFolder(folder))}><Trash2 size={13} /></button></div>)}</div>}
        <p className="resource-selection-hint">全选范围：当前筛选结果 · 切换类型、文件夹、搜索或排序会清空选择</p>
        {notice && <p className="resource-operation-notice" role="status">{notice}</p>}
        {selectedPapers.length > 0 && <div className="resource-bulkbar" role="region" aria-label="试卷批量操作" aria-busy={busy}>
          <strong>已选 {selectedPapers.length} 份</strong>
          <label>移动到<select aria-label="批量移动试卷" value="" disabled={busy} onChange={event => { if (event.target.value) void batchManage("move", event.target.value === "unfiled" ? null : event.target.value); }}><option value="" disabled>选择文件夹</option><option value="unfiled">未分文件夹</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder)}</option>)}</select></label>
          <button className="btn resource-danger" disabled={busy || !canDeleteSelection} onClick={() => void batchManage("delete")}><Trash2 size={14} />批量删除</button>
          <button className="btn" disabled={busy} onClick={() => setSelectedKeys([])}>取消选择</button>
          {!canDeleteSelection && <span>包含已删除原文件的记录，请取消选择该记录后删除</span>}
          {busy && <span role="status">正在处理，请稍候…</span>}
        </div>}
        <div className="asset-table-scroll"><table className="asset-table"><thead><tr><th className="asset-selection"><SelectionCheckbox label="全选当前筛选结果" checked={allSelected} indeterminate={selectedPapers.length > 0 && !allSelected} disabled={busy || !visiblePapers.length} onChange={() => setSelectedKeys(allSelected ? [] : visiblePapers.map(paperKey))} /></th><th className="asset-name-column">试卷名称</th><th>类型</th><th>学科 / 年级</th><th>题量</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
          {visiblePapers.map(paper => {
            const menuKey = paperKey(paper);
            const uploaded = paper.kind === "uploaded";
            const editUrl = uploaded ? `/review/${paper.id}` : `/papers/${paper.id}`;
            const previewUrl = uploaded ? `/papers/uploaded/${paper.id}` : `/papers/${paper.id}/preview`;
            const status = paper.sourceRemoved ? "原文件已删除" : !uploaded && paper.questionCount === 0 ? "空白草稿" : statusLabels[paper.status] ?? paper.status;
            return <tr key={menuKey} data-kind={paper.kind} aria-selected={selectedKeys.includes(menuKey)}>
              <td className="asset-selection"><SelectionCheckbox label={`选择试卷 ${paper.title}`} checked={selectedKeys.includes(menuKey)} disabled={busy} onChange={() => togglePaper(paper)} /></td>
              <td className="asset-name-column"><div className="asset-identity"><span className={`asset-type-icon ${paper.kind}`} aria-hidden="true">{uploaded ? <FileText size={21} strokeWidth={1.7} /> : <FilePlus2 size={21} strokeWidth={1.7} />}</span><div><Link className="asset-title" title={paper.title} href={previewUrl}>{paper.title}</Link><small title={paper.subtitle}>{paper.sourceRemoved ? "原文件已删除 · 可查看处理后的试卷" : paper.subtitle || (uploaded ? "查看处理后的试卷" : "可继续编排与导出")}</small></div></div></td>
              <td><span className="resource-badge">{uploaded ? "上传原卷" : "组卷作品"}</span></td>
              <td>{[paper.subject, paper.grade || (paper.stage ? stageLabel(paper.stage as "primary" | "middle" | "high") : "")].filter(Boolean).join(" · ") || "未设置"}</td>
              <td>{paper.questionCount} 题{uploaded && paper.questionCount > paper.approvedCount && <small>{paper.approvedCount} 题已入库</small>}</td><td><span className="asset-status">{status}</span></td><td><time dateTime={paper.updatedAt}>{formatTime(paper.updatedAt)}</time></td>
              <td><div className="asset-row-actions">{uploaded ? <Link href={previewUrl}>查看试卷</Link> : <Link href={editUrl}>继续编辑</Link>}
                <details className="asset-menu" open={openMenu === menuKey} onToggle={event => menuToggle(menuKey, event.currentTarget)}><summary aria-label={`${paper.title} 操作`}><MoreHorizontal size={18} /></summary><div>
                  {uploaded ? <>{paper.originalUrl && <a href={paper.originalUrl} target="_blank" rel="noreferrer">查看原始试卷</a>}{!paper.sourceRemoved && <Link href={editUrl}>查看识别结果 / 审核</Link>}{paper.approvedCount > 0 && <Link href={`/bank?documentId=${paper.id}`}>进入相关题目</Link>}</> : <><Link href={`/papers/${paper.id}/preview`} target="_blank">预览试卷</Link><a href={`/api/papers/${paper.id}/pdf`}>下载试卷 PDF</a><a href={`/api/papers/${paper.id}/pdf?answers=1`}>下载答案解析</a>{mode === "school" && <Link href={`/assignments/new?paper=${paper.id}`}><CalendarPlus size={13} /> 布置作业</Link>}</>}
                  <button disabled={busy} onClick={() => beginRename({ kind: uploaded ? "uploaded" : "paper", id: paper.id, name: paper.title })}>重命名</button>
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

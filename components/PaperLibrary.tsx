"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { stageLabel } from "../lib/education-taxonomy";
import type { PaperFolderRecord, PaperLibraryRecord } from "../lib/paper-library";

type RenameTarget = { kind: "folder" | "paper"; id: string; name: string } | null;

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function PaperLibrary({ initialFolders, initialPapers, requestedFolderId }: { initialFolders: PaperFolderRecord[]; initialPapers: PaperLibraryRecord[]; requestedFolderId: string | null }) {
  const router = useRouter();
  const [folders, setFolders] = useState(initialFolders);
  const [papers, setPapers] = useState(initialPapers);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState("");
  const currentFolderId = requestedFolderId && folders.some((folder) => folder.id === requestedFolderId) ? requestedFolderId : null;
  const currentFolder = folders.find((folder) => folder.id === currentFolderId);

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

  const visibleFolders = folders.filter((folder) => folder.parentId === currentFolderId && (!search || folder.name.toLowerCase().includes(search.toLowerCase())));
  const visiblePapers = papers.filter((paper) => paper.folderId === currentFolderId && (!search || paper.title.toLowerCase().includes(search.toLowerCase())));

  function openFolder(folderId: string | null) {
    router.push(folderId ? `/papers?folder=${encodeURIComponent(folderId)}` : "/papers");
  }

  async function createFolder() {
    const response = await fetch("/api/paper-folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newFolderName, parentId: currentFolderId }) });
    const result = await response.json().catch(() => ({})) as { folder?: PaperFolderRecord; error?: string };
    if (!response.ok || !result.folder) { setError(result.error ?? "无法创建文件夹"); return; }
    setFolders((items) => [...items, result.folder!]); setNewFolderName(""); setCreating(false); setError(""); router.refresh();
  }

  async function renameItem() {
    if (!renameTarget) return;
    const url = renameTarget.kind === "folder" ? `/api/paper-folders/${renameTarget.id}` : `/api/papers/${renameTarget.id}`;
    const response = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [renameTarget.kind === "folder" ? "name" : "title"]: renameValue }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "重命名失败"); return; }
    if (renameTarget.kind === "folder") setFolders((items) => items.map((item) => item.id === renameTarget.id ? { ...item, name: renameValue.trim() } : item));
    else setPapers((items) => items.map((item) => item.id === renameTarget.id ? { ...item, title: renameValue.trim() } : item));
    setRenameTarget(null); setError(""); router.refresh();
  }

  async function movePaper(paperId: string, folderId: string | null) {
    const response = await fetch(`/api/papers/${paperId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ folderId }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "移动失败"); return; }
    setPapers((items) => items.map((item) => item.id === paperId ? { ...item, folderId } : item)); setError(""); router.refresh();
  }

  async function removeFolder(folder: PaperFolderRecord) {
    if (!window.confirm(`删除空文件夹“${folder.name}”？`)) return;
    const response = await fetch(`/api/paper-folders/${folder.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "删除失败"); return; }
    setFolders((items) => items.filter((item) => item.id !== folder.id)); setError(""); router.refresh();
  }

  async function removePaper(paper: PaperLibraryRecord) {
    if (!window.confirm(`删除试卷“${paper.title}”？此操作不会删除题库中的题目。`)) return;
    const response = await fetch(`/api/papers/${paper.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "删除失败"); return; }
    setPapers((items) => items.filter((item) => item.id !== paper.id)); setError(""); router.refresh();
  }

  function beginRename(target: NonNullable<RenameTarget>) {
    setRenameTarget(target); setRenameValue(target.name); setError("");
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
    return folders.filter((folder) => folder.parentId === parentId).map((folder) => <div key={folder.id}><button type="button" className={folder.id === currentFolderId ? "active" : ""} style={{ paddingLeft: `${10 + depth * 13}px` }} onClick={() => openFolder(folder.id)}><Folder size={13} /><span>{folder.name}</span></button>{treeChildren(folder.id, depth + 1)}</div>);
  }

  return <div className="paper-library-page">
    <header className="paper-library-header"><div><h1>试卷库</h1><p>组卷与打印的试卷会自动保存在这里，可像文件一样归档整理。</p></div><Link href="/papers/new" className="btn btn-primary"><FilePlus2 size={15} /> 新建试卷</Link></header>
    <div className="paper-library-shell">
      <aside className="paper-folder-tree"><strong>文件夹</strong><button type="button" className={currentFolderId ? "" : "active"} onClick={() => openFolder(null)}><FolderOpen size={14} /><span>试卷库</span><b>{papers.filter((paper) => !paper.folderId).length}</b></button>{treeChildren(null)}</aside>
      <main className="paper-library-main">
        <div className="paper-library-toolbar"><nav className="paper-breadcrumbs" aria-label="当前位置"><button type="button" onClick={() => openFolder(null)}>试卷库</button>{breadcrumbs.map((folder) => <span key={folder.id}><ChevronRight size={12} /><button type="button" onClick={() => openFolder(folder.id)}>{folder.name}</button></span>)}</nav><div><label className="paper-library-search"><Search size={13} /><input aria-label="搜索当前文件夹" placeholder="搜索当前文件夹" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button type="button" className="btn btn-small" onClick={() => setCreating(true)}><FolderPlus size={14} /> 新建文件夹</button></div></div>
        {error && <p className="paper-library-error">{error}</p>}
        {creating && <form className="paper-library-create" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}><FolderPlus size={16} /><input autoFocus placeholder="文件夹名称" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} /><button type="submit">创建</button><button type="button" onClick={() => setCreating(false)}>取消</button></form>}
        <div className="paper-library-summary"><strong>{currentFolder?.name ?? "试卷库"}</strong><span>{visibleFolders.length} 个文件夹 · {visiblePapers.length} 份试卷</span></div>
        <section className="paper-file-grid">
          {visibleFolders.map((folder) => <article className="paper-file-card folder" key={folder.id}><Link href={`/papers?folder=${folder.id}`}><span className="paper-file-icon"><Folder size={25} fill="currentColor" /></span><div><strong>{folder.name}</strong><small>{folders.filter((item) => item.parentId === folder.id).length} 个文件夹 · {papers.filter((paper) => paper.folderId === folder.id).length} 份试卷</small></div></Link><details className="paper-file-menu"><summary aria-label={`${folder.name} 操作`}><MoreHorizontal size={15} /></summary><div><button type="button" onClick={() => beginRename({ kind: "folder", id: folder.id, name: folder.name })}><Pencil size={12} /> 重命名</button><button type="button" className="danger" onClick={() => void removeFolder(folder)}><Trash2 size={12} /> 删除空文件夹</button></div></details></article>)}
          {visiblePapers.map((paper) => <article className="paper-file-card paper" key={paper.id}><Link href={`/papers/${paper.id}`}><span className="paper-file-icon"><FileText size={23} /></span><div><strong>{paper.title}</strong><small>{stageLabel(paper.stage as "primary" | "middle" | "high")} · {paper.subject} · {paper.questionCount} 题</small><em>{formatTime(paper.updatedAt)} 更新</em></div></Link><details className="paper-file-menu"><summary aria-label={`${paper.title} 操作`}><MoreHorizontal size={15} /></summary><div><button type="button" onClick={() => beginRename({ kind: "paper", id: paper.id, name: paper.title })}><Pencil size={12} /> 重命名</button><label>移动到<select value={paper.folderId ?? ""} onChange={(event) => void movePaper(paper.id, event.target.value || null)}><option value="">试卷库根目录</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder)}</option>)}</select></label><button type="button" className="danger" onClick={() => void removePaper(paper)}><Trash2 size={12} /> 删除试卷</button></div></details></article>)}
        </section>
        {!visibleFolders.length && !visiblePapers.length && <div className="paper-library-empty"><FolderOpen size={31} /><h2>{search ? "没有匹配内容" : "这个文件夹是空的"}</h2><p>{search ? "换个关键词，或返回上级文件夹。" : "新建试卷，或将其他试卷移动到这里。"}</p></div>}
      </main>
    </div>
    {renameTarget && <div className="paper-library-modal" role="dialog" aria-modal="true" aria-labelledby="rename-title"><form onSubmit={(event) => { event.preventDefault(); void renameItem(); }}><h2 id="rename-title">重命名{renameTarget.kind === "folder" ? "文件夹" : "试卷"}</h2><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /><div><button type="button" className="btn" onClick={() => setRenameTarget(null)}>取消</button><button type="submit" className="btn btn-primary">保存</button></div></form></div>}
  </div>;
}

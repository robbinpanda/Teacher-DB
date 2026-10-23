"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, X } from "lucide-react";
import { IMAGE_ACCEPT, MAX_IMAGE_PAGES } from "../lib/image-paper";
import { prepareImagePages, type PreparedImagePage } from "../lib/client-image-paper";

function PageThumbnail({ page }: { page: PreparedImagePage }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const value = URL.createObjectURL(page.blob);
    if (image.current) image.current.src = value;
    return () => URL.revokeObjectURL(value);
  }, [page.blob]);
  // Local Blob previews have no server URL for Next's image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt={`${page.sourceName} 页面预览`} width={120} height={160} />;
}

export function ImagePaperInput({ pages, onChange, disabled, onBusy, onError }: {
  pages: PreparedImagePage[]; onChange: (pages: PreparedImagePage[]) => void;
  disabled: boolean; onBusy: (busy: boolean) => void; onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [splitLongImages, setSplitLongImages] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onBusy(false); }; }, [onBusy]);
  async function addFiles(files: File[]) {
    if (disabled || busyRef.current || !files.length) return;
    busyRef.current = true; setBusy(true); onBusy(true); onError("");
    try {
      const next = [...pages];
      for (const file of files) {
        next.push(...await prepareImagePages(file, splitLongImages));
        if (!mounted.current) return;
        if (next.length > MAX_IMAGE_PAGES) throw new Error(`一份图片试卷最多 ${MAX_IMAGE_PAGES} 页，请分批导入`);
      }
      if (mounted.current) onChange(next);
    } catch (error) { if (mounted.current) onError(error instanceof Error ? error.message : "图片处理失败"); }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); onBusy(false); } }
  }
  function move(index: number, offset: number) {
    const next = [...pages]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next);
  }
  return <div className="wb-image-import">
    <label className="wb-image-split"><input type="checkbox" checked={splitLongImages} disabled={disabled || busy} onChange={event => setSplitLongImages(event.target.checked)} />添加时自动拆分长图</label>
    <input ref={input} className="wb-sr-only" type="file" multiple accept={IMAGE_ACCEPT} aria-label="选择试卷图片" disabled={disabled || busy} onChange={event => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <button type="button" className="wb-drop-zone" disabled={disabled || busy} onClick={() => input.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}>
      <ImagePlus size={26} /><strong>{busy ? "正在整理页面…" : "点击选择或拖放图片"}</strong><span>JPG、PNG、WebP · 每张最大 20 MB</span>
    </button>
    <p className="wb-field-hint">一张长图或多张照片合成一份试卷。按下方顺序导入，可继续添加、调整顺序或移除页面。请确认自动分页没有截断题目。</p>
    {!!pages.length && <><div className="wb-image-pages-heading"><strong>共 {pages.length} 页 · 1 份试卷</strong><button type="button" className="wb-text-button" disabled={disabled || busy} onClick={() => onChange([])}>清空页面</button></div>
      <ol className="wb-image-pages">{pages.map((page, index) => <li key={page.id}>
        <PageThumbnail page={page} />
        <div><strong>第 {index + 1} 页</strong><span title={page.sourceName}>{page.sourceName}</span><small>{page.width} × {page.height}</small></div>
        <div className="wb-image-page-actions">
          <button type="button" className="wb-icon-button" aria-label={`第 ${index + 1} 页上移`} disabled={disabled || busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="wb-icon-button" aria-label={`第 ${index + 1} 页下移`} disabled={disabled || busy || index === pages.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" className="wb-icon-button" aria-label={`移除第 ${index + 1} 页`} disabled={disabled || busy} onClick={() => onChange(pages.filter((_, i) => i !== index))}><X size={16} /></button>
        </div>
      </li>)}</ol></>}
  </div>;
}

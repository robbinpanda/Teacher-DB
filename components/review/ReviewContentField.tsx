import { useEffect, useRef, type ReactNode } from "react";
import { Check, Pencil } from "lucide-react";

export function ReviewContentField({ label, editing, disabled, onEdit, onDone, preview, children }: {
  label: string;
  editing: boolean;
  disabled: boolean;
  onEdit: () => void;
  onDone: () => void;
  preview: ReactNode;
  children: ReactNode;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editing) editorRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>("textarea, input")?.focus();
  }, [editing]);

  function finish() {
    onDone();
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  return (
    <section className={`review-content-field${editing ? " editing" : ""}`} aria-label={`${label}内容`}>
      <div className="review-content-heading">
        <h4>{label}</h4>
        {editing ? <button type="button" onClick={finish}><Check size={13} /> 完成编辑</button> : <button ref={triggerRef} type="button" className="review-preview-trigger" aria-label={`编辑${label} LaTeX`} onClick={onEdit}><Pencil size={12} /> 编辑</button>}
      </div>
      {editing ? <div ref={editorRef} className="review-content-editor" onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}>
        {children}
        <small>支持 LaTeX · 完成后在底部保存修改</small>
      </div> : <div className="review-content-preview" tabIndex={disabled ? -1 : 0} aria-label={`${label}预览`} onClick={() => {
        if (!disabled && window.getSelection()?.isCollapsed !== false) onEdit();
      }} onKeyDown={(event) => {
        if (!disabled && event.key === "Enter") { event.preventDefault(); onEdit(); }
      }}>
        <div className="review-formatted-content">{preview}</div>
      </div>}
    </section>
  );
}

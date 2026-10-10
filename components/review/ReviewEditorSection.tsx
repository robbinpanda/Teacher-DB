import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Native disclosure keeps advanced tools keyboard-accessible without a second scroll area. */
export function ReviewEditorSection({ id, title, hint, children, open, onToggle }: {
  id?: string;
  title: string;
  hint?: string;
  children: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details id={id} className="review-editor-section" open={open} onToggle={(event) => onToggle?.(event.currentTarget.open)}>
      <summary><span>{title}</span>{hint && <small>{hint}</small>}<ChevronDown size={14} /></summary>
      <div className="review-section-content">{children}</div>
    </details>
  );
}

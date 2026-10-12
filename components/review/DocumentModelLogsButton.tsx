"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { WorkbenchDialog } from "../WorkbenchDialog";
import { DocumentModelLogs } from "./DocumentModelLogs";

export function DocumentModelLogsButton({ documentId, documentName, documentError, className = "btn btn-small", label = "识别日志", showIcon = true }: {
  documentId: string; documentName: string; documentError?: string | null;
  className?: string; label?: string; showIcon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return <>
    <button type="button" className={className} aria-label={`${label} ${documentName}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {showIcon && <FileText size={15} aria-hidden="true" />}{label}
    </button>
    {open && createPortal(<WorkbenchDialog open titleId={titleId} className="model-logs-dialog" onClose={() => setOpen(false)}>
      <DocumentModelLogs documentId={documentId} documentName={documentName} documentError={documentError} titleId={titleId} onClose={() => setOpen(false)} />
    </WorkbenchDialog>, document.body)}
  </>;
}

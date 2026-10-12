"use client";

import { useEffect, useRef } from "react";

export function SelectionCheckbox({ label, checked, indeterminate = false, disabled = false, onChange }: {
  label: string; checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={input} type="checkbox" className="resource-checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />;
}

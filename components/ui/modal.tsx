"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[var(--radius-card)] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-lift)] sm:max-w-lg sm:rounded-[var(--radius-card)] sm:p-[26px]">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="card-title">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-10 place-items-center rounded-full border border-line-strong text-muted hover:text-fg"
          >
            <X className="size-[18px]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

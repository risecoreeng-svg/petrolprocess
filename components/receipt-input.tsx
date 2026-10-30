"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, Paperclip, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";

const BUCKET = "receipts";

/**
 * Take or pick a receipt photo. It uploads straight away to the org's private folder in
 * Supabase Storage and hands back the stored path.
 */
export function ReceiptInput({
  orgId,
  value,
  onChange,
}: {
  orgId: string;
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (file.size > 8 * 1024 * 1024) return toast.error("That photo is over 8 MB");
    setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${orgId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
    setBusy(false);
    if (error) return toast.error(`Couldn't upload the receipt: ${errorMessage(error)}`);
    onChange(path);
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-inner)] bg-surface-3 px-3 py-2.5 text-sm shadow-[var(--shadow-soft)]">
        <Paperclip className="size-4 text-muted" />
        <span className="flex-1">Receipt attached</span>
        <button type="button" onClick={() => onChange(null)} className="p-1 text-muted" aria-label="Remove receipt">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-inner)] border border-dashed border-line-strong bg-surface-3 text-sm text-muted">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
      {busy ? "Uploading…" : "Add receipt photo (optional)"}
      <input
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Opens a short-lived signed link to a stored receipt. */
export function ReceiptLink({ path }: { path: string | null }) {
  if (!path) return null;
  async function open() {
    const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(path!, 120);
    if (error || !data) return toast.error(`Couldn't open the receipt: ${errorMessage(error)}`);
    window.open(data.signedUrl, "_blank", "noopener");
  }
  return (
    <button type="button" onClick={open} className="inline-flex items-center gap-1 text-[13px] text-muted underline-offset-2 hover:underline">
      <Paperclip className="size-3.5" /> Receipt
    </button>
  );
}

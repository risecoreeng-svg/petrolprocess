"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { DELETE_REASONS, mayChange, type DeleteKind, type DeleteRules } from "@/lib/delete-rules";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Modal } from "@/components/ui/modal";

const RulesContext = createContext<DeleteRules>({ userId: "", role: "", windowHours: 24 });

export function DeleteRulesProvider({ value, children }: { value: DeleteRules; children: React.ReactNode }) {
  return <RulesContext.Provider value={value}>{children}</RulesContext.Provider>;
}

export function useDeleteRules() {
  return useContext(RulesContext);
}

/** True when the signed-in user may delete or edit this record (the database checks again). */
export function useMayChange(kind: DeleteKind, createdBy: string | null | undefined, createdAt: string | null | undefined) {
  return mayChange(useContext(RulesContext), kind, createdBy, createdAt);
}

type Preview = { allowed: boolean; denied: string | null; effect: string; warning: string | null; blocked: string | null; editable: boolean };

/**
 * Trash button that opens the delete dialog. Renders nothing when the user may not delete
 * this record. `onEdit` adds an "Edit instead" option for wrong amounts.
 */
export function DeleteButton({
  kind,
  id,
  createdBy,
  createdAt,
  what,
  onEdit,
  onDeleted,
  full,
}: {
  kind: DeleteKind;
  id: string;
  createdBy: string | null | undefined;
  createdAt: string | null | undefined;
  /** e.g. "this delivery" */
  what: string;
  onEdit?: () => void;
  onDeleted?: () => void;
  /** Labelled outline button instead of an icon */
  full?: boolean;
}) {
  const allowed = useMayChange(kind, createdBy, createdAt);
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      {full ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Trash2 /> Delete
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title={`Delete ${what}`} aria-label={`Delete ${what}`}>
          <Trash2 />
        </Button>
      )}
      {open ? <DeleteDialog kind={kind} id={id} what={what} onClose={() => setOpen(false)} onEdit={onEdit} onDeleted={onDeleted} /> : null}
    </>
  );
}

export function DeleteDialog({
  kind,
  id,
  what,
  onClose,
  onEdit,
  onDeleted,
}: {
  kind: DeleteKind;
  id: string;
  what: string;
  onClose: () => void;
  onEdit?: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    createClient()
      .rpc("delete_preview", { p_kind: kind, p_id: id })
      .then(({ data, error }) => (error ? setLoadError(errorMessage(error)) : setPreview(data as Preview)));
  }, [kind, id]);

  const needsNote = reason === "Other";
  const stop = preview?.denied ?? preview?.blocked ?? null;
  const canSubmit = !!preview && !stop && !!reason && (!needsNote || note.trim().length > 0) && !pending;

  async function onDelete() {
    setPending(true);
    const { error } = await createClient().rpc("delete_record", { p_kind: kind, p_id: id, p_reason: reason, p_note: note.trim() || null });
    setPending(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Deleted. You can find it under Deleted items.");
    onClose();
    if (onDeleted) onDeleted();
    else router.refresh();
  }

  return (
    <Modal open onClose={onClose} title={`Delete ${what}?`}>
      {loadError ? (
        <p className="text-[15px] text-orange">{loadError}</p>
      ) : !preview ? (
        <p className="text-[15px] text-muted">Checking what this would change…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-[15px]">{preview.effect}</p>
          {preview.warning ? (
            <p className="flex gap-2.5 rounded-[var(--radius-inner)] bg-yellow/40 p-3 text-[14px]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {preview.warning}
            </p>
          ) : null}
          {stop ? (
            <p className="flex gap-2.5 rounded-[var(--radius-inner)] bg-orange/15 p-3 text-[14px] font-medium text-orange">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {stop}
            </p>
          ) : (
            <>
              <Field label="Why are you deleting it?" htmlFor="delete-reason">
                <Select id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose a reason</option>
                  {DELETE_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
              {reason ? (
                <Field label={needsNote ? "Say why" : "Note (optional)"} htmlFor="delete-note">
                  <Input id="delete-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={needsNote ? "A few words" : ""} />
                </Field>
              ) : null}
              {reason === "Wrong amount" && preview.editable && onEdit ? (
                <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-inner)] bg-surface-2 p-3 text-[14px]">
                  <span className="flex-1">Only the amount is wrong? You can edit it instead and keep the record.</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onClose();
                      onEdit();
                    }}
                  >
                    <Pencil /> Edit instead
                  </Button>
                </div>
              ) : null}
              <p className="text-[13px] text-muted">Nothing is erased: it moves to Deleted items, and the owner can restore it.</p>
            </>
          )}
          <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose}>
              Keep it
            </Button>
            {!stop ? (
              <Button variant="destructive" onClick={onDelete} disabled={!canSubmit}>
                <Trash2 /> {pending ? "Deleting…" : "Delete"}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

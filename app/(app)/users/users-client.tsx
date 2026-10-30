"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Plus } from "lucide-react";
import type { Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createUser, resetPassword, setUserActive } from "./actions";

export type UserRow = { id: string; full_name: string; email: string; role: Role; active: boolean; created_at: string };

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including profit, cost and users",
  manager: "Sales manager: stock, sales, customers and what stock cost, but never profit or margins",
  fleet_manager: "Fleet manager: trips, fuel movements, truck costs and documents, but never profit or staff pay",
  attendant: "Record sales and see their own shifts only",
  driver: "Driver: a simple phone view of their own trips, to add expenses and delivered litres",
};

export function UsersClient({
  meId,
  orgName,
  users,
  adminError,
  freeDrivers,
}: {
  meId: string;
  orgName: string;
  users: UserRow[];
  adminError: string | null;
  /** Drivers that don't have a login yet */
  freeDrivers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [pending, startTransition] = useTransition();

  async function changeRole(u: UserRow, role: Role) {
    if (!confirm(`Change ${u.full_name} to ${role}?`)) return;
    const { error } = await createClient().from("profiles").update({ role }).eq("id", u.id);
    if (error) return toast.error(errorMessage(error));
    toast.success("Role updated");
    router.refresh();
  }

  function toggleActive(u: UserRow) {
    if (!confirm(`${u.active ? "Deactivate" : "Reactivate"} ${u.full_name}?`)) return;
    startTransition(async () => {
      const res = await setUserActive(u.id, !u.active);
      if (!res.ok) return void toast.error(res.error);
      toast.success(u.active ? "User deactivated" : "User reactivated");
      router.refresh();
    });
  }

  return (
    <>
      <PageHeader
        title="Users"
        description={`Staff accounts for ${orgName}`}
        actions={
          <Button onClick={() => setCreating(true)} disabled={!!adminError}>
            <Plus /> Add user
          </Button>
        }
      />
      {adminError ? (
        <p className="mb-4 rounded-[var(--radius-tile)] bg-yellow p-4 text-sm text-[#1c1c1a]">
          User management needs SUPABASE_SERVICE_ROLE_KEY on the server ({adminError}).
        </p>
      ) : null}

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Email</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>Added</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id}>
              <TD className="font-medium">
                {u.full_name}
                {u.id === meId ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
              </TD>
              <TD>{u.email}</TD>
              <TD>
                {u.role === "owner" ? (
                  <Badge variant="secondary">Owner</Badge>
                ) : (
                  <Select
                    aria-label={`Role for ${u.full_name}`}
                    className="h-9 w-36 text-sm"
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value as Role)}
                  >
                    <option value="manager">Sales manager</option>
                    <option value="fleet_manager">Fleet manager</option>
                    <option value="attendant">Attendant</option>
                    {u.role === "driver" ? <option value="driver">Driver</option> : null}
                  </Select>
                )}
              </TD>
              <TD>{u.active ? <Badge>Active</Badge> : <Badge variant="destructive">Inactive</Badge>}</TD>
              <TD>{formatDate(u.created_at)}</TD>
              <TD className="flex gap-1">
                {u.role !== "owner" ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setResetting(u)} disabled={!!adminError} title="Set password">
                      <KeyRound />
                    </Button>
                    <Button size="sm" variant={u.active ? "ghost" : "outline"} onClick={() => toggleActive(u)} disabled={pending || !!adminError}>
                      {u.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </>
                ) : null}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {creating ? <CreateUserForm freeDrivers={freeDrivers} onClose={() => setCreating(false)} /> : null}
      {resetting ? <ResetPasswordForm user={resetting} onClose={() => setResetting(null)} /> : null}
    </>
  );
}

function CreateUserForm({ freeDrivers, onClose }: { freeDrivers: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "attendant" as "manager" | "fleet_manager" | "attendant" | "driver",
    driver_id: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createUser({ ...form, driver_id: form.role === "driver" ? form.driver_id || null : null });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(`${form.full_name} can now sign in`);
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal open onClose={onClose} title="Add user">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Full name" htmlFor="ufn" error={errors.full_name}>
          <Input id="ufn" value={form.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Email" htmlFor="uem" error={errors.email}>
          <Input id="uem" type="email" autoComplete="off" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Temporary password" htmlFor="upw" error={errors.password} hint="Share it with them privately.">
          <Input id="upw" type="text" autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <Field label="Role" htmlFor="url" hint={ROLE_HELP[form.role]}>
          <Select id="url" value={form.role} onChange={set("role")}>
            <option value="attendant">Attendant</option>
            <option value="manager">Sales manager</option>
            <option value="fleet_manager">Fleet manager</option>
            <option value="driver">Driver</option>
          </Select>
        </Field>
        {form.role === "driver" ? (
          <Field
            label="Which driver is this?"
            htmlFor="udrv"
            error={errors.driver_id}
            hint={freeDrivers.length === 0 ? "Add the driver under Drivers first." : "They'll only see trips assigned to this driver."}
          >
            <Select id="udrv" value={form.driver_id} onChange={set("driver_id")}>
              <option value="">Choose…</option>
              {freeDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Button type="submit" size="lg" disabled={pending}>
          Create user
        </Button>
      </form>
    </Modal>
  );
}

function ResetPasswordForm({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await resetPassword(user.id, password);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Password updated");
      onClose();
    });
  }
  return (
    <Modal open onClose={onClose} title={`Set password for ${user.full_name}`}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="New password" htmlFor="npw" hint="At least 8 characters.">
          <Input id="npw" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          Set password
        </Button>
      </form>
    </Modal>
  );
}

/**
 * Who may delete or edit a record. Mirrors public.change_denied() in the database, which is
 * what actually enforces it; the UI uses this only to hide buttons that would be refused.
 */
export type DeleteKind = "purchase" | "sale" | "expense" | "credit_payment" | "trip" | "trip_line" | "truck_expense";

export type DeleteRules = { userId: string; role: string; windowHours: number };

const FLEET: DeleteKind[] = ["trip", "trip_line", "truck_expense"];

export function mayChange(rules: DeleteRules, kind: DeleteKind, createdBy: string | null | undefined, createdAt: string | null | undefined) {
  if (rules.role === "owner") return true;
  const dept = FLEET.includes(kind) ? "fleet_manager" : "manager";
  if (rules.role !== dept) return false;
  if (!createdBy || createdBy !== rules.userId || !createdAt) return false;
  return Date.now() - Date.parse(createdAt) <= rules.windowHours * 3_600_000;
}

export const DELETE_REASONS = ["Entered by mistake", "Duplicate", "Wrong amount", "Test data", "Other"] as const;

export const KIND_LABEL: Record<DeleteKind, string> = {
  purchase: "Delivery",
  sale: "Sale",
  expense: "Expense",
  credit_payment: "Credit payment",
  trip: "Trip",
  trip_line: "Trip income or cost",
  truck_expense: "Truck cost",
};

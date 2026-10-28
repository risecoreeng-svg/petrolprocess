export type FuelType = { id: string; name: string; current_selling_price: number };
export type Tank = {
  id: string;
  name: string;
  fuel_type_id: string;
  capacity_litres: number;
  current_litres: number;
  low_stock_level: number;
};
export type Driver = { id: string; name: string; phone: string | null; licence_no: string | null };
export type TruckStatus = "active" | "maintenance" | "on_trip";
export type Truck = {
  id: string;
  plate_number: string;
  capacity_litres: number;
  driver_id: string | null;
  status: TruckStatus;
  notes: string | null;
};
export type Supplier = { id: string; name: string; phone: string | null; location: string | null };
export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number;
  credit_terms_days: number;
  balance: number;
};
export type PaymentType = "cash" | "mobile" | "credit";

export const EXPENSE_CATEGORIES = [
  "salaries",
  "rent",
  "electricity",
  "licences",
  "maintenance",
  "truck_repairs",
  "truck_fuel",
  "security",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function labelize(s: string) {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const TRUCK_STATUS_LABEL: Record<TruckStatus, string> = {
  active: "Active",
  maintenance: "Maintenance",
  on_trip: "On trip",
};

export const PAYMENT_LABEL: Record<PaymentType, string> = { cash: "Cash", mobile: "Mobile money", credit: "Credit" };

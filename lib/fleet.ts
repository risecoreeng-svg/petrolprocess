// Truck Business: labels, types and small helpers shared by the fleet screens.
import { addDays, nairobiToday } from "@/lib/utils";

export type TripStatus = "planned" | "on_road" | "delivered" | "cancelled";
export type CargoType = "fuel" | "goods" | "other";

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  planned: "Planned",
  on_road: "On the road",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
export const TRIP_STATUS_VARIANT: Record<TripStatus, "secondary" | "info" | "default" | "destructive"> = {
  planned: "secondary",
  on_road: "info",
  delivered: "default",
  cancelled: "destructive",
};
export const CARGO_LABEL: Record<CargoType, string> = { fuel: "Fuel", goods: "Goods", other: "Other" };

export const TRIP_EXPENSE_CATEGORIES = {
  fuel: "Fuel",
  driver_pay: "Driver pay / allowance",
  tolls_border: "Tolls and border fees",
  loading: "Loading / offloading",
  checkpoint: "Police / checkpoint",
  meals: "Meals",
  road_repairs: "Repairs on the road",
  other: "Other",
} as const;
export const TRIP_INCOME_CATEGORIES = {
  waiting_time: "Waiting time",
  extra_drop: "Extra drop",
  other_income: "Other extra",
} as const;
export type TripExpenseCategory = keyof typeof TRIP_EXPENSE_CATEGORIES;

export const TRUCK_EXPENSE_CATEGORIES = {
  truck_fuel: "Fuel for the truck",
  driver_salary: "Driver salary",
  licence: "Licence",
  permit: "Permit",
  insurance: "Insurance",
  inspection: "Inspection",
  tyres: "Tyres",
  repairs: "Repairs and maintenance",
  parking: "Parking",
  fines: "Fines",
  other: "Other",
} as const;
export type TruckExpenseCategory = keyof typeof TRUCK_EXPENSE_CATEGORIES;

/** Staff pay: only the owner records or sees these. */
export const PAY_CATEGORIES = new Set(["driver_pay", "driver_salary"]);

export const DOC_TYPES = {
  licence: "Licence",
  insurance: "Insurance",
  inspection: "Inspection",
  permit: "Permit",
  other: "Other",
} as const;
export type DocType = keyof typeof DOC_TYPES;

export const TRUCK_STATUS_TEXT: Record<string, string> = {
  active: "Available",
  on_trip: "On a trip",
  maintenance: "In maintenance",
  inactive: "Inactive",
};
export const TRUCK_STATUS_BADGE: Record<string, "default" | "info" | "warning" | "secondary"> = {
  active: "default",
  on_trip: "info",
  maintenance: "warning",
  inactive: "secondary",
};

export type FleetTruck = {
  id: string;
  plate_number: string;
  make_model: string | null;
  year: number | null;
  truck_type: "tanker" | "flatbed" | "other";
  capacity_litres: number;
  capacity_unit: "litres" | "tonnes";
  driver_id: string | null;
  status: "active" | "on_trip" | "maintenance" | "inactive";
  odometer_km: number;
  ownership: "own" | "third_party";
  third_party_owner: string | null;
  payout_type: "fixed_per_trip" | "percent_of_fee" | null;
  payout_value: number | null;
  notes: string | null;
};

export type FleetDriver = {
  id: string;
  name: string;
  phone: string | null;
  licence_no: string | null;
  licence_expiry: string | null;
  profile_id: string | null;
};

export type Trip = {
  id: string;
  created_by?: string | null;
  created_at?: string;
  trip_no: number;
  date: string;
  truck_id: string;
  driver_id: string | null;
  customer_id: string | null;
  for_own_depot: boolean;
  route_from: string;
  route_to: string;
  cargo_type: CargoType;
  currency: string;
  fx_rate: number;
  fee_original: number;
  fee: number;
  status: TripStatus;
  started_at: string | null;
  delivered_at: string | null;
  cancel_reason: string | null;
  start_odometer: number | null;
  end_odometer: number | null;
  notes: string | null;
  start_override_reason: string | null;
  fuel_type_id: string | null;
  litres_loaded: number | null;
  loaded_from: string | null;
  loading_ticket: string | null;
  supplier_id: string | null;
  litres_delivered: number | null;
  shortage_litres: number | null;
  shortage_pct: number | null;
  haulage_status: "ok" | "disputed" | "resolved" | null;
  dispute_note: string | null;
  tank_id: string | null;
};

export const TRIP_COLUMNS =
  "id, trip_no, date, truck_id, driver_id, customer_id, for_own_depot, route_from, route_to, cargo_type, currency, fx_rate, fee_original, fee, status, started_at, delivered_at, cancel_reason, start_odometer, end_odometer, notes, start_override_reason, fuel_type_id, litres_loaded, loaded_from, loading_ticket, supplier_id, litres_delivered, shortage_litres, shortage_pct, haulage_status, dispute_note, tank_id, created_by, created_at";

/** How a document or licence expiry stands today. */
export function expiryState(date: string | null | undefined): "expired" | "soon" | "ok" | "none" {
  if (!date) return "none";
  const today = nairobiToday();
  if (date < today) return "expired";
  if (date <= addDays(today, 30)) return "soon";
  return "ok";
}

export type Reminder = {
  id: string;
  truck_id: string;
  name: string;
  every_km: number | null;
  every_days: number | null;
  last_done_km: number | null;
  last_done_on: string | null;
};

/** Whether a service reminder is due (by km or by date), and how close. */
export function reminderState(r: Reminder, odometer: number) {
  const today = nairobiToday();
  const kmLeft = r.every_km ? Number(r.last_done_km ?? 0) + Number(r.every_km) - Number(odometer) : null;
  const dueDate = r.every_days ? addDays(r.last_done_on ?? today, r.every_days) : null;
  const overdue = (kmLeft !== null && kmLeft <= 0) || (dueDate !== null && dueDate < today);
  const soon = !overdue && ((kmLeft !== null && kmLeft <= 1000) || (dueDate !== null && dueDate <= addDays(today, 14)));
  return { kmLeft, dueDate, overdue, soon };
}

import type { Role } from "@/lib/auth";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
  /** Shown in the mobile bottom bar (the first four that apply to the role; the rest go under "More"). */
  primary?: boolean;
  /** Small heading shown above the item in the desktop sidebar when the group changes */
  group?: "Depot" | "Trucks" | "Business";
};

const OWNER_MGR: Role[] = ["owner", "manager"];
const FLEET: Role[] = ["owner", "fleet_manager"];

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard", roles: ["owner", "manager", "fleet_manager"], primary: true },
  { href: "/my-trips", label: "My trips", icon: "Route", roles: ["driver"], primary: true },
  // Depot
  { href: "/sales", label: "Sales", icon: "Fuel", roles: ["owner", "manager", "attendant"], primary: true, group: "Depot" },
  { href: "/shifts", label: "Shifts", icon: "Clock", roles: ["owner", "manager", "attendant"], primary: true, group: "Depot" },
  { href: "/purchases", label: "Add stock", icon: "PackagePlus", roles: OWNER_MGR, primary: true, group: "Depot" },
  { href: "/stock", label: "Stock", icon: "Gauge", roles: OWNER_MGR, group: "Depot" },
  { href: "/customers", label: "Customers", icon: "HandCoins", roles: OWNER_MGR, group: "Depot" },
  { href: "/expenses", label: "Expenses", icon: "Receipt", roles: OWNER_MGR, group: "Depot" },
  // Trucks
  { href: "/trips", label: "Trips", icon: "Navigation", roles: FLEET, primary: true, group: "Trucks" },
  { href: "/fuel-movements", label: "Fuel movements", icon: "Droplet", roles: FLEET, primary: true, group: "Trucks" },
  { href: "/trucks", label: "Trucks", icon: "Truck", roles: ["owner", "manager", "fleet_manager"], primary: true, group: "Trucks" },
  { href: "/drivers", label: "Drivers", icon: "IdCard", roles: FLEET, group: "Trucks" },
  { href: "/truck-expenses", label: "Truck costs", icon: "Wrench", roles: FLEET, group: "Trucks" },
  { href: "/documents", label: "Documents", icon: "FileBadge", roles: FLEET, group: "Trucks" },
  { href: "/trip-clients", label: "Trip clients", icon: "Handshake", roles: FLEET, group: "Trucks" },
  { href: "/fleet", label: "Truck performance", icon: "TrendingUp", roles: ["owner"], group: "Trucks" },
  // Business
  { href: "/reports", label: "Reports", icon: "ChartColumn", roles: ["owner", "manager", "fleet_manager"], group: "Business" },
  { href: "/users", label: "Users", icon: "UserCog", roles: ["owner"], group: "Business" },
  { href: "/deleted", label: "Deleted items", icon: "Trash2", roles: OWNER_MGR, group: "Business" },
  { href: "/audit", label: "Audit log", icon: "ScrollText", roles: ["owner"], group: "Business" },
  { href: "/settings", label: "Settings", icon: "Settings", roles: ["owner"], group: "Business" },
];

export function navFor(role: Role) {
  return NAV.filter((n) => n.roles.includes(role));
}

/** Where each role lands after sign-in. */
export function homeFor(role: Role) {
  return role === "attendant" ? "/sales" : role === "driver" ? "/my-trips" : "/";
}

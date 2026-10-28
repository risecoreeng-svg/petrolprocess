import type { Role } from "@/lib/auth";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
  /** Shown in the mobile bottom bar (the rest go under "More"). */
  primary?: boolean;
};

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard", roles: ["owner", "manager"], primary: true },
  { href: "/sales", label: "Sales", icon: "Fuel", roles: ["owner", "manager", "attendant"], primary: true },
  { href: "/shifts", label: "Shifts", icon: "Clock", roles: ["owner", "manager", "attendant"], primary: true },
  { href: "/purchases", label: "Add stock", icon: "PackagePlus", roles: ["owner", "manager"], primary: true },
  { href: "/stock", label: "Stock", icon: "Gauge", roles: ["owner", "manager"] },
  { href: "/trucks", label: "Trucks", icon: "Truck", roles: ["owner", "manager"] },
  { href: "/expenses", label: "Expenses", icon: "Receipt", roles: ["owner", "manager"] },
  { href: "/customers", label: "Customers", icon: "HandCoins", roles: ["owner", "manager"] },
  { href: "/reports", label: "Reports", icon: "ChartColumn", roles: ["owner", "manager"] },
  { href: "/users", label: "Users", icon: "UserCog", roles: ["owner"] },
  { href: "/audit", label: "Audit log", icon: "ScrollText", roles: ["owner"] },
  { href: "/settings", label: "Settings", icon: "Settings", roles: ["owner"] },
];

export function navFor(role: Role) {
  return NAV.filter((n) => n.roles.includes(role));
}

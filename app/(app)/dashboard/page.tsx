import { redirect } from "next/navigation";

/** /dashboard is the home page; its detail pages live under /dashboard/*. */
export default function DashboardIndex() {
  redirect("/");
}

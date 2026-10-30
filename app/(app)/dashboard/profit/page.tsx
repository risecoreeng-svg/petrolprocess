import { requireRole } from "@/lib/auth";
import { PnlBreakdown } from "../pnl";
import type { DrillParams } from "../shared";

/** Owner only: managers never see cost or profit. */
export default async function Page({ searchParams }: { searchParams: Promise<DrillParams> }) {
  await requireRole("owner");
  return <PnlBreakdown sp={await searchParams} kind="profit" />;
}

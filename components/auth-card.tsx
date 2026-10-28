import { BrandMark } from "@/components/app-shell";

/** Centred card layout shared by sign in, sign up and password screens. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-12 rounded-[16px]" />
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="text-[15px] text-muted">{subtitle}</p> : null}
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)] sm:p-[26px]">
          {children}
        </div>
        {footer ? <div className="mt-5 text-center text-[15px] text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}

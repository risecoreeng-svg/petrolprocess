import { Fuel } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

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
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Fuel className="size-6" />
          </div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <Card>
          <CardContent className="p-5">{children}</CardContent>
        </Card>
        {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}

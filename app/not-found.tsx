import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-5xl font-bold">404</p>
        <p className="mt-2 text-muted-foreground">That page doesn&apos;t exist.</p>
        <Button asChild className="mt-4">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}

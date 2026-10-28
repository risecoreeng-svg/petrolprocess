import { Fuel } from "lucide-react";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ inactive?: string }> }) {
  const { inactive } = await searchParams;
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Fuel className="size-6" />
          </div>
          <h1 className="text-2xl font-bold">PetroTrack</h1>
          <p className="text-sm text-muted-foreground">Sign in to your depot account</p>
        </div>
        <LoginForm inactive={inactive === "1"} />
      </div>
    </div>
  );
}

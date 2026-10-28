import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string; error?: string; reset?: string }>;
}) {
  const { inactive, error, reset } = await searchParams;
  return (
    <AuthCard
      title="PetroTrack"
      subtitle="Sign in to your depot account"
      footer={
        <>
          New to PetroTrack?{" "}
          <Link href="/signup" className="font-medium text-fg underline-offset-4 hover:underline">
            Create a business account
          </Link>
        </>
      }
    >
      <LoginForm inactive={inactive === "1"} linkError={error === "link"} passwordReset={reset === "1"} />
    </AuthCard>
  );
}

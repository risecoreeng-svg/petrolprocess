import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your business"
      subtitle="Start managing your fuel depot. You'll be the owner."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-fg underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}

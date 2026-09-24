import type { Metadata } from "next";
import Link from "next/link";
import { signInAction } from "@/actions/auth";
import { AuthForm, AuthLink } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";
  const notice = sp.error === "link" ? "That link is invalid or has expired. Please try again." : null;
  return (
    <AuthForm
      title="Sign in"
      description="Welcome back. Sign in to manage your orders and production."
      action={signInAction}
      hidden={{ next }}
      notice={notice}
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        {
          name: "password",
          label: "Password",
          type: "password",
          autoComplete: "current-password",
          hint: (
            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          ),
        },
      ]}
      submitLabel="Sign in"
      footer={
        <>
          New to PrintFlow? <AuthLink href="/signup">Create an account</AuthLink>
        </>
      }
    />
  );
}

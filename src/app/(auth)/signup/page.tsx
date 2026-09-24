import type { Metadata } from "next";
import { signUpAction } from "@/actions/auth";
import { AuthForm, AuthLink } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthForm
      title="Create your account"
      action={signUpAction}
      fields={[
        { name: "fullName", label: "Your name", autoComplete: "name" },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "new-password", placeholder: "At least 8 characters" },
      ]}
      submitLabel="Create account"
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    />
  );
}

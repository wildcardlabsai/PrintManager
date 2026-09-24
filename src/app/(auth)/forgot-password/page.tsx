import type { Metadata } from "next";
import { forgotPasswordAction } from "@/actions/auth";
import { AuthForm, AuthLink } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthForm
      title="Reset your password"
      description="Enter your email and we'll send you a link to choose a new password."
      action={forgotPasswordAction}
      fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      submitLabel="Send reset link"
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    />
  );
}

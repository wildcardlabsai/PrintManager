import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resetPasswordAction } from "@/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { getSessionUser } from "@/lib/services/context";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // Reached from the recovery email link, which signs the user in.
  if (!(await getSessionUser())) redirect("/forgot-password");
  return (
    <AuthForm
      title="Choose a new password"
      action={resetPasswordAction}
      fields={[
        { name: "password", label: "New password", type: "password", autoComplete: "new-password", placeholder: "At least 8 characters" },
        { name: "confirm", label: "Confirm password", type: "password", autoComplete: "new-password" },
      ]}
      submitLabel="Update password"
    />
  );
}

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

const email = z.email("Enter a valid email address").trim().toLowerCase();
const password = z.string().min(8, "Password must be at least 8 characters").max(72, "Password is too long");

function authMessage(message: string | undefined, fallback: string) {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (m.includes("email not confirmed")) return "Confirm your email address first — check your inbox for the link.";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Try signing in.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("weak") || m.includes("password should")) return "Choose a stronger password (at least 8 characters).";
  if (m.includes("fetch failed") || m.includes("network")) return "Could not reach the authentication service. Check your connection.";
  return fallback;
}

/** Only allow redirects to paths inside this app. */
function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

async function origin() {
  const h = await headers();
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export type AuthState = ActionResult<{ info?: string }> | null;

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z.object({ email, password: z.string().min(1, "Enter your password") }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: authMessage(error.message, "Could not sign in. Please try again.") };
  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({ fullName: z.string().trim().min(1, "Enter your name").max(120), email, password })
    .safeParse({ fullName: formData.get("fullName"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${await origin()}/auth/confirm?next=/onboarding`,
    },
  });
  if (error) return { ok: false, error: authMessage(error.message, "Could not create your account.") };
  if (!data.session) {
    return { ok: true, data: { info: "Check your email to confirm your account, then sign in." } };
  }
  revalidatePath("/", "layout");
  redirect("/onboarding");
}

export async function forgotPasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = email.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await origin()}/auth/confirm?next=/reset-password`,
  });
  if (error && !/rate limit/i.test(error.message)) console.error("[auth] reset", error.message);
  if (error && /rate limit/i.test(error.message)) return { ok: false, error: authMessage(error.message, "") };
  // Same response whether or not the account exists.
  return { ok: true, data: { info: "If an account exists for that email, a reset link is on its way." } };
}

export async function resetPasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { ok: false, error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: authMessage(error.message, "Could not update your password.") };
  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function createOrganizationAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Enter your business name").max(120),
      currency: z.string().trim().length(3),
      demo: z.boolean(),
    })
    .safeParse({ name: formData.get("name"), currency: formData.get("currency") ?? "GBP", demo: formData.get("demo") === "on" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const { error } = await supabase.rpc("create_organization", { p_name: parsed.data.name, p_currency: parsed.data.currency });
  if (error) {
    console.error("[onboarding]", error);
    return { ok: false, error: "Could not create your business. Please try again." };
  }

  let demoFailed = false;
  if (parsed.data.demo) {
    const { loadAppContext } = await import("@/lib/services/context");
    const { loadDemoData } = await import("@/lib/services/demo-data");
    const ctx = await loadAppContext();
    if (ctx) {
      try {
        await loadDemoData(ctx);
      } catch (e) {
        console.error("[onboarding] demo data", e);
        demoFailed = true;
      }
    }
  }
  revalidatePath("/", "layout");
  redirect(demoFailed ? "/dashboard?notice=demo-failed" : "/dashboard");
}

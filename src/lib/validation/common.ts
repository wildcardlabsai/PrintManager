import { z } from "zod";

/** Empty strings from forms become null. */
export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const requiredText = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

/** Accepts numbers or numeric strings from inputs. */
export const money = (label = "Amount") =>
  z.coerce.number({ error: `${label} must be a number` }).min(0, `${label} cannot be negative`).max(1_000_000);

export const optionalMoney = (label = "Amount") =>
  z
    .union([z.literal(""), z.null(), z.undefined(), z.coerce.number({ error: `${label} must be a number` })]).optional()
    .transform((v) => (v === "" || v == null ? null : v))
    .refine((v) => v === null || (v >= 0 && v <= 1_000_000), `${label} cannot be negative`);

export const wholeNumber = (label: string, min = 0, max = 1_000_000) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max);

export const optionalUuid = z
  .union([z.literal(""), z.null(), z.undefined(), z.uuid()]).optional()
  .transform((v) => (v ? v : null));

export const optionalEmail = z
  .union([z.literal(""), z.null(), z.undefined(), z.email("Enter a valid email address").trim()]).optional()
  .transform((v) => (v ? v.toLowerCase() : null));

export const addressSchema = z.object({
  line1: optionalText(200),
  line2: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  postcode: optionalText(20),
  country: optionalText(80),
});
export type AddressInput = z.infer<typeof addressSchema>;

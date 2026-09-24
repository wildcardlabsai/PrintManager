/**
 * Error handling for the service layer. Raw database errors are translated
 * into messages a user can act on; details are logged server-side only.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "validation" | "not_found" | "forbidden" | "conflict" | "unauthenticated" | "app" = "app",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

const UNIQUE_MESSAGES: [RegExp, string][] = [
  [/products_organization_id_sku_key/, "Another product already uses this SKU."],
  [/product_variants_organization_id_sku_key/, "Another variant already uses this SKU."],
  [/orders_external_unique_idx/, "An order with this external order ID already exists for this sales channel."],
  [/orders_organization_id_order_number_key/, "That order number is already in use. Check the next order number in Settings."],
  [/production_jobs_item_unique_idx/, "This order item already has an active production job."],
  [/shipments_order_id_key/, "This order already has a shipment record."],
];

/** Converts a Supabase/PostgREST error into an AppError with a friendly message. */
export function fromDbError(error: DbErrorLike, fallback = "Something went wrong while saving. Please try again."): AppError {
  const code = error.code ?? "";
  const text = `${error.message ?? ""} ${error.details ?? ""}`;

  if (code === "23505") {
    const match = UNIQUE_MESSAGES.find(([re]) => re.test(text));
    return new AppError(match?.[1] ?? "A record with these details already exists.", "conflict");
  }
  if (code === "23503") return new AppError("This record is linked to other records and can't be changed that way.", "conflict");
  if (code === "23514" || code === "23502") return new AppError("Some values are invalid. Check the form and try again.", "validation");
  if (code === "42501") return new AppError("You don't have permission to do that.", "forbidden");
  if (code === "PGRST116") return new AppError("That record could not be found.", "not_found");
  if (code === "28000") return new AppError("Your session has expired. Please sign in again.", "unauthenticated");
  // Exceptions raised deliberately in our SQL functions carry readable messages.
  if ((code === "22023" || code === "P0001" || code === "P0002") && error.message) {
    return new AppError(error.message, "validation");
  }
  if (/fetch failed|ECONNREFUSED|NetworkError|network/i.test(text)) {
    return new AppError("Could not reach the database. Check your connection and try again.");
  }
  console.error("[db]", error);
  return new AppError(fallback);
}

/** Throw a friendly error if a Supabase response carries one. */
export function check<T>(result: { data: T; error: DbErrorLike | null }, fallback?: string): T {
  if (result.error) throw fromDbError(result.error, fallback);
  return result.data;
}

/** Like check(), but also throws not_found when no row came back. */
export function checkFound<T>(result: { data: T | null; error: DbErrorLike | null }, what = "Record"): T {
  if (result.error) throw fromDbError(result.error);
  if (result.data == null) throw new AppError(`${what} not found.`, "not_found");
  return result.data;
}

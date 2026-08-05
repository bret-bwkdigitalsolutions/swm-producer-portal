"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import { updateSubscriber, MembershipApiError } from "@/lib/membership/client";
import { SHIRT_SIZES } from "@/lib/membership/types";
import type { ShirtSize, SubscriberPatch } from "@/lib/membership/types";

export interface SubscriberFormState {
  success?: boolean;
  message?: string;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string) ?? "").trim();
}

/**
 * Update a subscriber's editable fields (display name + shirt size/address) and
 * PATCH them straight back to WordPress. Admin-only. Payment/subscription fields
 * are Stripe-managed and intentionally not editable here.
 */
export async function saveSubscriber(
  _prev: SubscriberFormState,
  formData: FormData
): Promise<SubscriberFormState> {
  await requireAdmin();

  const id = parseInt((formData.get("id") as string) ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    return { success: false, message: "Invalid subscriber." };
  }

  const patch: SubscriberPatch = {};

  const displayName = str(formData, "display_name");
  if (displayName) patch.display_name = displayName;

  const size = str(formData, "shirt_size");
  const shirt: NonNullable<SubscriberPatch["shirt"]> = {};
  if (size) {
    if (!SHIRT_SIZES.includes(size as ShirtSize)) {
      return { success: false, message: `Invalid shirt size "${size}".` };
    }
    shirt.size = size as ShirtSize;
  }
  shirt.name = str(formData, "ship_name");
  shirt.address_line1 = str(formData, "address_line1");
  shirt.address_line2 = str(formData, "address_line2");
  shirt.city = str(formData, "city");
  shirt.region = str(formData, "region");
  shirt.postal_code = str(formData, "postal_code");
  shirt.country = str(formData, "country") || "US";
  patch.shirt = shirt;

  try {
    await updateSubscriber(id, patch);
    revalidatePath(`/admin/subscribers/${id}`);
    revalidatePath("/admin/subscribers");
    return { success: true, message: "Saved." };
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof MembershipApiError
          ? err.message
          : "Failed to save subscriber.",
    };
  }
}

/** Toggle a subscriber's shirt shipped flag (PATCH shirt.shipped). Admin-only. */
export async function setShirtShipped(
  _prev: SubscriberFormState,
  formData: FormData
): Promise<SubscriberFormState> {
  await requireAdmin();

  const id = parseInt((formData.get("id") as string) ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    return { success: false, message: "Invalid subscriber." };
  }
  const shipped = (formData.get("shipped") as string) === "true";

  try {
    await updateSubscriber(id, { shirt: { shipped } });
    revalidatePath(`/admin/subscribers/${id}`);
    revalidatePath("/admin/subscribers");
    return {
      success: true,
      message: shipped ? "Marked shipped." : "Marked not shipped.",
    };
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof MembershipApiError
          ? err.message
          : "Failed to update shipping status.",
    };
  }
}

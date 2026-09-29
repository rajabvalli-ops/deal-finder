export type AdminErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "REASON_REQUIRED"
  | "NOT_EDITABLE"
  | "DUPLICATE"
  | "INVALID_PARENT"
  | "SELF_CHANGE"
  | "LAST_ADMIN";

export type AdminResult<T = void> = { ok: true; value: T } | { ok: false; error: AdminErrorCode };

export const ok = <T>(value: T): AdminResult<T> => ({ ok: true, value });
export const fail = (error: AdminErrorCode): AdminResult<never> => ({ ok: false, error });

/** Messages shown to admins; keyed by code so no user input is ever reflected. */
export const ADMIN_ERROR_MESSAGES: Record<AdminErrorCode, string> = {
  NOT_FOUND: "That record no longer exists.",
  FORBIDDEN: "You don't have permission to do that.",
  INVALID_TRANSITION: "That action isn't available for this deal's current status.",
  CONFLICT: "Someone else changed this deal first. Reload and try again.",
  REASON_REQUIRED: "Give a reason when rejecting a deal.",
  NOT_EDITABLE: "Finished deals can't be edited.",
  DUPLICATE: "A category with that name already exists.",
  INVALID_PARENT: "That parent category isn't allowed.",
  SELF_CHANGE: "You can't change your own role.",
  LAST_ADMIN: "There must always be at least one admin.",
};

export type Actor = { id: string; role: string };

import { Notice } from "@/components/admin/notice";
import { ADMIN_ERROR_MESSAGES, type AdminErrorCode } from "@/server/services/admin";

const NOTICES: Record<string, string> = {
  approve: "Deal approved.",
  reject: "Deal rejected.",
  publish: "Deal published.",
  expire: "Deal expired.",
  remove: "Deal removed.",
  saved: "Changes saved.",
  created: "Created.",
};

/** Shows the result of the last action from ?notice= / ?error= codes (never raw input). */
export function ActionMessages({ notice, error }: { notice?: string; error?: string }) {
  if (error) {
    const message =
      error in ADMIN_ERROR_MESSAGES
        ? ADMIN_ERROR_MESSAGES[error as AdminErrorCode]
        : "Please check the form and try again.";
    return <Notice tone="error">{message}</Notice>;
  }
  if (notice && notice in NOTICES) return <Notice tone="success">{NOTICES[notice]}</Notice>;
  return null;
}

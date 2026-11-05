import { getCurrentUser, hasRole } from "@/server/auth";
import { tweetIntentForDeal } from "@/server/services/admin";

// "Tap to tweet": opens X's compose screen with this deal's post filled in. Where editors land
// from a "tap to tweet" notification or the admin's "Tweet this" button. Free — no X API.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    const next = encodeURIComponent(`/admin/deals/${id}/tweet`);
    return Response.redirect(new URL(`/sign-in?next=${next}`, _request.url), 303);
  }
  if (!hasRole(user.role, "EDITOR")) return new Response("Not found", { status: 404 });
  const intent = await tweetIntentForDeal(id);
  if (!intent) {
    // Not live any more: show the deal in the admin instead.
    return Response.redirect(new URL(`/admin/deals/${encodeURIComponent(id)}`, _request.url), 303);
  }
  return new Response(null, {
    status: 303,
    headers: { Location: intent, "Cache-Control": "private, no-store" },
  });
}

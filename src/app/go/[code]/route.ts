import { after } from "next/server";
import { clientIp } from "@/server/affiliate";
import { outbound, type ClickRequest } from "@/server/services/affiliate";

// Outbound retailer links: record the click, then 302 to the retailer (docs/ARCHITECTURE.md §10).
// Never cached, never indexed.
export const dynamic = "force-dynamic";

const baseHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

type Context = { params: Promise<{ code: string }> };

async function handle(request: Request, { params }: Context, record: boolean) {
  const { code } = await params;
  const now = new Date();
  const ip = clientIp(request.headers);
  const result = await outbound.resolve(code, { ip }, now);

  if (result.kind === "rate-limited") {
    return new Response("Too many requests. Please try again shortly.", {
      status: 429,
      headers: { ...baseHeaders, "Retry-After": String(result.retryAfterSeconds) },
    });
  }
  if (result.kind === "not-found") {
    return new Response("This link isn't available.", {
      status: 404,
      headers: { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (record) {
    const url = new URL(request.url);
    const click: ClickRequest = {
      ip,
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
      placement: url.searchParams.get("p"),
      dealSlug: url.searchParams.get("deal"),
    };
    // Runs after the response is sent, so recording never delays or breaks the redirect.
    after(() => outbound.recordClick(result.target, result.ipHash, click, now));
  }
  return new Response(null, {
    status: 302,
    headers: { ...baseHeaders, Location: result.target.destinationUrl },
  });
}

export function GET(request: Request, context: Context) {
  return handle(request, context, true);
}

/** Link checkers and unfurlers often send HEAD: same answer, but no click is recorded. */
export function HEAD(request: Request, context: Context) {
  return handle(request, context, false);
}

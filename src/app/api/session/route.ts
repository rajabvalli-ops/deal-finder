import { getCurrentUser } from "@/server/auth";

// Who is signed in, for the header (pages are cached, so the header asks after loading).
// Separate from Better Auth's own endpoints so page views don't count against the sign-in
// rate limit. Returns only what the header shows.
export async function GET() {
  const user = await getCurrentUser();
  return Response.json(user ? { user: { email: user.email, role: user.role } } : { user: null }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

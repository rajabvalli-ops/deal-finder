import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Fast path only: sends visitors without a session cookie to sign in before /admin renders.
// It never grants access — every admin page and action checks the role on the server.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };

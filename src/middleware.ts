import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Check for NextAuth session token cookie
  const token =
    req.cookies.get("authjs.session-token") ??
    req.cookies.get("__Secure-authjs.session-token");
  const isLoggedIn = !!token;

  // Protected routes
  const protectedPaths = ["/dashboard", "/settings", "/admin"];
  const isProtected = protectedPaths.some((path) =>
    pathname.startsWith(path)
  );

  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect logged-in users away from login page
  if (pathname === "/login" && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*", "/admin/:path*", "/login"],
};

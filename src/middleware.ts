import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/authToken";

export async function middleware(req: NextRequest) {
  const role = await verifyToken(req.cookies.get("tm_auth")?.value, process.env.CRON_SECRET!);
  const path = req.nextUrl.pathname;
  const needsAdmin = path.startsWith("/admin") || path.startsWith("/research");

  if (!role || (needsAdmin && role !== "admin")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/research/:path*"],
};

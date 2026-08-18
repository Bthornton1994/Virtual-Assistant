import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_SESSION_COOKIE, LEGACY_SESSION_COOKIE } from "@/lib/auth-cookie";
import { resolveAuthRedirect } from "@/lib/auth-redirect";

/**
 * Session refresh and route protection only.
 * Authorization is re-checked in server code and RLS.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  if (request.cookies.has(LEGACY_SESSION_COOKIE)) {
    response.cookies.set(LEGACY_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  }

  const supabaseUser = await refreshSupabaseUser(request, response);
  const hasDemo = Boolean(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  const decision = resolveAuthRedirect({
    pathname: request.nextUrl.pathname,
    hasSupabaseUser: Boolean(supabaseUser),
    hasDemoSession: hasDemo,
    nextParam: request.nextUrl.searchParams.get("next"),
    loginError: request.nextUrl.searchParams.get("error"),
  });

  if (decision.type === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    url.search = "";
    if (decision.next) url.searchParams.set("next", decision.next);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie);
    });
    return redirect;
  }

  return response;
}

async function refreshSupabaseUser(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/app/:path*", "/ops/:path*", "/login"],
};

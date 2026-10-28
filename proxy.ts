import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth"];

// Refreshes the Supabase session cookie and sends signed-out visitors to /login.
// This is only an optimistic check: every page re-checks the profile, and RLS enforces access.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Pages a signed-out visitor may open. /reset-password is not here: the emailed link
  // signs the user in through /auth/callback first.
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  const isAuthPage = path === "/login" || path === "/signup" || path === "/forgot-password";
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // ?inactive=1 means the page guard rejected this user; let them reach /login to sign out.
  if (user && isAuthPage && !request.nextUrl.searchParams.has("inactive")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|ico)$).*)"],
};

// Next.js proxy (runs before matching requests). Only job: clear the one-time invite link cookie on the response to the
// first plain GET of a circle page that carries it; the page itself still reads the cookie from this request, so the
// link shows exactly once (4B review fix 5). Verified by tests/unit/circles-invite-guard.test.ts.
import { NextResponse, type NextRequest } from 'next/server';
import { CLEAR_FLASH, clearsFlash } from '@/lib/circles/invite-flash';

export function proxy(request: NextRequest): NextResponse {
  const res = NextResponse.next();
  if (clearsFlash({ method: request.method, pathname: request.nextUrl.pathname, headers: request.headers })) {
    res.headers.append('Set-Cookie', CLEAR_FLASH);
  }
  return res;
}

export const config = { matcher: '/circles/:slug' };

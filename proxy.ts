import { type NextRequest } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Run on all app routes except static assets/images/etc.
export const config = {
  matcher: [
    // Exclude any _next/* and common static files regardless of basePath
    '/((?!_next/|.*\\.(?:css|js|map|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2)$).*)',
  ],
};

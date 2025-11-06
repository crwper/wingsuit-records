import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            // ✅ Allowed in Server Actions/Route Handlers; will throw in RSC
            cookieStore.set({ name, value, ...options });
          } catch {
            // RSC render path: ignore (middleware handles refresh)
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options, expires: new Date(0) });
          } catch {
            // RSC render path: ignore
          }
        },
      },
    }
  );
}

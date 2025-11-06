import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  // Prepare a response we can attach cookies to
  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,          // you already have these in .env.local
    process.env.SUPABASE_ANON_KEY!,     // (anon/public key)
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          // ✅ Allowed here
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          response.cookies.set({
            name,
            value: '',
            ...options,
            expires: new Date(0),
          });
        },
      },
    }
  );

  // Trigger refresh if needed; any cookie writes happen on `response`
  await supabase.auth.getUser();

  return response;
}

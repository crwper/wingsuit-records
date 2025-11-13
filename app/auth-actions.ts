'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signupAction(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  // Basic validation
  if (!email) throw new Error('Email required');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    const qs = new URLSearchParams({ error: error.message });
    redirect(`/signup?${qs.toString()}`);
  }

  // If email confirmation is on, the session will be null until confirmed.
  redirect('/login?check-email=1');
}

export async function loginAction(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const nextRaw = String(formData.get('next') ?? '/');
  // Safety: only allow relative paths
  const next = nextRaw.startsWith('/') ? nextRaw : '/';

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Redirect back to /login so the page can show the red <Alert>
    const qs = new URLSearchParams({ error: error.message });
    redirect(`/login?${qs.toString()}`);
  }

  redirect(next);
}

export async function logoutAction() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
  redirect('/login');
}

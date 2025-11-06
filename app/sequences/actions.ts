'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function createSequenceAction(formData: FormData) {
  const supabase = await createClient();
  const title = String(formData.get('title') ?? '').trim();
  const base  = String(formData.get('base') ?? 'F1').trim() || 'F1';

  if (!title) throw new Error('Title is required');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  // Use your existing RPC or a direct insert, whichever you kept.
  // a) If you still have create_sequence(title, base):
  // const { error } = await supabase.rpc('create_sequence', { p_title: title, p_base_flyer_id: base });

  // b) Direct insert (owner-only via RLS):
  const { error } = await supabase
    .from('sequences')
    .insert({ title, base_flyer_id: base, owner_user_id: user.id });

  if (error) throw new Error(error.message);

  revalidatePath('/sequences');
}

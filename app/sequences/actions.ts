// app/sequences/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function createSequenceAction(formData: FormData) {
  const supabase = await createClient();
  const title = String(formData.get('title') ?? '').trim();
  if (!title) throw new Error('Title is required');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const { error } = await supabase
    .from('sequences')
    .insert({ title, owner_user_id: user.id });

  if (error) throw new Error(error.message);
  revalidatePath('/sequences');
}

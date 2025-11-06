'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function createFormationAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  const title = String(formData.get('title') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const { error } = await supabase.rpc('create_formation', {
    p_title: title,
    p_notes: notes,
  });
  if (error) throw new Error(error.message);

  revalidatePath('/formations');
}

export async function deleteFormationAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing formation id');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Must be signed in');

  // RLS ensures only the owner can delete.
  const { error } = await supabase.from('formations').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/formations');
}

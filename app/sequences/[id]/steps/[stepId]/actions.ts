'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function swapFlyersAction(formData: FormData) {
  const supabase = await createClient();

  const sequenceId = String(formData.get('sequenceId') ?? '');
  const stepId     = String(formData.get('stepId') ?? '');
  const flyerA     = String(formData.get('flyerA') ?? '').trim();
  const flyerB     = String(formData.get('flyerB') ?? '').trim();

  if (!sequenceId || !stepId || !flyerA || !flyerB) {
    throw new Error('Missing fields');
  }

  const { error } = await supabase.rpc('swap_step_flyers', {
    p_sequence_step_id: stepId,
    p_flyer_a: flyerA,
    p_flyer_b: flyerB,
  });

  if (error) throw new Error(error.message);

  // Revalidate both the step page and the parent sequence page
  revalidatePath(`/sequences/${sequenceId}/steps/${stepId}`);
  revalidatePath(`/sequences/${sequenceId}`);
}

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

function parseRoster(text: string): string[] {
  // split on newlines or commas, keep order of first occurrence
  const raw = text.split(/[\n,]/g).map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of raw) if (!seen.has(f)) { seen.add(f); out.push(f); }
  return out;
}

export async function saveRosterAction(formData: FormData) {
  const supabase = await createClient();
  const sequenceId = String(formData.get('sequenceId') ?? '');
  const rosterText = String(formData.get('roster') ?? '');
  if (!sequenceId) throw new Error('Missing sequence id');

  // Same parser as before
  const raw = rosterText.split(/[\n,]/g).map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const roster: string[] = [];
  for (const f of raw) if (!seen.has(f)) { seen.add(f); roster.push(f); }

  const { error } = await supabase.rpc('save_sequence_roster', {
    p_sequence_id: sequenceId,
    p_roster: roster,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/sequences/${sequenceId}`);
}

export async function addStepAction(formData: FormData) {
  const supabase = await createClient();
  const sequenceId = String(formData.get('sequenceId') ?? '');
  const formationId = String(formData.get('formationId') ?? '');
  const label = String(formData.get('label') ?? '').trim() || null;

  if (!sequenceId || !formationId) throw new Error('Missing ids');

  const { data: stepId, error } = await supabase.rpc('add_sequence_step', {
    p_sequence_id: sequenceId,
    p_formation_id: formationId,
    p_label: label,
  });
  if (error) throw new Error(error.message);

  // Auto-assign mapping immediately
  const { error: autoErr } = await supabase.rpc('auto_assign_step', {
    p_sequence_step_id: stepId,
  });
  if (autoErr) throw new Error(autoErr.message);

  revalidatePath(`/sequences/${sequenceId}`);
}

export async function autoAssignStepAction(formData: FormData) {
  const supabase = await createClient();
  const sequenceId = String(formData.get('sequenceId') ?? '');
  const stepId = String(formData.get('stepId') ?? '');
  if (!sequenceId || !stepId) throw new Error('Missing ids');

  const { error } = await supabase.rpc('auto_assign_step', { p_sequence_step_id: stepId });
  if (error) throw new Error(error.message);

  revalidatePath(`/sequences/${sequenceId}`);
}

export async function computeDifferencesAction(formData: FormData) {
  const sequenceId = String(formData.get('sequenceId') ?? '');
  if (!sequenceId) throw new Error('Missing sequence id');

  const supabase = await createClient();
  const { error } = await supabase.rpc('compute_adjacency_for_sequence', {
    p_sequence_id: sequenceId,
    p_wrap: true, // include last→first
  });
  if (error) throw new Error(error.message);

  const { revalidatePath } = await import('next/cache');
  revalidatePath(`/sequences/${sequenceId}`);
}

export async function deleteStepAction(formData: FormData) {
  const supabase = await createClient();
  const sequenceId = String(formData.get('sequenceId') ?? '');
  const stepId     = String(formData.get('stepId') ?? '');
  if (!sequenceId || !stepId) throw new Error('Missing ids');

  const { error } = await supabase.rpc('delete_step_and_compact', {
    p_sequence_id: sequenceId,
    p_step_id: stepId,
  });
  if (error) throw new Error(error.message);

  // Recompute differences so HUD stays accurate after reindex
  await supabase.rpc('compute_adjacency_for_sequence', {
    p_sequence_id: sequenceId,
    p_wrap: true,
  });

  const { revalidatePath } = await import('next/cache');
  revalidatePath(`/sequences/${sequenceId}`);
}

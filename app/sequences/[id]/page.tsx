import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { addStepAction, saveRosterAction, autoAssignStepAction } from './actions';

export default async function SequenceEditorPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // sequence
  const { data: sequence, error: seqErr } = await supabase
    .from('sequences')
    .select('id, title, base_flyer_id, created_at')
    .eq('id', id)
    .single();
  if (seqErr || !sequence) return notFound();

  // roster
  const { data: rosterData, error: rosterErr } = await supabase
    .from('sequence_roster')
    .select('flyer_id, roster_index')
    .eq('sequence_id', id)
    .order('roster_index', { ascending: true });
  const roster = rosterData ?? [];

  // formations owned by me (for Add Step dropdown)
  const { data: formationsData, error: formationsErr } = await supabase
    .from('formations')
    .select('id, title')
    .order('created_at', { ascending: false });
  const formations = formationsData ?? [];

  const formationMap = new Map<string, string>();
  for (const f of formations) formationMap.set(f.id, f.title);

  // steps
  const { data: stepsData, error: stepsErr } = await supabase
    .from('sequence_steps')
    .select('id, step_index, label, formation_id')
    .eq('sequence_id', id)
    .order('step_index', { ascending: true });
  const steps = stepsData ?? [];

  // count assignments per step (guard nulls)
  const stepIds = steps.map((s) => s.id);
  let counts: Record<string, number> = {};
  if (stepIds.length > 0) {
    const { data: aData, error: aErr } = await supabase
      .from('step_assignments')
      .select('sequence_step_id')
      .in('sequence_step_id', stepIds);

    const a = aData ?? [];
    for (const row of a) {
      counts[row.sequence_step_id] = (counts[row.sequence_step_id] ?? 0) + 1;
    }
  }

  const rosterStr = roster.map((r) => r.flyer_id).join('\n');

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8 bg-slate-50">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{sequence.title}</h1>
          <p className="text-xs text-gray-600">
            Sequence editor • Created {new Date(sequence.created_at).toLocaleString()}
          </p>
        </div>
        <Link href="/sequences" className="text-sm underline">Back to sequences</Link>
      </header>

      {/* Helpful error hints, optional */}
      {(rosterErr || formationsErr || stepsErr) && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {rosterErr && <div>Roster error: {rosterErr.message}</div>}
          {formationsErr && <div>Formations error: {formationsErr.message}</div>}
          {stepsErr && <div>Steps error: {stepsErr.message}</div>}
        </div>
      )}

      {/* Roster form */}
      <section className="rounded border bg-white p-4 space-y-3">
        <div className="font-semibold">Roster</div>
        <form action={saveRosterAction} className="space-y-3">
          <input type="hidden" name="sequenceId" value={sequence.id} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Flyer IDs (one per line or comma-separated)</label>
              <textarea name="roster" rows={6} className="w-full rounded border p-2 text-sm"
                defaultValue={rosterStr} placeholder={'F1\nF2\nF3'} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Base flyer ID</label>
              <input name="base" className="w-full rounded border p-2 text-sm"
                defaultValue={sequence.base_flyer_id ?? ''} placeholder="F1" />
              <p className="text-xs text-gray-600 mt-2">
                The roster must contain the base flyer exactly once. Order on the left is saved.
              </p>
            </div>
          </div>
          <button className="rounded bg-black px-3 py-2 text-white text-sm">Save roster</button>
        </form>
      </section>

      {/* Add step */}
      <section className="rounded border bg-white p-4 space-y-3">
        <div className="font-semibold">Add step</div>
        <form action={addStepAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="sequenceId" value={sequence.id} />
          <div>
            <label className="block text-xs text-gray-600 mb-1">Formation</label>
            <select name="formationId" className="rounded border p-2 text-sm">
              {formations.map(f => (
                <option key={f.id} value={f.id}>{f.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Label (optional)</label>
            <input name="label" className="rounded border p-2 text-sm" placeholder="e.g., Exit" />
          </div>
          <button className="rounded bg-black px-3 py-2 text-white text-sm">Add step</button>
          <p className="text-xs text-gray-600">
            Formation must have the same number of cells as the roster. We’ll auto‑assign flyers.
          </p>
        </form>
      </section>

      {/* Steps list */}
      <section className="rounded border bg-white p-4 space-y-3">
        <div className="font-semibold">Steps</div>
        {steps.length === 0 ? (
          <div className="text-sm text-gray-600">No steps yet.</div>
        ) : (
          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s.id} className="rounded border p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    #{s.step_index} • {s.label ?? 'Untitled'} — {formationMap.get(s.formation_id) ?? 'Formation'}
                  </div>
                  <form action={autoAssignStepAction}>
                    <input type="hidden" name="sequenceId" value={sequence.id} />
                    <input type="hidden" name="stepId" value={s.id} />
                    <button className="text-sm underline">Auto‑assign</button>
                  </form>
                </div>
                <div className="text-xs text-gray-600">
                  Assignments: {counts[s.id] ?? 0} / {roster.length}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

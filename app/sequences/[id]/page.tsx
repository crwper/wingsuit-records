import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {addStepAction, saveRosterAction, autoAssignStepAction, computeDifferencesAction } from './actions';
import DeleteStepWithConfirm from '@/components/DeleteStepWithConfirm';

export default async function SequenceEditorPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // sequence
  const { data: sequence, error: seqErr } = await supabase
    .from('sequences')
    .select('id, title, created_at')
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
    .rpc('formations_matching_roster', { p_sequence_id: id });
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

  const stepIds = steps.map((s) => s.id);

  let checks: Array<{
    step_a_id: string;
    step_b_id: string;
    rotation_deg: number;
    tx: number;
    ty: number;
    max_overlap_count: number;
    n_size: number;
    threshold: number;
    different: boolean;
    computed_at: string;
  }> = [];

  if (stepIds.length > 0) {
    const { data: checksData } = await supabase
      .from('adjacency_checks')
      .select('step_a_id, step_b_id, rotation_deg, tx, ty, max_overlap_count, n_size, threshold, different, computed_at')
      .in('step_a_id', stepIds)
      .in('step_b_id', stepIds);
    checks = checksData ?? [];
  }

  // Build a map for quick lookup
  const checkMap = new Map<string, (typeof checks)[number]>();
  for (const c of checks) checkMap.set(`${c.step_a_id}->${c.step_b_id}`, c);

  // Build the ordered adjacent pairs (include wrap-around)
  const pairs: Array<{ a: typeof steps[number]; b: typeof steps[number] }> = [];
  if (steps.length > 0) {
    for (let i = 0; i < steps.length; i++) {
      const a = steps[i];
      const b = steps[(i + 1) % steps.length];
      pairs.push({ a, b });
    }
  }

  // count assignments per step (guard nulls)
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
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Flyer IDs (one per line or comma-separated)
            </label>
            <textarea
              name="roster"
              rows={6}
              className="w-full rounded border p-2 text-sm"
              defaultValue={roster.map(r => r.flyer_id).join('\n')}
              placeholder={'F1\nF2\nF3'}
            />
          </div>
          <button className="rounded bg-black px-3 py-2 text-white text-sm">
            Save roster
          </button>
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
            Only formations with the same number of cells as the roster are shown.
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
                  <div className="flex items-center gap-3">
                    {/* (We’ll remove Auto-assign later per R-5, leaving it for now) */}
                    <form action={autoAssignStepAction}>
                      <input type="hidden" name="sequenceId" value={sequence.id} />
                      <input type="hidden" name="stepId" value={s.id} />
                      <button className="text-sm underline">Auto-assign</button>
                    </form>
                    <Link className="text-sm underline" href={`/sequences/${sequence.id}/steps/${s.id}`}>
                      Edit mapping
                    </Link>
                    {/* NEW: Delete step */}
                    <DeleteStepWithConfirm sequenceId={sequence.id} stepId={s.id} />
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  Assignments: {counts[s.id] ?? 0} / {roster.length}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Differences HUD */}
      <section className="rounded border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Differences (adjacent pairs{steps.length > 1 ? ' incl. wrap' : ''})</div>
          <form action={computeDifferencesAction}>
            <input type="hidden" name="sequenceId" value={sequence.id} />
            <button className="text-sm underline">Recompute differences</button>
          </form>
        </div>

        {pairs.length <= 1 ? (
          <div className="text-sm text-gray-600">Add at least two steps to compute differences.</div>
        ) : (
          <ul className="space-y-2">
            {pairs.map(({ a, b }) => {
              const c = checkMap.get(`${a.id}->${b.id}`);
              return (
                <li key={`${a.id}->${b.id}`} className="rounded border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      Step #{a.step_index} → #{b.step_index}
                    </div>
                    <div className={`text-xs ${c ? (c.different ? 'text-green-700' : 'text-red-700') : 'text-gray-500'}`}>
                      {c
                        ? (c.different
                            ? `PASS (different): overlap ${c.max_overlap_count}/${c.n_size}, threshold ${c.threshold}, rotation ${c.rotation_deg}°, t=(${c.tx},${c.ty})`
                            : `FAIL (not different): overlap ${c.max_overlap_count}/${c.n_size}, threshold ${c.threshold}, rotation ${c.rotation_deg}°, t=(${c.tx},${c.ty})`)
                        : 'Not computed yet'}
                    </div>
                  </div>
                  {c && (
                    <div className="text-[11px] text-gray-600">
                      Computed {new Date(c.computed_at).toLocaleString()}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

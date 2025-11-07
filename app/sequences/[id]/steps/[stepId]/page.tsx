import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { swapFlyersAction } from './actions';
import StepMappingVisual from '@/components/StepMappingVisual';

export default async function StepMappingPage({
  params,
}: {
  params: Promise<{ id: string; stepId: string }>;
}) {
  const { id: sequenceId, stepId } = await params;
  const supabase = await createClient();

  // Load step + sequence (ensures owner via RLS)
  const { data: step, error: stErr } = await supabase
    .from('sequence_steps')
    .select('id, step_index, label, formation_id, sequence_id')
    .eq('id', stepId)
    .single();
  if (stErr || !step) return notFound();

  // Roster (ordered)
  const { data: rosterData } = await supabase
    .from('sequence_roster')
    .select('flyer_id, roster_index')
    .eq('sequence_id', sequenceId)
    .order('roster_index', { ascending: true });
  const roster = rosterData ?? [];

  // Assignments (flyer -> cell_index)
  const { data: assignsData } = await supabase
    .from('step_assignments')
    .select('flyer_id, formation_cell_index')
    .eq('sequence_step_id', stepId);
  const assignments = assignsData ?? [];

  // Formation cells (cell_index -> col,row)
  const { data: cellsData } = await supabase
    .from('formation_cells')
    .select('cell_index, col, row')
    .eq('formation_id', step.formation_id)
    .order('row', { ascending: true })
    .order('col', { ascending: true });
  const cells = cellsData ?? [];

  // Fetch the stored view rotation
  const { data: formationView } = await supabase
    .from('formations')
    .select('view_rotation_deg')
    .eq('id', step.formation_id)
    .single();
  const viewRotationDeg = formationView?.view_rotation_deg ?? 0;

  // Map helpers
  const cellByIndex = new Map<number, { col: number; row: number }>();
  for (const c of cells) cellByIndex.set(c.cell_index, { col: c.col, row: c.row });

  const cellIndexByFlyer = new Map<string, number>();
  for (const a of assignments) cellIndexByFlyer.set(a.flyer_id, a.formation_cell_index);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6 bg-slate-50">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Step #{step.step_index} {step.label ? `• ${step.label}` : ''}
          </h1>
          <p className="text-xs text-gray-600">Mapping editor</p>
        </div>
        <div className="flex items-center gap-3">
          <Link className="text-sm underline" href={`/sequences/${sequenceId}`}>
            Back to sequence
          </Link>
        </div>
      </header>

      {/* Visual mapping */}
      <section className="rounded border bg-white p-4 space-y-3">
        <div className="font-semibold">Current mapping</div>
        <StepMappingVisual
          cells={cells as { cell_index: number; col: number; row: number }[]}
          roster={(roster as { flyer_id: string; roster_index: number }[]).sort((a, b) => a.roster_index - b.roster_index)}
          assignments={assignments as { flyer_id: string; formation_cell_index: number }[]}
          cellSize={32}
          viewRotationDeg={viewRotationDeg}                 // ← pass rotation
        />
      </section>

      {/* Swap control */}
      <section className="rounded border bg-white p-4 space-y-3">
        <div className="font-semibold">Swap two flyers</div>
        <SwapForm sequenceId={sequenceId} stepId={stepId} roster={roster.map(r => r.flyer_id)} />
        <p className="text-xs text-gray-600">
          Swapping preserves validity and is an easy way to explore different mappings.
        </p>
      </section>
    </main>
  );
}

function SwapForm({
  sequenceId,
  stepId,
  roster,
}: {
  sequenceId: string;
  stepId: string;
  roster: string[];
}) {
  return (
    <form action={swapFlyersAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sequenceId" value={sequenceId} />
      <input type="hidden" name="stepId" value={stepId} />
      <div>
        <label className="block text-xs text-gray-600 mb-1">Flyer A</label>
        <select name="flyerA" className="rounded border p-2 text-sm">
          {roster.map((id) => (
            <option key={`A-${id}`} value={id}>{id}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Flyer B</label>
        <select name="flyerB" className="rounded border p-2 text-sm">
          {roster.map((id) => (
            <option key={`B-${id}`} value={id}>{id}</option>
          ))}
        </select>
      </div>
      <button className="rounded bg-black px-3 py-2 text-white text-sm">
        Swap
      </button>
    </form>
  );
}

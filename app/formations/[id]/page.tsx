// app/formations/[id]/page.tsx
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import FormationGridEditor from '@/components/FormationGridEditor';

export default async function FormationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: formation, error: fErr } = await supabase
    .from('formations')
    .select('id, title, notes, created_at, updated_at, version, view_rotation_deg') // ← add
    .eq('id', id)
    .single();

  if (fErr || !formation) return notFound();

  const { data: cells = [] } = await supabase
    .from('formation_cells')
    .select('col, row')
    .eq('formation_id', id)
    .order('row', { ascending: true })
    .order('col', { ascending: true });

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6 bg-slate-50">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{formation.title}</h1>
          <p className="text-xs text-gray-600">
            Formation editor • Version {formation.version}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/formations" className="text-sm underline">Back to formations</Link>
        </div>
      </header>

      <section className="rounded border bg-white p-4">
        <FormationGridEditor
          formationId={formation.id}
          initialCells={cells as { col: number; row: number }[]}
          viewRotationDeg={formation.view_rotation_deg ?? 0}  // ← pass down
        />
      </section>
    </main>
  );
}

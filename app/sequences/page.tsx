import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { createSequenceAction } from './actions';

export default async function SequencesPage() {
  const supabase = await createClient();

  const { data: sequences, error } = await supabase
    .from('sequences')
    .select('id, title, base_flyer_id, status, created_at')
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 bg-slate-50">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sequences</h1>
        <Link className="text-sm underline" href="/">Home</Link>
      </header>

      <form action={createSequenceAction} className="rounded border bg-white p-3 space-y-3">
        <div className="font-semibold">Create a sequence</div>
        <div className="flex gap-2">
          <input name="title" required placeholder="e.g., WS State Record 2025" className="flex-1 rounded border p-2" />
          <input name="base" placeholder="F1" defaultValue="F1" className="w-24 rounded border p-2" />
        </div>
        <button className="rounded bg-black px-3 py-2 text-white">Create</button>
      </form>

      <section className="space-y-2">
        <h2 className="font-semibold">Your sequences</h2>
        {error && <div className="text-red-600 text-sm">Error: {error.message}</div>}
        <ul className="space-y-2">
          {(sequences ?? []).map((s) => (
            <li key={s.id} className="rounded border bg-white p-3">
              <div className="font-medium">
                <Link className="underline" href={`/sequences/${s.id}`}>{s.title}</Link>
              </div>
              <div className="text-xs text-gray-600">
                Base: {s.base_flyer_id ?? '—'} • Created: {new Date(s.created_at).toLocaleString()}
              </div>
            </li>
          ))}
          {(!sequences || sequences.length === 0) && (
            <li className="text-sm text-gray-600">No sequences yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}

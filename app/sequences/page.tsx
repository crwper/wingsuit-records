// app/sequences/page.tsx
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export default async function SequencesPage() {
  const supabase = await createClient();

  // Query only sequences you’re a member of (RLS enforces this)
  const { data: sequences, error } = await supabase
    .from('sequences')
    .select('id, title, base_flyer_id, status, created_at, updated_at')
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 bg-slate-50">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sequences</h1>
        <Link className="text-sm underline" href="/">Home</Link>
      </header>

      <CreateForm />

      <section className="space-y-2">
        <h2 className="font-semibold">Your sequences</h2>
        {error && <div className="text-red-600 text-sm">Error: {error.message}</div>}
        <ul className="space-y-2">
          {(sequences ?? []).map((s) => (
            <li key={s.id} className="rounded border bg-white p-3">
              <div className="font-medium">{s.title}</div>
              <div className="text-xs text-gray-600">
                Base: {s.base_flyer_id} • Status: {s.status} • Created: {new Date(s.created_at).toLocaleString()}
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

async function CreateForm() {
  async function createSequence(formData: FormData) {
    'use server';
    const title = String(formData.get('title') ?? '').trim();
    const base = String(formData.get('base') ?? 'F1').trim() || 'F1';

    const supabase = await (await import('@/lib/supabase/server')).createClient();
    const { error } = await supabase.rpc('create_sequence', {
      p_title: title,
      p_base_flyer_id: base,
    });

    if (error) {
      throw new Error(error.message);
    }

    // Revalidate this page so the new row appears
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/sequences');
  }

  return (
    <form action={createSequence} className="rounded border bg-white p-3 space-y-3">
      <div className="font-semibold">Create a sequence</div>
      <div className="flex gap-2">
        <input
          name="title"
          placeholder="e.g., WS State Record 2025"
          required
          className="flex-1 rounded border p-2"
        />
        <input
          name="base"
          placeholder="F1"
          defaultValue="F1"
          className="w-24 rounded border p-2"
        />
      </div>
      <button className="rounded bg-black px-3 py-2 text-white">Create</button>
      <p className="text-xs text-gray-600">
        Owner = currently signed-in user. Base flyer ID is just a text label (we’ll enforce roster in a later milestone).
      </p>
    </form>
  );
}

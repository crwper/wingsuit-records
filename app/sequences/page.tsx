import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { createSequenceAction } from './actions';
import { redirect } from 'next/navigation';

export default async function SequencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // If not signed in, send to login first; come back here after
  if (!user) {
    redirect(`/login?next=${encodeURIComponent('/sequences')}`);
  }

  const { data: sequences, error } = await supabase
    .from('sequences')
    .select('id, title, status, created_at')
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 bg-canvas">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sequences</h1>
      </header>

      <form action={createSequenceAction} className="rounded border bg-card p-3 space-y-3">
        <div className="font-semibold">Create a sequence</div>
        <div className="flex gap-2">
          <input name="title" required placeholder="e.g., WS State Record 2025" className="flex-1 rounded border p-2" />
        </div>
        <button className="rounded border px-3 py-1 text-sm hover:bg-control-hover">Create</button>
      </form>

      <section className="space-y-2">
        <h2 className="font-semibold">Your sequences</h2>
        {/* ... */}
        {(sequences ?? []).map((s) => (
          <li key={s.id} className="rounded border bg-card p-3">
            <div className="font-medium">
              <Link className="underline" href={`/sequences/${s.id}`}>{s.title}</Link>
            </div>
            <div className="text-xs text-muted-foreground">
              Created: {new Date(s.created_at).toLocaleString()}
            </div>
          </li>
        ))}
      </section>
    </main>
  );
}

import { createClient } from '@/lib/supabase/server';
import { createFormationAction } from './actions';
import Link from 'next/link';
import DeleteWithConfirm from '@/components/DeleteWithConfirm';
import { redirect } from 'next/navigation';

export default async function FormationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // If not signed in, send to login first; come back here after
  if (!user) {
    redirect(`/login?next=${encodeURIComponent('/formations')}`);
  }

  // List only your formations (RLS enforces ownership)
  const { data: formations, error } = await supabase
    .from('formations')
    .select('id, title, notes, created_at, updated_at')
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6 bg-canvas">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Formations</h1>
      </header>

      {/* Create new formation */}
      <form action={createFormationAction} className="rounded border bg-card p-4 space-y-2">
        <div className="font-semibold">New formation</div>
        <input
          name="title"
          required
          placeholder="e.g., Base diamond"
          className="w-full border rounded px-2 py-1 text-sm"
        />
        <textarea
          name="notes"
          placeholder="(optional) notes"
          className="w-full border rounded px-2 py-1 text-sm"
          rows={2}
        />
        <button className="rounded border px-3 py-1 text-sm hover:bg-control-hover">Create</button>
      </form>

      {/* Your list */}
      <section className="space-y-2">
        <h2 className="font-semibold">Your formations</h2>
        {error && <div className="text-sm text-red-600">Error: {error.message}</div>}
        <ul className="space-y-2">
          {(formations ?? []).map(f => (
            <li key={f.id} className="rounded border bg-card p-3">
              <div className="font-medium">{f.title}</div>
              <div className="text-xs text-muted-foreground">
                Created: {new Date(f.created_at).toLocaleString()}
                {f.updated_at && ' • Updated: ' + new Date(f.updated_at).toLocaleString()}
              </div>
              {f.notes && <div className="mt-1 text-sm text-muted-foreground">{f.notes}</div>}

              <div className="mt-2 flex items-center gap-3">
                <Link className="text-sm underline" href={`/formations/${f.id}`}>Edit</Link>
                <DeleteWithConfirm id={f.id} title={f.title} />
              </div>
            </li>
          ))}
          {(!formations || formations.length === 0) && (
            <li className="text-sm text-muted-foreground">No formations yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}

// app/page.tsx
import WhereServer from '@/components/WhereServer';
import WhereClient from '@/components/WhereClient';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient(); // ← await the async helper
  const { data: dbNow, error } = await supabase.rpc('db_now');

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4 font-sans bg-slate-50">
      <h1 className="text-2xl font-bold">Hello, Dog Tracker 👋</h1>
      <p>Milestone 4: Supabase RPC round-trip.</p>

      <div className="rounded-lg border p-3 bg-white">
        <div className="font-medium">Supabase says the time is:</div>
        <div className="text-sm text-gray-600">
          {error ? `Error: ${error.message}` : String(dbNow)}
        </div>
      </div>

      <WhereServer />
      <WhereClient />
    </main>
  );
}

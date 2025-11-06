// app/page.tsx
import WhereServer from '@/components/WhereServer';
import WhereClient from '@/components/WhereClient';

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Hello, Dog Tracker 👋</h1>
      <p>Milestone 2: server vs client components.</p>

      <WhereServer />
      <WhereClient />
    </main>
  );
}

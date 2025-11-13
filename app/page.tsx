// app/page.tsx
import { redirect } from 'next/navigation';

export default function Home() {
  // Always land on Formations; that page (optionally) gates auth itself.
  redirect('/formations');
}

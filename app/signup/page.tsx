import Link from 'next/link';
import { signupAction } from '../auth-actions';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const err = typeof sp.error === 'string' ? sp.error : null;
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-xl font-bold">Create account</h1>
      {err && <p className="text-sm text-red-600">Error: {err}</p>}
      <form action={signupAction} className="space-y-3">
        <div className="flex flex-col">
          <label className="text-xs text-gray-600">Email</label>
          <input name="email" type="email" required className="border rounded px-2 py-1" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600">Password</label>
          <input name="password" type="password" required minLength={6} className="border rounded px-2 py-1" />
        </div>
        <button type="submit" className="rounded border px-3 py-1 text-sm hover:bg-gray-50">Sign up</button>
      </form>
      <p className="text-sm text-gray-600">
        Already have an account? <Link className="underline" href="/login">Log in</Link>
      </p>
    </main>
  );
}

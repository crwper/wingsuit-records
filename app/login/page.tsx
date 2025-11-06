import Link from 'next/link';
import { loginAction } from '../auth-actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const checkEmail = !!sp['check-email'];
  const err = typeof sp.error === 'string' ? sp.error : null;
  const next = typeof sp.next === 'string' ? sp.next : '/';

  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-xl font-bold">Log in</h1>
      {checkEmail && <p className="text-sm text-green-700">Check your email to confirm your account, then log in.</p>}
      {err && <p className="text-sm text-red-600">Error: {err}</p>}
      <form action={loginAction} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col">
          <label className="text-xs text-gray-600">Email</label>
          <input name="email" type="email" required className="border rounded px-2 py-1" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600">Password</label>
          <input name="password" type="password" required className="border rounded px-2 py-1" />
        </div>
        <button type="submit" className="rounded border px-3 py-1 text-sm hover:bg-gray-50">Log in</button>
      </form>
      <p className="text-sm text-gray-600">
        No account? <Link className="underline" href="/signup">Sign up</Link>
      </p>
    </main>
  );
}

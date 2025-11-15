// components/AppNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AppNav() {
  const pathname = usePathname() || '';

  const isFormations = pathname.startsWith('/formations');
  const isSequences  = pathname.startsWith('/sequences');

  const base =
    'rounded px-3 py-1 text-sm border hover:bg-nav-item-hover focus:outline-none focus:ring-2 focus:ring-control-ring';
  const active = 'bg-nav-item-active font-medium';

  return (
    <nav className="border-t bg-header">
      <div className="mx-auto max-w-2xl p-2">
        <ul className="flex items-center gap-2">
          <li>
            <Link
              href="/formations"
              className={`${base} ${isFormations ? active : ''}`}
              aria-current={isFormations ? 'page' : undefined}
            >
              Formations
            </Link>
          </li>
          <li>
            <Link
              href="/sequences"
              className={`${base} ${isSequences ? active : ''}`}
              aria-current={isSequences ? 'page' : undefined}
            >
              Sequences
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}

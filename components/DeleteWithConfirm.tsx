'use client';

import { useFormStatus } from 'react-dom';
import { deleteFormationAction } from '@/app/formations/actions';

function SubmitDeleteButton({ title }: { title?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="text-sm underline text-danger-fg cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      aria-disabled={pending}
      aria-label={title ? `Delete ${title}` : 'Delete formation'}
    >
      {pending ? 'Deleting…' : 'Delete'}
    </button>
  );
}

export default function DeleteWithConfirm({
  id,
  title,
}: {
  id: string;
  title?: string;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const name = title ? `“${title}”` : 'this formation';
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) {
      e.preventDefault();
    }
  }

  return (
    <form action={deleteFormationAction} onSubmit={onSubmit} className="inline">
      <input type="hidden" name="id" value={id} />
      <SubmitDeleteButton title={title} />
    </form>
  );
}

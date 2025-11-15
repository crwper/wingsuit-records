'use client';

import { useFormStatus } from 'react-dom';
import { deleteStepAction } from '@/app/sequences/[id]/actions';

function Submit({label}:{label?:string}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="text-sm underline text-danger-fg cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? 'Deleting…' : (label ?? 'Delete')}
    </button>
  );
}

export default function DeleteStepWithConfirm({
  sequenceId,
  stepId,
  label,
}: {
  sequenceId: string;
  stepId: string;
  label?: string;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!window.confirm('Delete this step? This cannot be undone.')) {
      e.preventDefault();
    }
  }
  return (
    <form action={deleteStepAction} onSubmit={onSubmit} className="inline">
      <input type="hidden" name="sequenceId" value={sequenceId} />
      <input type="hidden" name="stepId" value={stepId} />
      <Submit label={label} />
    </form>
  );
}

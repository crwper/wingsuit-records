// components/primitives/Alert.tsx
import * as React from 'react';

type Tone = 'info' | 'success' | 'warning' | 'error';

const toneClasses: Record<Tone, string> = {
  info:    'text-alert-info-fg bg-alert-info-surface border-alert-info-border',
  success: 'text-alert-success-fg bg-alert-success-surface border-alert-success-border',
  warning: 'text-alert-warning-fg bg-alert-warning-surface border-alert-warning-border',
  error:   'text-alert-error-fg bg-alert-error-surface border-alert-error-border',
};

const iconFor = (tone: Tone) => {
  const common = { className: 'h-4 w-4', 'aria-hidden': true } as const;
  switch (tone) {
    case 'success':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...common}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'warning':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...common}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12" y2="17" />
        </svg>
      );
    case 'error':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case 'info':
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="8" />
        </svg>
      );
  }
};

export default function Alert({
  tone = 'info',
  className = '',
  children,
  withIcon = true,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
  /** show a small inline icon at the start */
  withIcon?: boolean;
}) {
  const role = tone === 'error' || tone === 'warning' ? 'alert' : 'status';

  return (
    <div
      role={role}
      className={`
        text-sm border rounded px-3 py-2
        flex items-start gap-2
        ${toneClasses[tone]} ${className}
      `}
    >
      {withIcon ? <span className="mt-[2px]">{iconFor(tone)}</span> : null}
      <div>{children}</div>
    </div>
  );
}

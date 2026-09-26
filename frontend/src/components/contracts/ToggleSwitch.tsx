import type { ReactNode } from 'react';

import { cn } from '@/lib/format';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  /** Announced to screen readers when the visible label is terse. */
  description?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A compact instrument switch. Used for "analyse on upload" and for the
 * verifier-enabled ablation toggle, so the product can be run with its own
 * differentiator turned off.
 */
export default function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={description}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5',
        'text-xs text-muted transition-colors duration-240 ease-instrument',
        'hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked && 'text-text',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full border transition-colors duration-240 ease-instrument',
          checked
            ? 'border-[rgb(var(--accent-rgb)/0.5)] bg-[rgb(var(--accent-rgb)/0.28)]'
            : 'border-border bg-[rgb(var(--surface-rgb)/0.06)]',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] h-[10px] w-[10px] rounded-full transition-[left,background-color] duration-240 ease-instrument',
            checked ? 'left-[14px] bg-accent' : 'left-[2px] bg-muted',
          )}
        />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

import { useEffect, type ReactNode } from 'react';
import { Icon, type IconName } from './Icons';

export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}

export function Meter({ value, accent = false }: { value: number; accent?: boolean }) {
  const width = `${Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100}%`;
  return (
    <span className={`meter ${accent ? 'meter--accent' : ''}`}>
      <span className="meter__fill" style={{ width }} />
    </span>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
  wrap = false,
  disabled = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
  wrap?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`seg ${wrap ? 'is-wrap' : ''}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`seg__btn ${option.value === value ? 'is-active' : ''}`}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__dot" />
    </button>
  );
}

export function NumField({
  value,
  min,
  max,
  step = 1,
  suffix,
  label,
  onChange,
  disabled = false,
}: {
  value: number;
  min: number;
  /** Omit for no UI ceiling; the API still decides what it can generate. */
  max?: number;
  step?: number;
  suffix?: string;
  label: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <span className="numfield">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, next)));
        }}
      />
      {suffix ? <span className="numfield__suffix">{suffix}</span> : null}
    </span>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {body ? <p className="empty__body">{body}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div
        className={`sheet ${wide ? 'sheet--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Note({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' }) {
  return <p className={`notice ${tone === 'warn' ? 'notice--warn' : ''}`}>{children}</p>;
}

export type { IconName };

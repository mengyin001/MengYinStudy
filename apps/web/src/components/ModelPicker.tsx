import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Icon } from './Icons';
import { ProviderIcon } from './ProviderIcon';

/** One row of the model menu. */
export interface ModelPickerOption {
  value: string;
  /** Display name, shown large. */
  label: string;
  providerId: string;
  /** Provider name, shown small under the model name. */
  providerLabel: string;
  /** Points charged per question; 0 renders the free badge. */
  multiplier: number;
  /** Extra small text, e.g. "not configured" or "needs a paid plan". */
  note?: string;
  disabled?: boolean;
  /**
   * The plan does not include this model, but the row stays clickable so the
   * picker can send the learner to the upgrade page.
   */
  locked?: boolean;
}

interface ModelPickerProps {
  value: string;
  options: ModelPickerOption[];
  onChange: (value: string) => void;
  /** Accessible name for the listbox. */
  label: string;
  /** Shown in the trigger while nothing is selected. */
  placeholder?: string;
  /** Badge text for a zero-point model. */
  freeLabel: string;
  disabled?: boolean;
  /** Called instead of `onChange` when a locked row is clicked. */
  onLocked?: (option: ModelPickerOption) => void;
}

/**
 * The generation-model picker.
 *
 * A native `<select>` cannot show a model name over its provider, and the
 * catalogue is now long enough that a row of cards would wrap into several
 * rows. This is a single-line trigger plus a scrollable listbox: model name in
 * the text size, provider underneath, points on the right.
 */
export function ModelPicker({
  value,
  options,
  onChange,
  label,
  placeholder,
  freeLabel,
  disabled = false,
  onLocked,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const baseId = useId();

  const selected = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);

  /** Options that can be picked; a disabled row is skipped by the arrow keys. */
  const enabled = useMemo(
    () =>
      options
        .map((option, index) => ({ option, index }))
        .filter((entry) => !entry.option.disabled),
    [options],
  );

  useEffect(() => {
    if (!open) return;
    const start = selectedIndex >= 0 ? selectedIndex : (enabled[0]?.index ?? 0);
    setActive(start);
    const list = listRef.current;
    list?.focus();
    list?.querySelector<HTMLElement>(`[data-index="${start}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const choose = (option: ModelPickerOption | undefined) => {
    if (!option) return;
    if (option.locked) {
      close(true);
      onLocked?.(option);
      return;
    }
    if (option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  };

  const move = (step: 1 | -1) => {
    if (enabled.length === 0) return;
    const position = enabled.findIndex((entry) => entry.index === active);
    const next = position === -1 ? 0 : (position + step + enabled.length) % enabled.length;
    const target = enabled[next];
    if (!target) return;
    setActive(target.index);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${target.index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(enabled[0]?.index ?? 0);
        break;
      case 'End':
        event.preventDefault();
        setActive(enabled[enabled.length - 1]?.index ?? 0);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(options[active]);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
  };

  const badge = (multiplier: number) =>
    multiplier <= 0 ? freeLabel : `×${multiplier}`;

  const metaFor = (option: ModelPickerOption) =>
    option.note ? `${option.providerLabel} · ${option.note}` : option.providerLabel;

  return (
    <div className="model-select" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`model-select__trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {selected ? (
          <>
            <ProviderIcon provider={selected.providerId} size={22} />
            <span className="model-select__body">
              <span className="model-select__name">{selected.label}</span>
              <span className="model-select__meta">{metaFor(selected)}</span>
            </span>
            <span className="model-select__mult">{badge(selected.multiplier)}</span>
          </>
        ) : (
          <span className="model-select__body">
            <span className="model-select__name is-placeholder">{placeholder ?? label}</span>
          </span>
        )}
        <Icon name="chevronDown" size={14} className="model-select__chevron" />
      </button>

      {open ? (
        <ul
          className="model-select__menu"
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${baseId}-option-${active}`}
          tabIndex={-1}
          ref={listRef}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.value || index}
              id={`${baseId}-option-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || option.locked || undefined}
              className={[
                'model-select__option',
                option.value === value ? 'is-selected' : '',
                index === active ? 'is-active' : '',
                option.disabled ? 'is-disabled' : '',
                option.locked ? 'is-locked' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => {
                if (!option.disabled && !option.locked) setActive(index);
              }}
              onClick={() => choose(option)}
            >
              <ProviderIcon provider={option.providerId} size={20} />
              <span className="model-select__body">
                <span className="model-select__name">{option.label}</span>
                <span className="model-select__meta">{metaFor(option)}</span>
              </span>
              <span className="model-select__mult">{badge(option.multiplier)}</span>
              <span className="model-select__check" aria-hidden="true">
                {option.value === value ? <Icon name="check" size={13} /> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

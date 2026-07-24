import { useEffect, useRef, useState } from 'react';

export interface AppleSelectOption {
  value: string;
  label: string;
  detail?: string;
}

export interface AppleSelectGroup {
  label?: string;
  options: AppleSelectOption[];
}

interface AppleSelectProps {
  groups: AppleSelectGroup[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Custom dropdown that replaces the native <select>, whose popup list
 * cannot be font-styled by CSS. Fully themed to match the Apple look.
 */
export default function AppleSelect({ groups, value, onChange, disabled, placeholder }: AppleSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const allOptions = groups.flatMap((g) => g.options);
  const selected = allOptions.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`apple-select${disabled ? ' apple-select--disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="apple-select__trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="apple-select__value">
          {selected ? (
            <>
              {selected.label}
              {selected.detail && <span className="apple-select__value-detail"> — {selected.detail}</span>}
            </>
          ) : (
            <span className="apple-select__placeholder">{placeholder || 'Select…'}</span>
          )}
        </span>
        <svg className={`apple-select__chevron${open ? ' apple-select__chevron--open' : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="apple-select__panel" role="listbox">
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && <div className="apple-select__group-label">{group.label}</div>}
              {group.options.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={`apple-select__option${option.value === value ? ' apple-select__option--selected' : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="apple-select__check" aria-hidden="true">
                    {option.value === value ? '✓' : ''}
                  </span>
                  <span className="apple-select__option-text">
                    <span className="apple-select__option-label">{option.label}</span>
                    {option.detail && <span className="apple-select__option-detail">{option.detail}</span>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

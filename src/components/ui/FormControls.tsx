/** Field existente: implementación trasladada sin cambiar validación ni presentación. */
export function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  error,
  required = true,
  inputMode,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  error?: string;
  required?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
}) {
  const describedBy = error ? `${id}-error` : undefined;
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[length:var(--text-body-sm)] font-medium text-ink"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[length:var(--text-caption)] text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

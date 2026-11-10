/** Campos existentes de excepciones/ausencias; no controlan estado ni validación. */
export function DateField({ id, label, value, onChange }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
}) {
  return <div>
    <label htmlFor={id} className="block text-[length:var(--text-body-sm)] font-medium text-ink">{label}</label>
    <input id={id} type="date" required value={value} onChange={(event) => onChange(event.target.value)}
      className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary" />
  </div>;
}
export function TimeField({ id, label, value, onChange }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
}) {
  return <div>
    <label htmlFor={id} className="block text-[length:var(--text-body-sm)] font-medium text-ink">{label}</label>
    <input id={id} type="time" required value={value} onChange={(event) => onChange(event.target.value)}
      className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary" />
  </div>;
}

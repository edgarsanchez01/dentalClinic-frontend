import { PatientCombobox } from './PatientCombobox';

/** Staff selection uses received option metadata; it never resolves patient detail. */
export function PatientPicker({ value, onChange, disabled = false, label = 'Paciente', onSelectedLabel }: {
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  label?: string;
  onSelectedLabel?: (label: string | null) => void;
}) {
  return <PatientCombobox value={value} onChange={id => onChange(id)} disabled={disabled} label={label}
    resolution="selected-option" cacheProfile="shared" onSelectedLabel={onSelectedLabel} />;
}

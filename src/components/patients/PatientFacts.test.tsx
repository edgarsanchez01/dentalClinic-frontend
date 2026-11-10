import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PatientFacts } from './PatientFacts';

const facts = [
  { label: 'Correo de contacto', value: 'paciente@example.test' },
  { label: 'Teléfono', value: 'No registrado', empty: true },
];

describe('PatientFacts', () => {
  it('conserva la receta de resumen y marca solo el valor vacío indicado', () => {
    const { container } = render(<PatientFacts facts={facts} />);

    expect(container.querySelector('dl')).toHaveClass('reception-patients-summary-list');
    expect(container.querySelectorAll('.reception-patients-summary-row')).toHaveLength(2);
    expect(screen.getByText('No registrado')).toHaveClass('reception-patients-empty-value');
    expect(screen.getByText('paciente@example.test')).not.toHaveClass('reception-patients-empty-value');
  });

  it('respeta las recetas inline, card y patient sin añadir hechos', () => {
    const { container, rerender } = render(<PatientFacts variant="inline" facts={facts} />);
    expect(container.querySelector('dl')).toHaveClass('reception-patients-facts');
    expect(container.querySelector('dt')).toHaveClass('reception-patients-fact-label');
    expect(container.querySelector('dd')).toHaveClass('reception-patients-fact-value');

    rerender(<PatientFacts variant="card" facts={facts} />);
    expect(container.querySelector('dl')).toHaveClass('mt-4', 'grid', 'gap-3', 'md:grid-cols-2');
    expect(container.querySelector('dt')).toHaveClass('text-ink-muted');
    expect(container.querySelector('dd')).toHaveClass('text-ink');

    rerender(<PatientFacts variant="patient" facts={facts} />);
    expect(container.querySelector('dl')).toHaveClass('patient-review');
    expect(container.querySelectorAll('dt')).toHaveLength(2);
    expect(container.querySelectorAll('dd')).toHaveLength(2);
    expect(screen.queryByText('Notas administrativas')).not.toBeInTheDocument();
  });
});

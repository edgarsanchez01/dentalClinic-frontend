import type { ReactNode } from 'react';
import { intakeSteps } from './intakeFlow';
import '../auth/auth.css';
import './intake.css';

export function IntakeLayout({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return <div className="intake-surface">
    <a className="intake-skip" href="#intake-main" onClick={event => { event.preventDefault(); document.getElementById('intake-main')?.focus(); }}>Ir al cuestionario</a>
    <header className="intake-topbar"><div className="intake-brand">DentalClinic<span>Demostración: solo datos ficticios</span></div>{actions}</header>
    {children}
    <footer className="intake-demo">Demostración: utiliza solo datos ficticios. Textos pendientes de revisión jurídica y odontológica; no es consentimiento para tratamientos.</footer>
  </div>;
}

export function IntakeProgress({ step, completed, disabled, onBack }: {
  step: number; completed: boolean[]; disabled: boolean; onBack: (step: number) => void;
}) {
  return <nav className="intake-progress" aria-label="Progreso del cuestionario"><ol>
    {intakeSteps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>
      <button type="button" disabled={disabled || index >= step} onClick={() => onBack(index)}>
        <span className="intake-step-number" aria-hidden="true">{index + 1}</span>
        <span><span className="intake-step-name">{label}</span><span className="intake-step-short" aria-hidden="true">{['Datos', 'Médicos', 'Dentales', 'Revisión'][index]}</span><span className="intake-step-mobile-state" aria-hidden="true">{index === step ? 'Actual' : completed[index] ? 'Lista' : 'Pendiente'}</span><span className="intake-step-state">{index === step ? 'Etapa actual' : completed[index] ? 'Completada' : 'Pendiente'}</span></span>
      </button>
    </li>)}
  </ol></nav>;
}

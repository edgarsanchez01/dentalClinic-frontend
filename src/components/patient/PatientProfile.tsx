import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { patientsApi } from '../../api/patients';
import { useAuthStore } from '../../app/authStore';
import { ApiError } from '../../api/http';
import { OdontogramSection } from '../odontogram/OdontogramSection';
import { PatientFacts } from '../patients/PatientFacts';
import { PatientPageHeader, PatientQueryState } from './PatientUI';

export function PatientProfile({ patientId }: { patientId: number }) {
  const ownId = useAuthStore(state => state.user?.patientId);
  const query = useQuery({ queryKey: ['patient', patientId], queryFn: () => patientsApi.get(patientId), enabled: ownId === patientId });
  if (ownId !== patientId) return <div className="patient-page"><p role="alert" className="patient-error">No se encontró tu ficha de paciente. Contacta con la clínica.</p></div>;
  const patient = query.data;
  return <div className="patient-page patient-profile">
    <PatientPageHeader title="Mis datos" intro="Tu información personal y dental, siempre a mano." />
    <nav aria-label="Secciones de mis datos" className="patient-profile-links"><a className="patient-link" href="#personal">Información personal</a><a className="patient-link" href="#salud">Información de salud</a><a className="patient-link" href="#dental">Mi odontograma</a></nav>
    <PatientQueryState query={{ ...query, error: query.error instanceof ApiError && query.error.status === 404 ? new Error('No se encontró tu ficha de paciente. Contacta con la clínica.') : query.error }} label="tus datos">{patient ? <>
      <section id="personal" className="patient-section"><h2>Mi información personal</h2><p className="patient-profile-name">{patient.firstName} {patient.lastName}</p><PatientFacts variant="patient" facts={[{ label: 'Correo de contacto', value: patient.email ?? 'No registrado' }, { label: 'Teléfono', value: patient.phone ?? 'No registrado' }, { label: 'Fecha de nacimiento', value: patient.birthDate ? new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${patient.birthDate}T12:00:00Z`)) : 'No registrada' }]} />
        <details className="patient-record-details"><summary>Otros datos de mi ficha</summary><p>{patient.active ? 'Paciente activo' : 'Paciente inactivo'}</p><p>Notas administrativas: {patient.administrativeNotes ?? 'Sin notas registradas'}</p></details>
      </section>
      <section id="salud" className="patient-health-section"><div><h2>Mi información de salud</h2><p>Consulta tus respuestas médicas y dentales. Si algo cambió, puedes confirmar una nueva revisión.</p></div><Link to="/patient-profile" className="patient-button patient-button-secondary">Consultar y actualizar mi información de salud</Link></section>
      <section id="dental" className="patient-section patient-dental"><h2>Mi odontograma</h2><p>Un mapa de las condiciones que tu odontólogo ha registrado. Los números identifican cada pieza dental.</p><p className="patient-muted">Vista desde la perspectiva del profesional: derecha e izquierda corresponden a tus lados. Selecciona una pieza registrada para consultar sus superficies. Solo lectura.</p><OdontogramSection patientId={patientId} summary /></section>
    </> : null}</PatientQueryState>
  </div>;
}

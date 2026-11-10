import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { medicalIntakeApi } from '../../api/medicalIntake';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import { secondary } from '../financial/financialUi';
import { DeclarationView } from './IntakeSummary';
import '../auth/auth.css';
import './intake.css';

export function PatientIntakeProfile() {
  const latest = useQuery({ queryKey: ['medical-intake', 'declarations', 'latest'], queryFn: medicalIntakeApi.latest, gcTime: 0 });
  return <div className="intake-surface intake-profile space-y-6">
    <h1 className="text-[length:var(--text-h3)] font-semibold">Mi información de salud</h1>
    <p className="text-ink-secondary">Información declarada por ti, separada de las observaciones de tu odontólogo. Los textos son demostrativos y requieren revisión jurídica y odontológica antes de producción.</p>
    {latest.isPending ? <p role="status">Consultando última declaración…</p> : latest.isError ? <><FormAlert>No se pudo consultar la última declaración.</FormAlert><button className={secondary} onClick={() => void latest.refetch()}>Reintentar última declaración</button></>
      : latest.data ? <section className="rounded-card border border-hairline bg-paper p-5"><h2 className="mb-4 text-[length:var(--text-h5)]">Última declaración</h2><DeclarationView declaration={latest.data} /></section> : <p>No hay declaraciones confirmadas.</p>}
    <Link to="/patient-profile/edit" className={`${secondary} inline-flex items-center`}>Actualizar datos y antecedentes</Link>
    <IntakeDeclarations />
  </div>;
}

/** Mounted only for the self patient or the two authorized clinical roles; never reception. */
export function IntakeDeclarations({ patientId }: { patientId?: number }) {
  const role = useAuthStore(state => state.user?.role);
  if (patientId !== undefined && role !== 'OWNER' && role !== 'DENTIST') return null;
  if (patientId === undefined && role !== 'PATIENT') return null;
  return <DeclarationHistory key={patientId ?? 'self'} patientId={patientId} />;
}
function DeclarationHistory({ patientId }: { patientId: number | undefined }) {
  const [page, setPage] = useState(0);
  const declarations = useQuery({ queryKey: ['medical-intake', 'declarations', patientId ?? 'self', page], queryFn: () => medicalIntakeApi.declarations(page, patientId), gcTime: 0 });
  return <section aria-label="Información declarada por el paciente" className="mt-8 space-y-4 rounded-card border border-hairline bg-paper p-5">
    <h2 className="text-[length:var(--text-h5)] font-semibold">Información declarada por el paciente</h2>
    <p className="text-ink-secondary">Declaraciones confirmadas e inmutables. No son observaciones del odontólogo ni consentimiento para tratamientos.</p>
    {declarations.isPending ? <p role="status">Consultando declaraciones…</p> : declarations.isError ? <><FormAlert>No se pudieron cargar las declaraciones.</FormAlert><button className={secondary} onClick={() => void declarations.refetch()}>Reintentar declaraciones</button></>
      : declarations.data.content.length ? declarations.data.content.map(declaration => <details key={declaration.id} className="border-t border-hairline py-2"><summary className="min-h-11 cursor-pointer py-3">Revisión {declaration.revision} · Confirmada · {declaration.confirmedAt.slice(0, 10)}</summary><DeclarationView declaration={declaration} /></details>) : <p>No hay declaraciones confirmadas.</p>}
    <nav aria-label="Páginas de declaraciones" className="flex flex-wrap items-center gap-3"><button className={secondary} disabled={page === 0 || declarations.isFetching} onClick={() => setPage(page - 1)}>Declaraciones anteriores</button><span>Página {page + 1}</span><button className={secondary} disabled={!declarations.data || declarations.isError || declarations.isFetching || page + 1 >= declarations.data.totalPages} onClick={() => setPage(page + 1)}>Más declaraciones</button></nav>
  </section>;
}

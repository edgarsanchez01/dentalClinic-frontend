import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { feedbackApi } from '../../api/feedback';
import { useAuthStore } from '../../app/authStore';
import { ReceptionPageHeader, ReceptionQueryState } from '../reception/ReceptionUI';
import { ReviewPresentation } from './ReviewPresentation';
import './reviews.css';

export function ReviewsPage() {
  const role = useAuthStore(state => state.user?.role);
  const [page, setPage] = useState(0);
  const reviews = useQuery({ queryKey: ['feedback-reviews', page], queryFn: () => feedbackApi.reviews(page), retry: false });
  const owner = role === 'OWNER';
  const content = reviews.data ? <ReviewPresentation data={reviews.data} page={page} fetching={reviews.isFetching}
    onPageChange={setPage}
    summaryIntro={owner ? 'Incluye todas las reseñas de la clínica, no solo esta página.' : 'Incluye todas las reseñas de tus consultas, no solo esta página.'}
    formatDate={iso => owner ? new Date(iso).toLocaleString('es-MX')
      : new Date(iso).toLocaleString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} /> : null;
  return <div className="clinical-editorial reception-page reviews-page">
    <ReceptionPageHeader title="Reseñas de pacientes" intro={owner ? 'Reseñas privadas de las consultas de la clínica.' : 'Reseñas privadas de tus propias consultas.'} />
    {owner ? reviews.isPending ? <p role="status" className="reception-readonly-note">Cargando reseñas…</p>
      : reviews.isError ? <div className="reception-empty"><p role="alert">No se pudieron cargar las reseñas.</p>
        <button type="button" className="reception-link" onClick={() => void reviews.refetch()}>Reintentar</button></div>
        : content : <ReceptionQueryState query={reviews} label="reseñas">{content}</ReceptionQueryState>}
  </div>;
}

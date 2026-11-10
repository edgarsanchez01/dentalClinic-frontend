import type { Reviews } from '../../api/feedback';
import { ReceptionEmptyState, ReceptionSection } from '../reception/ReceptionUI';
import { Star } from './FeedbackPage';

export function ReviewPresentation({ data, page, fetching, onPageChange, summaryIntro, formatDate }: {
  data: Reviews; page: number; fetching: boolean; onPageChange: (page: number) => void;
  summaryIntro: string; formatDate: (iso: string) => string;
}) {
  return <>
    <ReceptionSection title="Resumen de valoraciones" intro={summaryIntro}>
      <dl className="reception-card reviews-summary">
        <div><dt>Reseñas recibidas</dt><dd>{data.count}</dd></div>
        <div><dt>Calificación promedio</dt><dd className={data.average == null ? 'reviews-unrated' : undefined}>{data.average == null ? 'Sin valoraciones' : `${data.average.toLocaleString('es-MX', { maximumFractionDigits: 2 })} de 5`}</dd></div>
      </dl>
    </ReceptionSection>
    <ReceptionSection title="Valoraciones y comentarios">
      {data.content.length === 0 ? <ReceptionEmptyState title="Aún no hay reseñas para mostrar.">
        Las valoraciones aparecerán aquí cuando los pacientes respondan a sus invitaciones privadas.
      </ReceptionEmptyState> : <ul className="reviews-list" aria-label="Reseñas recibidas">
        {data.content.map(review => <li key={review.id}>
          <article className="reviews-entry" aria-label={`Reseña: ${review.rating} de 5 estrellas`}>
            <header className="reviews-entry-header">
              <p className="reviews-rating"><span className="reviews-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map(value => <Star key={value} filled={review.rating >= value} />)}</span><span>{review.rating} de 5 estrellas</span></p>
              <time className="reviews-date" dateTime={review.respondedAt}>{formatDate(review.respondedAt)}</time>
            </header>
            <p className={`reviews-comment${review.comment == null ? ' reviews-comment--empty' : ''}`}>{review.comment ?? 'Sin comentario'}</p>
          </article>
        </li>)}
      </ul>}
    </ReceptionSection>
    {data.totalPages > 1 ? <nav aria-label="Páginas de reseñas" className="reviews-pagination">
      <button type="button" className="reception-button reception-button-secondary" disabled={page === 0 || fetching} onClick={() => onPageChange(page - 1)}>Anterior</button>
      <span role="status" className="reviews-pagination-status">Página {page + 1} de {data.totalPages}</span>
      <button type="button" className="reception-button reception-button-secondary" disabled={fetching || page + 1 >= data.totalPages} onClick={() => onPageChange(page + 1)}>Siguiente</button>
    </nav> : null}
  </>;
}

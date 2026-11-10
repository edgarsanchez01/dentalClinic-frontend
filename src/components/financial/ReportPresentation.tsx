import type { ReactNode } from 'react';
import { ActionGroup } from '../ui/ActionGroup';
import { secondary } from './financialUi';

/** Domain table shell, not a sorting/paging/query engine. No such F1 component exists yet. */
export function FinancialTable({ label, caption, columns, numeric = [], className = 'min-w-[40rem]', children }: {
  label: string; caption: string; columns: readonly string[]; numeric?: readonly string[]; className?: string; children: ReactNode;
}) {
  return <div className="financial-table-region min-w-0 max-w-full overflow-x-auto rounded-card bg-paper ring-1 ring-hairline" role="region" aria-label={label} tabIndex={0}>
    <table className={`reception-table w-full ${className} text-left text-[length:var(--text-body-app)]`}>
      <caption className="sr-only">{caption}</caption>
      <thead className="bg-sunken"><tr>{columns.map(title => <th key={title} scope="col"
        className={`px-4 py-3 font-medium${numeric.includes(title) ? ' reception-finances-amount--right' : ''}`}>{title}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

export function FinancialPagination({ label, page, totalPages, fetching, onPageChange, className = 'reception-pagination' }: {
  label: string; page: number; totalPages: number; fetching: boolean; onPageChange: (page: number) => void; className?: string;
}) {
  return <nav aria-label={label} className={className}><ActionGroup className="financial-pagination-actions">
    <button type="button" className={secondary} disabled={page === 0 || fetching} onClick={() => onPageChange(page - 1)}>Página anterior</button>
    <span>Página {page + 1} de {Math.max(1, totalPages)}</span>
    <button type="button" className={secondary} disabled={page + 1 >= totalPages || fetching} onClick={() => onPageChange(page + 1)}>Página siguiente</button>
  </ActionGroup></nav>;
}

export function ReportFigure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="reception-kpi reception-finances-report-figure">
    <p className="reception-kpi-label">{label}</p>
    <p className="reception-kpi-value reception-finances-amount"><span className="report-figure-number">{value}</span></p>
    {hint ? <p className="reception-kpi-hint">{hint}</p> : null}
  </div>;
}

/** Solo distribución; los valores y su formato llegan intactos del reporte. */
export function ReportFigures({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 }) {
  return <div className="financial-report-layout"><div className="financial-report-figures" data-columns={columns}>{children}</div></div>;
}

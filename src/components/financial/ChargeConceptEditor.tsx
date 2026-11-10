import type { ReactNode } from 'react';
import { Field } from '../auth/ui';
import { formatMoney, normalizeMoney } from '../../lib/financialMoney';

export interface ConceptDraft { key: string; description: string; quantity: string; unitPrice: string }

/** Same inputs/IDs in wizard and full form. Validation and draft updates remain in the caller. */
export function ChargeConceptEditor({ item, index, layout, errors, serverErrors, onChange, remove }: {
  item: ConceptDraft; index: number; layout: 'wizard' | 'full'; errors: Record<string, string>; serverErrors: Record<string, string>;
  onChange: (field: keyof Omit<ConceptDraft, 'key'>, value: string) => void; remove: ReactNode;
}) {
  const prefix = `items[${index}]`;
  const error = (field: string) => { const value = errors[`${prefix}.${field}`] || serverErrors[`${prefix}.${field}`]; return value ? { error: value } : {}; };
  const fields = <>
    <div className={layout === 'wizard' ? 'reception-concept-description' : 'sm:col-span-2'}><Field id={`${prefix}.description`} label={`Descripción del concepto ${index + 1}`} value={item.description} onChange={value => onChange('description', value)} {...error('description')} /></div>
    <Field id={`${prefix}.quantity`} inputMode="numeric" label={`Cantidad del concepto ${index + 1}`} value={item.quantity} onChange={value => onChange('quantity', value)} {...error('quantity')} />
    <Field id={`${prefix}.unitPrice`} inputMode="decimal" label={`Precio unitario del concepto ${index + 1} (MXN)`} value={item.unitPrice} onChange={value => onChange('unitPrice', value)} {...error('unitPrice')} />
  </>;
  return layout === 'wizard' ? <article className="reception-concept">
    <header className="reception-concept-head"><h3 className="reception-concept-index">Concepto {index + 1}</h3>{remove}</header>
    <div className="reception-concept-fields">{fields}</div>
  </article> : <div className="reception-concept grid min-w-0 gap-3 border-b border-hairline pb-4 sm:grid-cols-4">{fields}{remove}</div>;
}

export function ChargeConceptReview({ items }: { items: readonly ConceptDraft[] }) {
  return <ul className="reception-finances-review-items">{items.map((item, index) => {
    const price = normalizeMoney(item.unitPrice);
    return <li key={item.key}><span>{index + 1}. {item.description.trim() || 'Concepto sin descripción'}</span>
      <span className="reception-finances-amount">{item.quantity || '0'} × {price !== null ? formatMoney(price) : 'importe pendiente'}</span></li>;
  })}</ul>;
}

export function ChargePreview({ total, note, children }: { total: string; note: string; children?: ReactNode }) {
  return <div className="reception-preview"><p className="reception-preview-total tabular-nums">Total de vista previa: {total}</p>
    <p className="reception-preview-note">{note}</p>{children}</div>;
}

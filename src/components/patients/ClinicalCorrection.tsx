import { useId, useState, type ReactNode } from 'react';

import { FormAlert } from '../auth/ui';
import { currentEntry, type ChainEntry } from './clinicalChain';
import { useUnsavedChanges } from '../../app/unsavedChanges';

export function CorrectionForm({
  entryId,
  originalContent,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  entryId: number;
  originalContent: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (content: string, reason: string) => void;
}) {
  const [content, setContent] = useState(originalContent);
  const [reason, setReason] = useState('');
  const formId = useId();
  useUnsavedChanges(content !== originalContent || reason !== '');
  const valid = content.trim() !== '' && reason.trim() !== '';
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !pending) onSubmit(content.trim(), reason.trim());
      }}
    >
      <label htmlFor={`correction-content-${entryId}-${formId}`} className="block text-[length:var(--text-body-sm)] font-medium text-ink">
        Contenido corregido
      </label>
      <textarea
        id={`correction-content-${entryId}-${formId}`}
        disabled={pending}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={3}
        className="w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <label htmlFor={`correction-reason-${entryId}-${formId}`} className="block text-[length:var(--text-body-sm)] font-medium text-ink">
        Motivo de la corrección
      </label>
      <input
        id={`correction-reason-${entryId}-${formId}`}
        disabled={pending}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={1000}
        className="w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <p className="text-[length:var(--text-caption)] text-ink-muted">
        La versión anterior se conserva; la corrección queda registrada con autor, fecha y motivo.
      </p>
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={!valid || pending}
          className="min-h-11 rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          {pending ? 'Guardando…' : 'Guardar corrección'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="min-h-11 rounded-control px-5 py-2 text-[length:var(--text-body-app)] font-medium text-ink underline outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * Renderiza una cadena: la version vigente (ultima correccion o raiz) y, si existen correcciones,
 * un historial desplegable con todas las versiones (evidencia conservada). Permite iniciar una
 * correccion cuando `editable`.
 */
export function ClinicalEntryChain<T extends ChainEntry>({
  root,
  corrections,
  editable,
  correcting,
  pending,
  error,
  getContent,
  renderEntry,
  renderMeta,
  onStartCorrect,
  onCancelCorrect,
  onSubmitCorrect,
}: {
  root: T;
  corrections: T[];
  editable: boolean;
  correcting: boolean;
  pending: boolean;
  error: string | null;
  getContent: (entry: T) => string;
  renderEntry: (entry: T) => ReactNode;
  renderMeta: (entry: T) => ReactNode;
  onStartCorrect: () => void;
  onCancelCorrect: () => void;
  onSubmitCorrect: (content: string, reason: string) => void;
}) {
  const current = currentEntry(root, corrections);
  const versions = [root, ...corrections];
  return (
    <div className="rounded-control bg-input-fill p-3">
      <div data-testid={`clinical-current-${current.id}`}>{renderEntry(current)}</div>
      <p className="mt-2 text-[length:var(--text-caption)] text-ink-muted">{renderMeta(current)}</p>
      {corrections.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--text-caption)] text-ink-secondary">
            Corregida · ver versiones anteriores ({corrections.length})
          </summary>
          <ol className="mt-2 grid gap-2">
            {versions.map((entry, index) => (
              <li key={entry.id} className="rounded-control bg-paper p-3 ring-1 ring-hairline">
                <p className="text-[length:var(--text-caption)] font-medium text-ink-secondary">
                  {index === 0 ? 'Original' : `Corrección ${index}`}
                </p>
                <div className="mt-1">{renderEntry(entry)}</div>
                {entry.correctionReason ? (
                  <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">Motivo: {entry.correctionReason}</p>
                ) : null}
                <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">{renderMeta(entry)}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {editable ? (
        correcting ? (
          <CorrectionForm
            entryId={root.id}
            originalContent={getContent(current)}
            pending={pending}
            error={error}
            onCancel={onCancelCorrect}
            onSubmit={onSubmitCorrect}
          />
        ) : (
          <button
            type="button"
            className="mt-2 min-h-11 text-[length:var(--text-body-sm)] font-medium text-ink underline outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={onStartCorrect}
          >
            Corregir
          </button>
        )
      ) : null}
    </div>
  );
}

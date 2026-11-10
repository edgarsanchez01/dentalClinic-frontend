import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { catalogApi, normalizeReferencePrice, type ServiceDto, type ServiceInput } from '../../api/catalog';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { Field, FormAlert } from '../auth/ui';
import { ReceptionEmptyState, ReceptionPageHeader } from '../reception/ReceptionUI';
import { ReceptionServices } from './ReceptionServices';
import { ServiceFilter, ServiceList } from './ServiceList';
import { useServiceList, type ServiceFilterValue } from './serviceQueries';

const secondary = 'reception-button reception-button-secondary';
const primary = 'reception-button';

function requireOwner() {
  if (useAuthStore.getState().user?.role !== 'OWNER') throw new Error('No tienes permiso para modificar el catálogo.');
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.body?.message || fallback : fallback;
}

export function ServicesPage() {
  const role = useAuthStore((state) => state.user?.role);
  if (role !== 'OWNER' && role !== 'DENTIST' && role !== 'RECEPTIONIST') return null;
  if (role === 'RECEPTIONIST' || role === 'DENTIST') return <ReceptionServices />;
  return <ServiceCatalog canManage={role === 'OWNER'} />;
}

function ServiceCatalog({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [filter, setFilter] = useState<ServiceFilterValue>('all');
  const [editor, setEditor] = useState<{ id?: number } | null>(null);
  const [confirmation, setConfirmation] = useState<ServiceDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorPending, setEditorPending] = useState(false);
  const returnFocus = useRef<string | null>(null);
  const restoreRequested = useRef(false);
  const filterRef = useRef<HTMLSelectElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const query = useServiceList(filter);

  function restoreFocus() {
    restoreRequested.current = true;
  }

  async function saved(message: string) {
    setEditor(null);
    setConfirmation(null);
    setError(null);
    setNotice(message);
    await client.invalidateQueries({ queryKey: ['services'] });
    restoreFocus();
  }

  const activation = useMutation({
    mutationFn: (item: ServiceDto) => {
      requireOwner();
      return catalogApi.setActive(item.id, !item.active);
    },
    onSuccess: (item) => saved(`Servicio «${item.name}» ${item.active ? 'reactivado' : 'desactivado'}.`),
    onError: (cause) => setError(errorMessage(cause, 'No se pudo cambiar el estado.')),
  });

  useLayoutEffect(() => {
    if (!restoreRequested.current || editorPending || activation.isPending) return;
    restoreRequested.current = false;
    const target = returnFocus.current ? document.getElementById(returnFocus.current) : null;
    if (target) target.focus();
    else filterRef.current?.focus();
  });

  useEffect(() => { if (confirmation) confirmRef.current?.focus(); }, [confirmation]);

  function startEditor(id: number | undefined, trigger: HTMLElement) {
    returnFocus.current = trigger.id;
    setError(null); setNotice(null); setConfirmation(null);
    setEditor(id === undefined ? {} : { id });
  }

  return (
    <div className="clinical-editorial reception-page reception-services">
      <ReceptionPageHeader
        title="Servicios dentales"
        intro={`${canManage ? 'Gestiona los servicios del catálogo y su vigencia.' : 'Consulta los servicios del catálogo. Acceso de solo lectura.'} Precios de referencia sin moneda ni impuestos definidos. No generan cargos.`}
        action={canManage && !editor && !confirmation ? <button id="new-service" className="reception-button" disabled={editorPending || activation.isPending} onClick={(event) => startEditor(undefined, event.currentTarget)}>Nuevo servicio</button> : undefined}
      />

      <div className="ce-feedback grid gap-3" aria-live="polite">
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>

      {canManage && editor ? <ServiceEditor key={editor.id ?? 'new'} id={editor.id}
        onPending={setEditorPending}
        onSaved={(item) => saved(`Servicio «${item.name}» ${editor.id === undefined ? 'creado' : 'actualizado'}.`)}
        onCancel={() => { setEditor(null); restoreFocus(); }} /> : null}

      {canManage && confirmation ? (
        <section aria-label="Confirmar cambio de estado" className="reception-card ce-admin-form">
          <h2 className="break-words text-[length:var(--text-h5)] text-ink">¿{confirmation.active ? 'Desactivar' : 'Reactivar'} «{confirmation.name}»?</h2>
          <p className="mt-2 text-[length:var(--text-body-app)] text-ink-secondary">{confirmation.active
            ? 'Dejará de aparecer en el catálogo público. El servicio se conserva.'
            : 'Volverá a aparecer en el catálogo público.'}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button ref={confirmRef} className={primary} disabled={activation.isPending} onClick={() => {
              if (canManage && !activation.isPending) activation.mutate(confirmation);
            }}>{activation.isPending ? 'Guardando estado…' : confirmation.active ? 'Confirmar desactivación' : 'Confirmar reactivación'}</button>
            <button className={secondary} disabled={activation.isPending} onClick={() => { setConfirmation(null); setError(null); restoreFocus(); }}>Cancelar</button>
          </div>
        </section>
      ) : null}

      <div className="rc-tools">
        <ServiceFilter value={filter} onChange={setFilter} selectRef={filterRef} />
        {query.isFetching && !query.isPending ? <p role="status" className="text-[length:var(--text-caption)] text-ink-muted">Actualizando catálogo…</p> : null}
      </div>
      {query.isPending ? <p role="status" className="reception-readonly-note">Cargando servicios…</p> : query.isError ? (
        <div className="grid justify-items-start gap-3">
          <FormAlert>{errorMessage(query.error, 'No se pudo cargar el catálogo.')}</FormAlert>
          <button className={secondary} onClick={() => void query.refetch()}>Reintentar</button>
        </div>
      ) : query.data.length === 0 ? (
        <ReceptionEmptyState title={filter === 'all' ? 'El catálogo está vacío' : 'No hay servicios con este estado'}>
          {canManage ? 'Crea un servicio para comenzar o cambia el filtro de estado.' : 'Los servicios aparecerán aquí cuando se registren.'}
        </ReceptionEmptyState>
      ) : (
        <ServiceList items={query.data} renderActions={item => canManage ? <>
          <button id={`edit-service-${item.id}`} className={secondary} disabled={editorPending || activation.isPending} onClick={(event) => startEditor(item.id, event.currentTarget)}>Editar <span className="sr-only">{item.name}</span></button>
          <button id={`state-service-${item.id}`} className={secondary} disabled={editorPending || activation.isPending} onClick={(event) => {
            returnFocus.current = event.currentTarget.id;
            setEditor(null); setError(null); setNotice(null); setConfirmation(item);
          }}>{item.active ? 'Desactivar' : 'Reactivar'} <span className="sr-only">{item.name}</span></button>
        </> : null} />
      )}
    </div>
  );
}

type Draft = { name: string; description: string; referencePrice: string; durationMinutes: string };

function ServiceEditor({ id, onSaved, onCancel, onPending }: {
  id: number | undefined; onSaved: (item: ServiceDto) => Promise<void>; onCancel: () => void; onPending: (pending: boolean) => void;
}) {
  const query = useQuery({ queryKey: ['services', 'detail', id], queryFn: () => catalogApi.get(id!), enabled: id !== undefined });
  if (id !== undefined && query.isPending) return <p role="status" className="reception-readonly-note">Cargando servicio…</p>;
  if (query.isError) return <div className="grid justify-items-start gap-3"><FormAlert>{errorMessage(query.error, 'No se pudo cargar el servicio.')}</FormAlert>
    <button className={secondary} onClick={() => void query.refetch()}>Reintentar servicio</button><button className={secondary} onClick={onCancel}>Cancelar edición</button></div>;
  return <ServiceForm key={id ?? 'create'} item={query.data} onSaved={onSaved} onCancel={onCancel} onPending={onPending} />;
}

function ServiceForm({ item, onSaved, onCancel, onPending }: {
  item: ServiceDto | undefined; onSaved: (item: ServiceDto) => Promise<void>; onCancel: () => void; onPending: (pending: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({ name: item?.name ?? '', description: item?.description ?? '',
    referencePrice: item?.referencePrice ?? '', durationMinutes: item ? String(item.durationMinutes) : '' }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.querySelector<HTMLInputElement>('input')?.focus(); }, []);
  const set = (key: keyof Draft) => (value: string) => setDraft((previous) => ({ ...previous, [key]: value }));

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!draft.name.trim() || draft.name.trim().length > 200) next.name = 'Escribe un nombre de hasta 200 caracteres.';
    if (draft.description.length > 4000) next.description = 'La descripción admite hasta 4000 caracteres.';
    if (normalizeReferencePrice(draft.referencePrice) === null) next.referencePrice = 'Escribe un precio no negativo, sin separadores de miles, con hasta 15 enteros y 4 decimales.';
    if (!/^\d+$/.test(draft.durationMinutes.trim()) || Number(draft.durationMinutes) < 1 || Number(draft.durationMinutes) > 2147483647) next.durationMinutes = 'Escribe una duración entera positiva en minutos.';
    return next;
  }

  function focusError(next: Record<string, string>) {
    const key = Object.keys(draft).find((field) => Boolean(next[field]));
    if (key) form.current?.querySelector<HTMLElement>(`[name="${key}"]`)?.focus();
  }

  const save = useMutation({
    mutationFn: (input: ServiceInput) => {
      requireOwner();
      return item ? catalogApi.update(item.id, input) : catalogApi.create(input);
    },
    onSuccess: onSaved,
    onSettled: () => onPending(false),
    onError: (cause) => {
      const next = cause instanceof ApiError ? cause.fieldErrors : {};
      setErrors(next); setError(errorMessage(cause, 'No se pudo guardar el servicio.'));
      focusError(next);
    },
  });

  return <form ref={form} aria-label={item ? 'Editar servicio' : 'Crear servicio'} noValidate
    className="reception-card ce-admin-form grid max-w-[40rem] gap-4"
    onBlur={(event) => {
      const target: EventTarget = event.target;
      const key = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.name : '';
      if (key in draft) setErrors((previous) => ({ ...previous, [key]: validate()[key] ?? '' }));
    }}
    onSubmit={(event) => {
      event.preventDefault();
      if (save.isPending || useAuthStore.getState().user?.role !== 'OWNER') return;
      const next = validate();
      setErrors(next); setError(null);
      if (Object.keys(next).length) { setError('Revisa los campos indicados.'); focusError(next); return; }
      onPending(true);
      save.mutate({ name: draft.name.trim(), description: draft.description.trim() || null,
        referencePrice: normalizeReferencePrice(draft.referencePrice)!, durationMinutes: Number(draft.durationMinutes) });
    }}>
    <h2 className="text-[length:var(--text-h5)] text-ink">{item ? 'Editar servicio' : 'Nuevo servicio'}</h2>
    {error ? <FormAlert>{error}</FormAlert> : null}
    <fieldset disabled={save.isPending} className="grid min-w-0 gap-4">
      <Field id="name" label="Nombre" value={draft.name} onChange={set('name')} {...(errors.name ? { error: errors.name } : {})} />
      <div>
        <label htmlFor="description" className="block text-[length:var(--text-body-sm)] font-medium text-ink">Descripción (opcional)</label>
        <textarea id="description" name="description" rows={3} value={draft.description} onChange={(event) => set('description')(event.target.value)}
          aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'description-error' : undefined}
          className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary" />
        {errors.description ? <p id="description-error" className="mt-1.5 text-[length:var(--text-caption)] text-danger-ink">{errors.description}</p> : null}
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field id="referencePrice" inputMode="decimal" label="Precio de referencia" value={draft.referencePrice} onChange={set('referencePrice')} {...(errors.referencePrice ? { error: errors.referencePrice } : {})} />
        <Field id="durationMinutes" inputMode="numeric" label="Duración (minutos)" value={draft.durationMinutes} onChange={set('durationMinutes')} {...(errors.durationMinutes ? { error: errors.durationMinutes } : {})} />
      </div>
    </fieldset>
    <p className="text-[length:var(--text-caption)] text-ink-muted">El precio admite hasta 4 decimales. La duración se registra en minutos, sin valor predeterminado.</p>
    <div className="flex flex-wrap gap-2">
      <button type="submit" className={primary} disabled={save.isPending}>{save.isPending ? 'Guardando servicio…' : 'Guardar servicio'}</button>
      <button type="button" className={secondary} disabled={save.isPending} onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}

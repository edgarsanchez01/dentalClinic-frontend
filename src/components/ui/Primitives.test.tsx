import { readFileSync, readdirSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PageContainer, PageHeader } from './Page';
import { Section, Surface } from './Section';
import { EmptyState } from './EmptyState';
import { QueryState } from './QueryState';
import { ActionGroup } from './ActionGroup';
import { Field } from '../auth/ui';
import { ReceptionPageHeader, ReceptionSection, ReceptionEmptyState, ReceptionQueryState } from '../reception/ReceptionUI';
import { DentistPageHeader, DentistSection, DentistEmptyState, DentistQueryState } from '../dentist/DentistUI';
import { PatientPageHeader, PatientEmptyState, PatientQueryState } from '../patient/PatientUI';

describe('F1: núcleo editorial presentacional', () => {
  it('respeta el main del shell, un h1, h2/h3 y las superficies explícitas', () => {
    const { container } = render(<main><PageContainer><PageHeader title="Pacientes" intro="Directorio" context="Contexto" action={<button>Crear</button>} />
      <Section title="Datos" intro="Información" action={<button>Editar</button>}><Surface appearance="context">Contenido</Surface></Section>
      <EmptyState title="Sin coincidencias">Cambia los filtros.</EmptyState></PageContainer></main>);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Datos', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sin coincidencias', level: 3 })).toBeInTheDocument();
    expect(container.querySelector('.ce-surface--context')).toHaveTextContent('Contenido');
  });
  it.each(['standard', 'wide', 'clinical', 'form'] as const)('publica preset %s sin datos ni rol', preset => {
    const { container } = render(<PageContainer preset={preset}>Contenido</PageContainer>);
    expect(container.firstChild).toHaveClass(`ce-page--${preset}`);
  });
  it('no envuelve acciones ni altera el orden de los controles del caller', () => {
    const action = vi.fn();
    render(<ActionGroup><button onClick={action}>Guardar</button><button disabled>Cancelar</button><button>Eliminar</button></ActionGroup>);
    expect(screen.getAllByRole('button').map(el => el.textContent)).toEqual(['Guardar', 'Cancelar', 'Eliminar']);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  });
  it('distingue carga, error e incompleto, sin montar contenido prematuramente ni reintentar solo', () => {
    const retry = vi.fn();
    const { rerender } = render(<QueryState status="loading"><input aria-label="Borrador" /></QueryState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByLabelText('Borrador')).not.toBeInTheDocument();
    rerender(<QueryState status="error" message="Fallo de lectura" onRetry={retry}><input aria-label="Borrador" /></QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Fallo de lectura');
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Borrador')).not.toBeInTheDocument();
    rerender(<QueryState status="incomplete">No montar</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Respuesta incompleta');
    expect(screen.queryByText('No montar')).not.toBeInTheDocument();
  });
  it('conserva una sola instancia y el borrador al refrescar o fallar con datos previos', () => {
    const content = <input aria-label="Borrador" defaultValue="Inicial" />;
    const { rerender } = render(<QueryState status="ready">{content}</QueryState>);
    const field = screen.getByLabelText('Borrador');
    fireEvent.change(field, { target: { value: 'Sin guardar' } });
    rerender(<QueryState status="refreshing">{content}</QueryState>);
    expect(screen.getByRole('status')).toHaveTextContent('Actualizando');
    expect(screen.getByLabelText('Borrador')).toBe(field);
    rerender(<QueryState status="stale-error" message="Error con datos previos">{content}</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Error con datos previos');
    expect(screen.getByLabelText('Borrador')).toBe(field);
    expect(field).toHaveValue('Sin guardar');
    expect(screen.getAllByLabelText('Borrador')).toHaveLength(1);
  });
  it('reutiliza Field sin cambiar required, error, nombre ni onChange', () => {
    const change = vi.fn();
    render(<Field id="nombre" label="Nombre" value="Ana" onChange={change} error="Revisa el nombre" />);
    const field = screen.getByLabelText('Nombre');
    expect(field).toBeRequired();
    expect(field).toHaveAttribute('name', 'nombre');
    expect(field).toHaveAttribute('aria-describedby', 'nombre-error');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(field, { target: { value: 'María' } });
    expect(change).toHaveBeenCalledWith('María');
  });
  it('el núcleo no importa APIs, sesión, router ni TanStack', () => {
    for (const file of readdirSync('src/components/ui').filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))) {
      const source = readFileSync(`src/components/ui/${file}`, 'utf8');
      expect(source, file).not.toMatch(/from ['"][^'"]*(?:\/api\/|authStore|react-router|tanstack)/);
    }
  });
});

describe('F1: compatibilidad literal del DOM de los adaptadores', () => {
  const action = <button type="button" disabled>Crear</button>;
  it('conserva la cabecera de Recepción', () => {
    expect(renderToStaticMarkup(<ReceptionPageHeader title="Título" intro="Descripción" action={action} />)).toBe(renderToStaticMarkup(
      <header className="reception-page-heading"><div className="reception-page-heading-copy"><h1 className="reception-page-title">Título</h1><p className="reception-page-intro">Descripción</p></div><div className="reception-page-actions">{action}</div></header>));
  });
  it('conserva contexto y cabecera del Dentista', () => {
    expect(renderToStaticMarkup(<DentistPageHeader title="Título" intro="Descripción" context={<span>Mi jornada</span>} action={action} />)).toBe(renderToStaticMarkup(
      <header className="dentist-page-heading"><div className="dentist-page-heading-copy"><h1 className="dentist-page-title">Título</h1><p className="dentist-page-intro">Descripción</p><p className="dentist-page-context"><span>Mi jornada</span></p></div><div className="dentist-page-actions">{action}</div></header>));
  });
  it('conserva cabecera del Paciente sin añadir envoltorio a las acciones', () => {
    expect(renderToStaticMarkup(<PatientPageHeader title="Título" intro="" action={action} />)).toBe(renderToStaticMarkup(
      <header className="patient-page-heading"><div><h1>Título</h1><p /></div>{action}</header>));
  });
  for (const [name, Component, prefix] of [['Recepción', ReceptionSection, 'reception'], ['Dentista', DentistSection, 'dentist']] as const) {
    it(`${name}: conserva sección y no muestra intro aislada en la receta anterior`, () => {
      expect(renderToStaticMarkup(<Component title="Título" intro="Descripción" action={action}>Contenido</Component>)).toBe(renderToStaticMarkup(
        <section className={`${prefix}-section`}><div className={`${prefix}-section-heading`}><div><h2>Título</h2><p>Descripción</p></div>{action}</div>Contenido</section>));
      expect(renderToStaticMarkup(<Component intro="No visible">Contenido</Component>)).toBe(`<section class="${prefix}-section">Contenido</section>`);
    });
  }
  for (const [name, Component, prefix] of [['Recepción', ReceptionEmptyState, 'reception'], ['Dentista', DentistEmptyState, 'dentist'], ['Paciente', PatientEmptyState, 'patient']] as const) {
    it(`${name}: conserva vacío y acción literal`, () => {
      expect(renderToStaticMarkup(<Component title="Vacío" action={action}>Explicación</Component>)).toBe(renderToStaticMarkup(
        <div className={`${prefix}-empty`}><h3>Vacío</h3><p>Explicación</p>{action}</div>));
    });
  }
  for (const [name, Component, prefix] of [['Recepción', ReceptionQueryState, 'reception'], ['Dentista', DentistQueryState, 'dentist'], ['Paciente', PatientQueryState, 'patient']] as const) {
    it(`${name}: conserva éxito, error y reintento explícito`, () => {
      const refetch = vi.fn();
      const query = { isPending: false, isError: false, error: new Error('Fallo'), refetch };
      const { rerender } = render(<Component query={query} label="datos">Contenido</Component>);
      expect(screen.getByText('Contenido')).toBeInTheDocument();
      rerender(<Component query={{ ...query, isError: true }} label="datos">Contenido</Component>);
      expect(screen.queryByText('Contenido')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveClass(prefix === 'patient' ? 'patient-error' : `${prefix}-empty`);
      expect(refetch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar datos' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
    it(`${name}: conserva skeleton y prioridad de carga`, () => {
      const { container } = render(<Component query={{ isPending: true, isError: true, error: null, refetch: vi.fn() }} label="datos">No montar</Component>);
      const status = screen.getByRole('status', { name: 'Cargando datos' });
      expect(status).toHaveClass(prefix === 'patient' ? 'patient-loading' : prefix === 'dentist' ? 'dentist-skeleton' : 'reception-readonly-note');
      expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(prefix === 'patient' ? 2 : prefix === 'dentist' ? 3 : 0);
      expect(screen.queryByText('No montar')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  }
});

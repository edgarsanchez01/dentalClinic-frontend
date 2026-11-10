import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';
import { featuredTreatments, frequentQuestions } from './landingContent';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show() { return render(<MemoryRouter><LandingPage /></MemoryRouter>); }

describe('Landing estática 9C', () => {
  it('renderiza todas las secciones sin autenticación ni ninguna consulta HTTP', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); show();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const name of ['Nuestros tratamientos', '¿Por qué elegirnos?', 'Así comienza tu visita', '¿Tienes alguna duda?']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/Clínica ficticia de demostración. Contenido ilustrativo/)).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('mantiene cuatro destacados editoriales, sin precios, IDs de servicio ni contacto ficticio', () => {
    const { container } = show();
    const treatments = screen.getByRole('region', { name: 'Nuestros tratamientos' });
    expect(within(treatments).getAllByRole('article')).toHaveLength(4);
    for (const item of featuredTreatments) expect(within(treatments).getByRole('heading', { name: item.title })).toBeInTheDocument();
    expect(treatments).toHaveTextContent('los servicios que puedes reservar se consultan dentro del sistema');
    expect(container.textContent).not.toMatch(/[$€]|\b(?:MXN|USD|precio|descuento|certificado|testimonio)\b/i);
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toBeNull();
    expect(featuredTreatments.every(item => !('id' in item) && !('serviceId' in item))).toBe(true);
    expect(treatments.querySelectorAll('.landing-treatment-icon')).toHaveLength(4);
    expect(treatments.querySelector('a, button, [tabindex]')).toBeNull();
  });
  it('usa rutas reales de login, registro y reserva y anclas existentes', () => {
    const { container } = show();
    expect(screen.getAllByRole('link', { name: 'Reservar cita' })).toHaveLength(3);
    for (const cta of screen.getAllByRole('link', { name: 'Reservar cita' })) expect(cta).toHaveAttribute('href', '/appointments?create=1');
    expect(screen.getByRole('link', { name: 'Crear cuenta de paciente' })).toHaveAttribute('href', '/register');
    expect(screen.getAllByRole('link', { name: 'Iniciar sesión' })[0]).toHaveAttribute('href', '/login');
    for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href^="/#"]')) expect(container.querySelector(link.hash)).not.toBeNull();
  });
  it('FAQ usa controles nativos accesibles, con respuestas informativas y sin disponibilidad editorial', () => {
    show();
    for (const item of frequentQuestions) {
      const question = screen.getByText(item.question); expect(question.tagName).toBe('SUMMARY');
      expect(question.closest('details')).toHaveTextContent(item.answer);
    }
    expect(screen.getByText(/No se presuponen pruebas ni procedimientos incluidos/)).toBeInTheDocument();
  });
  it('fotos locales dimensionadas, hero prioritario y resto lazy; conserva contenido si falla una foto', () => {
    show();
    const images = screen.getAllByRole('img');
    expect(images[0]).toHaveAttribute('fetchpriority', 'high');
    for (const image of images) {
      expect(image.getAttribute('src')).toMatch(/^\/images\/landing\/.*\.webp$/);
      expect(image).toHaveAttribute('width'); expect(image).toHaveAttribute('height');
    }
    for (const image of images.slice(1)) expect(image).toHaveAttribute('loading', 'lazy');
    fireEvent.error(images[1]!);
    expect(screen.getByText('Fotografía ilustrativa no disponible')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Revisión y limpieza' })).toBeInTheDocument();
  });
  it('adopta la identidad compartida sin convertir el proceso en un asistente interactivo', () => {
    const { container } = show();
    expect(container.firstElementChild).toHaveClass('clinical-editorial');
    const steps = screen.getByRole('list', { name: 'Pasos para preparar tu visita' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4);
    expect(steps.querySelector('button, a, [aria-current], [role="progressbar"]')).toBeNull();
    expect(within(steps).getByRole('heading', { name: 'Accede a tu cuenta' })).toBeInTheDocument();
  });
  it('una avería del hero conserva dimensiones, titular y acceso a reserva', () => {
    show();
    fireEvent.error(screen.getAllByRole('img')[0]!);
    expect(screen.getByText('Fotografía ilustrativa no disponible')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tu sonrisa,nuestra prioridad');
    expect(screen.getAllByRole('link', { name: 'Reservar cita' })).toHaveLength(3);
  });
});

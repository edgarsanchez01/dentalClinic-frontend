import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FormAlert } from '../auth/ui';
import { careBenefits, featuredTreatments, frequentQuestions, imageCredits, visitSteps } from './landingContent';
import './landing.css';

const bookingPath = '/appointments?create=1';
const sections = [ ['inicio', 'Inicio'], ['tratamientos', 'Tratamientos'], ['nosotros', '¿Por qué nosotros?'], ['proceso', 'Proceso'], ['preguntas', 'Preguntas'] ] as const;
type IconName = 'people' | 'calendar' | 'shield' | 'heart' | 'spark' | 'check' | 'arrow' | 'tooth' | 'braces' | 'child';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h3v3H8z" /></>,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3M3 21h12" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    heart: <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></>,
    check: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m8 12 3 3 5-6M8 18h8" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    tooth: <path d="M12 4C9 2 4 2 4 7c0 3 1.3 4.5 1.8 7.5C6.3 18 7 21 8.5 21c2 0 1-7 3.5-7s1.5 7 3.5 7c1.5 0 2.2-3 2.7-6.5C18.7 11.5 20 10 20 7c0-5-5-5-8-3Z" />,
    braces: <><path d="M4 7c4-3 12-3 16 0M4 17c4 3 12 3 16 0M3 12h18" /><rect x="6" y="9" width="3" height="6" rx="1" /><rect x="15" y="9" width="3" height="6" rx="1" /><path d="M11 5v3m2 8v3" /></>,
    child: <><path d="M5 10a7 7 0 0 1 14 0M7 8c2 0 4-1 5-3 1 2 3 3 5 3M5 10a2 2 0 0 0 0 4 7 7 0 0 0 14 0 2 2 0 0 0 0-4" /><path d="M9 11h.01M15 11h.01M9 16c2 2 4 2 6 0" /></>,
  };
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Brand() {
  return <Link className="landing-brand" to="/#inicio"><Icon name="tooth" /><span className="landing-wordmark">DentalClinic<span>Sonrisas que te acompañan</span></span></Link>;
}

function BookingLink({ className = '' }: { className?: string }) {
  return <Link className={`landing-button ${className}`} to={bookingPath}><Icon name="calendar" />Reservar cita</Link>;
}

function StockImage({ name, alt, className = '', large = false, hero = false }: { name: string; alt: string; className?: string; large?: boolean; hero?: boolean }) {
  const [failed, setFailed] = useState(false);
  const image = <img
    src={`/images/landing/${name}-${hero ? '1600' : '640'}.webp`} alt={alt} width={hero ? 1600 : 640} height={hero ? 2400 : 480}
    loading={hero ? 'eager' : 'lazy'} fetchPriority={hero ? 'high' : undefined} decoding="async"
    srcSet={large ? `/images/landing/${name}-640.webp 640w, /images/landing/${name}-1120.webp 1120w` : undefined}
    sizes={large ? '(min-width: 1280px) 560px, (min-width: 768px) 45vw, calc(100vw - 40px)' : undefined}
    onError={() => setFailed(true)} />;
  return <div className={`landing-photo ${className}`}>
    {failed ? <span className="landing-image-fallback">Fotografía ilustrativa no disponible</span> : hero
      ? <picture><source media="(max-width: 767px)" srcSet="/images/landing/clinic-768.webp" />{image}</picture>
      : image}
  </div>;
}

function PublicNavigation() {
  const { hash } = useLocation();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const desktopNav = useRef<HTMLElement>(null);

  function closeMenu() { dialog.current?.close(); }
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const media = window.matchMedia('(min-width: 1024px)');
    const resize = () => { if (media.matches) closeMenu(); };
    media.addEventListener('change', resize);
    return () => { document.body.style.overflow = overflow; media.removeEventListener('change', resize); };
  }, [open]);

  return <header className="landing-header"><div className="landing-container landing-nav-row">
    <Brand />
    <nav className="landing-desktop-nav" aria-label="Navegación pública" ref={desktopNav}>
      {sections.map(([id, label]) => <Link key={id} to={`/#${id}`} aria-current={(hash || '#inicio') === `#${id}` ? 'location' : undefined}>{label}</Link>)}
    </nav>
    <div className="landing-nav-actions">
      <Link className="landing-login" to="/login">Iniciar sesión</Link>
      <BookingLink />
      <button ref={trigger} className="landing-menu-trigger" type="button" aria-label="Abrir menú público" aria-expanded={open} aria-controls="public-menu" aria-haspopup="dialog"
        onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
    </div>
  </div>
    <dialog id="public-menu" ref={dialog} className="landing-mobile-menu" aria-label="Menú público" onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const items = dialog.current!.querySelectorAll<HTMLElement>('button, a[href]');
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onClose={() => {
      setOpen(false);
      if (window.matchMedia('(min-width: 1024px)').matches) desktopNav.current?.querySelector('a')?.focus();
      else trigger.current?.focus();
    }}>
      <div className="landing-menu-top"><span>DentalClinic</span><button className="landing-secondary" type="button" onClick={closeMenu} autoFocus>Cerrar menú</button></div>
      <nav aria-label="Navegación pública móvil">{sections.map(([id, label]) => <Link key={id} to={`/#${id}`} onClick={closeMenu}>{label}</Link>)}
        <Link to="/login" onClick={closeMenu}>Iniciar sesión</Link><Link to="/register" onClick={closeMenu}>Crear cuenta</Link>
      </nav>
    </dialog>
  </header>;
}

export function LandingPage() {
  const { hash, state } = useLocation();
  const notice = (state as { notice?: unknown } | null)?.notice;
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    target?.scrollIntoView();
    if (hash === '#contenido-publico') target?.focus({ preventScroll: true });
  }, [hash]);
  return <div className="landing clinical-editorial" id="inicio">
    <Link className="landing-skip" to="/#contenido-publico">Saltar al contenido</Link>
    <PublicNavigation />
    {typeof notice === 'string' ? <div className="landing-container"><FormAlert>{notice}</FormAlert></div> : null}
    <main id="contenido-publico" tabIndex={-1}>
      <section className="landing-hero" aria-labelledby="hero-title">
        <StockImage name="clinic" alt="Consultorio dental de banco de imágenes; no corresponde a DentalClinic" className="landing-hero-photo" hero />
        <div className="landing-container landing-hero-inner">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow"><Icon name="shield" />Cuidado dental para cada etapa</span>
            <h1 id="hero-title">Tu sonrisa,<br />nuestra <span>prioridad</span></h1>
            <p>Un cuidado cercano empieza por escucharte. Conoce un enfoque dental centrado en la prevención, la información clara y tu bienestar.</p>
            <div className="landing-actions"><BookingLink /><Link className="landing-secondary" to="/#nosotros">Conocer más<Icon name="arrow" /></Link></div>
            <ul className="landing-hero-points"><li><Icon name="people" />Atención cercana</li><li><Icon name="shield" />Información clara</li><li><Icon name="heart" />Enfoque preventivo</li></ul>
          </div>
        </div>
      </section>
      <div className="landing-demo-note"><div className="landing-container">Clínica ficticia de demostración. Contenido ilustrativo y fotografías de stock; no representan instalaciones, personal ni pacientes de DentalClinic.</div></div>

      <section id="tratamientos" className="landing-section" aria-labelledby="treatments-title">
        <div className="landing-container">
          <div className="landing-section-heading"><div><span className="landing-eyebrow">Cuidado integral de tu sonrisa</span><h2 id="treatments-title">Nuestros tratamientos</h2></div>
            <p>Conoce algunas áreas del cuidado dental. Esta selección es informativa: los servicios que puedes reservar se consultan dentro del sistema.</p></div>
          <div className="landing-treatment-grid">{featuredTreatments.map((treatment, index) => <article className="landing-treatment" key={treatment.title}>
            <StockImage name={treatment.image} alt={treatment.alt} />
            <div className="landing-treatment-body"><span className="landing-treatment-icon"><Icon name={(['tooth', 'braces', 'tooth', 'child'] as const)[index]!} /></span><h3>{treatment.title}</h3><p>{treatment.description}</p></div>
          </article>)}</div>
        </div>
      </section>

      <section id="nosotros" className="landing-section landing-about" aria-labelledby="about-title">
        <div className="landing-container landing-split">
          <div className="landing-about-visual"><StockImage name="interior" alt="Interior de un consultorio de banco de imágenes, no de DentalClinic" large /></div>
          <div className="landing-about-copy"><span className="landing-eyebrow">Un enfoque en tu bienestar</span><h2 id="about-title">¿Por qué elegirnos?</h2>
            <p>DentalClinic presenta una idea sencilla: que cuidar tu sonrisa sea una experiencia comprensible y cercana. Así imaginamos la atención en nuestra clínica de demostración.</p>
            <ul className="landing-benefits">{careBenefits.map((benefit) => <li key={benefit.title}><span className="landing-icon"><Icon name={benefit.icon} /></span><div><h3>{benefit.title}</h3><p>{benefit.description}</p></div></li>)}</ul>
          </div>
        </div>
      </section>

      <section id="proceso" className="landing-section landing-process" aria-labelledby="process-title"><div className="landing-container">
        <div className="landing-section-heading"><div><span className="landing-eyebrow">Paso a paso, sin complicaciones</span><h2 id="process-title">Así comienza tu visita</h2></div></div>
        <ol className="landing-steps" aria-label="Pasos para preparar tu visita">{visitSteps.map((step, index) => <li key={step.title}>
          <div className="landing-step-top"><span className="landing-icon"><Icon name={step.icon} /></span></div>
          <div className="landing-step-copy"><span className="landing-step-number" aria-hidden="true">0{index + 1}</span><div><h3>{step.title}</h3><p>{step.description}</p></div></div>
        </li>)}</ol>
      </div></section>

      <section className="landing-cta" aria-labelledby="cta-title"><div className="landing-container landing-cta-inner">
        <div className="landing-cta-copy"><div><h2 id="cta-title">Tu próximo paso:<br />cuidar tu sonrisa</h2><p>Empieza por tu cuenta de paciente. Consulta los servicios y horarios disponibles antes de reservar.</p></div><div className="landing-cta-actions"><BookingLink className="landing-button-light" />
          <Link className="landing-cta-register" to="/register" state={{ from: bookingPath }}>¿Primera vez? Crea tu cuenta</Link></div>
        </div>
        <StockImage name="care" alt="Fotografía de stock de atención odontológica, sin relación con DentalClinic" large />
      </div></section>

      <section id="preguntas" className="landing-section" aria-labelledby="faq-title"><div className="landing-container landing-faq">
        <div className="landing-faq-intro"><span className="landing-eyebrow">Preguntas frecuentes</span><h2 id="faq-title">¿Tienes alguna duda?</h2><p>Información para dar el primer paso con tranquilidad.</p></div>
        <div className="landing-questions">{frequentQuestions.map((item) => <details key={item.question}><summary>{item.question}<span aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>
      </div></section>
    </main>
    <footer className="landing-footer"><div className="landing-container">
      <div className="landing-footer-grid"><Brand /><p>Una demostración de cuidado dental cercano, con acceso al sistema de citas de DentalClinic.</p>
        <nav aria-label="Explorar la página"><h3>Explora</h3>{sections.slice(1).map(([id, label]) => <Link key={id} to={`/#${id}`}>{label}</Link>)}</nav>
        <nav aria-label="Acceso al sistema"><h3>Tu espacio</h3><Link to="/login">Iniciar sesión</Link><Link to="/register">Crear cuenta de paciente</Link><Link to="/schedule">Consultar horarios del sistema</Link></nav>
      </div>
      <div className="landing-footer-bottom"><p>© 2026 DentalClinic · Clínica ficticia de demostración.</p><p>Información general, no asesoramiento médico.</p></div>
      <details className="landing-credits"><summary>Fotografías y licencia</summary><p>Imágenes ilustrativas de Pexels, descargadas y optimizadas para este sitio. No implican afiliación ni respaldo a DentalClinic.</p>
        <a href="https://www.pexels.com/license/" target="_blank" rel="noreferrer">Licencia Pexels (abre otra pestaña)</a><ul>{imageCredits.map((credit) => <li key={credit.url}><a href={credit.url} target="_blank" rel="noreferrer">{credit.label} (abre otra pestaña)</a></li>)}</ul>
      </details>
    </div></footer>
  </div>;
}

import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './auth.css';

export function AuthBrandPanel() {
  return <aside className="auth-brand-panel" aria-label="DentalClinic">
    <div className="auth-brand">DentalClinic<span>Clínica de demostración</span></div>
    <div className="auth-brand-message">
      <h2>Tu atención,<br />más cerca.</h2>
      <p>Un espacio para organizar tus citas y continuar con tu atención, a tu ritmo.</p>
    </div>
    <div className="auth-brand-note">
      <p>¿Es tu primera visita?</p>
      <p>Después de crear tu cuenta, te guiaremos para completar tus datos antes de reservar.</p>
    </div>
  </aside>;
}

/** Superficie exclusiva de identidad. No cambia AuthCard ni los módulos que lo comparten. */
export function AuthLayout({ title, intro, children, footer, wide = false, embedded = false }: {
  title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; embedded?: boolean;
}) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} | DentalClinic`;
    return () => { document.title = previous; };
  }, [title]);

  const Content = embedded ? 'section' : 'main';
  return <div className={`auth-layout${embedded ? ' auth-embedded' : ''}`}>
    {!embedded ? <><a className="auth-skip" href="#auth-content" onClick={event => {
      event.preventDefault(); document.getElementById('auth-content')?.focus();
    }}>Ir al formulario</a><AuthBrandPanel /></> : null}
    <div className="auth-functional">
      {!embedded ? <header className="auth-header">
        <span className="auth-mobile-brand">DentalClinic<span>Clínica de demostración</span></span>
        <Link to="/" className="auth-home">Volver a la página pública</Link>
      </header> : null}
      <Content id="auth-content" tabIndex={-1} className={`auth-content${wide ? ' auth-content-wide' : ''}`}>
        <div className="auth-heading"><h1>{title}</h1>{intro ? <p>{intro}</p> : null}</div>
        {children}
        {footer ? <AuthFooterNavigation>{footer}</AuthFooterNavigation> : null}
      </Content>
      {!embedded ? <p className="auth-demo-note">Entorno de demostración. Utiliza solo datos ficticios.</p> : null}
    </div>
  </div>;
}

export function AuthFooterNavigation({ children }: { children: ReactNode }) {
  return <nav className="auth-footer" aria-label="Opciones de acceso">{children}</nav>;
}

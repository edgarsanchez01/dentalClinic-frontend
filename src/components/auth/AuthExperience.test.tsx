import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/http';
import { ActivatePage } from './ActivatePage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { RegisterPage } from './RegisterPage';
import { passwordError } from './authValidation';
import { PasswordField } from './AuthForm';

afterEach(() => vi.restoreAllMocks());
function show(element: React.ReactNode, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
}

describe('UX-01: reglas de contraseña verificadas contra PasswordPolicy', () => {
  it('no inventa longitud mínima ni composición', () => {
    expect(passwordError('a')).toBeUndefined();
    expect(passwordError('una frase sin cifras')).toBeUndefined();
    expect(passwordError('   ')).toBeTruthy();
  });
  it('mide 72 bytes UTF-8, no caracteres, sin truncar', () => {
    for (const [value, valid] of [['a'.repeat(72), true], ['a'.repeat(73), false], ['á'.repeat(36), true], ['á'.repeat(37), false], ['😀'.repeat(18), true], ['😀'.repeat(19), false]] as const) {
      expect(passwordError(value) === undefined).toBe(valid);
    }
  });
});

describe('UX-01: formularios accesibles de identidad', () => {
  it('mostrar y ocultar conservan contraseña, semántica y autocomplete', () => {
    show(<PasswordField id="password" label="Contraseña" value="clave sintética" onChange={() => {}} autoComplete="current-password" />);
    const field = screen.getByLabelText('Contraseña');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveValue('clave sintética');
  });
  it('el registro solo solicita los cinco campos iniciales y explica la sesión automática', () => {
    show(<RegisterPage />);
    expect(screen.getAllByLabelText(/Correo electrónico|^Contraseña$|Repite la contraseña|^Nombre$|^Apellidos$/)).toHaveLength(5);
    expect(screen.queryByLabelText(/Teléfono|Fecha de nacimiento/)).not.toBeInTheDocument();
    expect(screen.getByText(/Entrarás directamente a tu cuenta/)).toBeInTheDocument();
  });
  it('valida antes de la red y enfoca un resumen enlazado sin robar foco al corregir', async () => {
    const api = vi.spyOn(authApi, 'requestPasswordReset');
    show(<ForgotPasswordPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar enlace' }));
    const summary = screen.getByRole('alert');
    expect(summary).toHaveFocus();
    fireEvent.click(screen.getByRole('link', { name: /completa este campo/ }));
    const email = screen.getByLabelText('Correo electrónico');
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-describedby', 'email-error');
    fireEvent.change(email, { target: { value: 'no-es-correo' } });
    expect(email).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar enlace' }));
    expect(summary).toHaveTextContent('Escribe un correo con un formato válido.');
    expect(api).not.toHaveBeenCalled();
  });
  it('bloquea envíos duplicados y confirma solicitud, no entrega de correo', async () => {
    let finish!: () => void;
    const api = vi.spyOn(authApi, 'requestPasswordReset').mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const { container } = show(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'sintetico@example.test' } });
    fireEvent.submit(container.querySelector('form')!);
    fireEvent.submit(container.querySelector('form')!);
    expect(api).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    finish();
    expect(await screen.findByRole('status')).toHaveTextContent('Esta confirmación no acredita el envío');
  });
  it('asocia errores backend al campo sin borrar el valor corregible', async () => {
    vi.spyOn(authApi, 'requestPasswordReset').mockRejectedValue(new ApiError(400, {
      status: 400, error: 'Bad Request', message: 'Revisa los datos.', path: '', timestamp: '', fieldErrors: { email: 'Formato no admitido.' },
    }, ''));
    show(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'sintetico@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar enlace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato no admitido.');
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('sintetico@example.test');
  });
  it.each([false, true])('enlace ausente de activación=%s no muestra campos ni consume token', activation => {
    show(activation ? <ActivatePage /> : <ResetPasswordPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('El enlace es inválido');
    expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument();
  });
  it.each([false, true])('token caducado de activación=%s ofrece recuperación adecuada', async activation => {
    const api = vi.spyOn(authApi, activation ? 'activate' : 'resetPassword').mockRejectedValue(new ApiError(401, null, 'Token inválido.'));
    show(activation ? <ActivatePage /> : <ResetPasswordPage />, '/?token=sintetico');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: activation ? 'Activar cuenta' : 'Restablecer' }));
    await waitFor(() => expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument());
    expect(api).toHaveBeenCalledWith('sintetico', 'a');
    expect(screen.getByRole('alert')).toHaveTextContent('ha caducado o ya se utilizó');
    if (activation) expect(screen.getByText(/Solicita una nueva invitación/)).toBeInTheDocument();
    else expect(screen.getByRole('link', { name: 'Solicitar un enlace nuevo' })).toHaveAttribute('href', '/forgot-password');
  });
  it('restablecimiento exitoso permite login, sin activar sesión automáticamente', async () => {
    vi.spyOn(authApi, 'resetPassword').mockResolvedValue();
    const login = vi.spyOn(authApi, 'login');
    show(<ResetPasswordPage />, '/?token=sintetico');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    expect(await screen.findByRole('heading', { name: 'Contraseña actualizada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
    expect(login).not.toHaveBeenCalled();
  });
});

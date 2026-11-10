import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Role } from '../src/api/auth';
import type { StaffUserDto, UpdateDentistInput } from '../src/api/users';

const owner: StaffUserDto = { id: 1, email: 'owner@example.test', role: 'OWNER', active: true, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00Z',
  dentist: { firstName: 'Ada', lastName: 'Owner', phone: '+34 600 000 000', specialty: null, licenseNumber: null, publicInfo: null, photoUrl: null } };
const first: StaffUserDto = { ...owner, id: 2, email: 'ana@example.test', role: 'DENTIST', dentist: { ...owner.dentist!, firstName: 'Ana', lastName: 'Alfa', photoUrl: 'https://example.test/ana.jpg' } };
const second: StaffUserDto = { ...owner, id: 5, email: 'beatriz@example.test', role: 'DENTIST', dentist: { ...owner.dentist!, firstName: 'Beatriz', lastName: 'Beta', photoUrl: 'https://example.test/beatriz.jpg' } };
const reception: StaffUserDto = { ...owner, id: 3, email: 'reception@example.test', role: 'RECEPTIONIST', dentist: null };
const pending: StaffUserDto = { ...first, id: 6, email: 'pending@example.test', active: false, status: 'PENDING', dentist: { ...first.dentist!, firstName: 'Perfil', lastName: 'Pendiente' } };

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture(page: Page, role: Role = 'OWNER', delayedPut?: Promise<void>) {
  let team = structuredClone([owner, first, second, reception, pending]);
  const calls: { path: string; method: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  await page.route(url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/actuator/'), async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body: unknown = request.postData() ? request.postDataJSON() : undefined;
    calls.push({ path, method, body });
    if (path === '/api/auth/refresh') return route.fulfill({ json: { accessToken: 'owner-team-intercepted' } });
    if (path === '/api/auth/me') return route.fulfill({ json: { ...owner, role, dentistId: 1, patientId: 9 } });
    if (path === '/api/onboarding/status') return route.fulfill({ json: { status: 'COMPLETED', clinicConfigured: true } });
    if (path === '/api/notifications/unread-count') return route.fulfill({ json: { unread: 0 } });
    if (path === '/api/users' && method === 'GET') return route.fulfill({ json: team });
    const profile = path.match(/^\/api\/users\/(\d+)\/dentist$/);
    if (profile && method === 'PUT') {
      if (delayedPut) await delayedPut;
      const id = Number(profile[1]);
      const member = team.find(item => item.id === id)!;
      const result = { ...member, dentist: { ...member.dentist!, ...(body as UpdateDentistInput) } };
      team = team.map(item => item.id === id ? result : item);
      return route.fulfill({ json: result });
    }
    if (path === '/api/users/3/active' && method === 'PATCH') {
      const active = (body as { active: boolean }).active;
      const result: StaffUserDto = { ...reception, active, status: active ? 'ACTIVE' : 'INACTIVE' };
      team = team.map(item => item.id === result.id ? result : item);
      return route.fulfill({ json: result });
    }
    if (path === '/api/users/6/invitations/resend' && method === 'POST') {
      return route.fulfill({ json: { userId: 6, email: pending.email, token: 'invitation-test-only' } });
    }
    if (path === '/api/users/receptionists' && method === 'POST') {
      const result: StaffUserDto = { ...reception, id: 8, email: (body as { email: string }).email, active: false, status: 'PENDING' };
      team = [...team, result];
      return route.fulfill({ status: 201, json: result });
    }
    unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'API no prevista en esta prueba interceptada.' } });
  });
  return { calls, unexpected, puts: () => calls.filter(call => call.method === 'PUT') };
}

async function discard(page: Page, trigger: Locator, accept: boolean) {
  await trigger.focus();
  const next = page.waitForEvent('dialog');
  const action = trigger.press('Enter');
  const dialog = await next;
  expect(dialog.type()).toBe('confirm');
  expect(dialog.message()).toBe('¿Descartar los cambios sin guardar de este perfil?');
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await action;
}

async function navigateToPassword(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('dialog', { name: 'Menú de navegación' }).getByRole('link', { name: 'Contraseña', exact: true }).click();
  } else {
    const link = page.getByRole('navigation', { name: 'Navegación de escritorio' }).getByRole('link', { name: 'Contraseña', exact: true });
    await link.focus();
    await link.press('Enter');
  }
}

for (const width of [1440, 390]) {
  test(`DC-OWNER-02: aislamiento, descarte y navegación con teclado a ${width}px (API interceptada)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = gate();
    const api = await fixture(page, 'OWNER', response.promise);
    await page.goto('/users');
    const openFirst = page.getByRole('button', { name: 'Editar perfil Ana Alfa' });
    await openFirst.focus();
    await openFirst.press('Enter');
    const form = page.getByRole('form', { name: 'Editar perfil de Ana Alfa' });
    await expect(form.getByLabel('Nombre', { exact: true })).toBeFocused();
    await form.getByLabel('Nombre', { exact: true }).fill('');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(form.getByText('Escribe un nombre de hasta 100 caracteres.')).toBeVisible();
    await discard(page, page.getByRole('button', { name: 'Editar perfil Beatriz Beta' }), false);
    await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue('');
    await expect(form.getByText('Escribe un nombre de hasta 100 caracteres.')).toBeVisible();
    await openFirst.click();
    await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue('');
    await discard(page, page.getByRole('button', { name: 'Editar perfil Beatriz Beta' }), true);
    expect(api.puts()).toHaveLength(0);

    const nextForm = page.getByRole('form', { name: 'Editar perfil de Beatriz Beta' });
    await expect(nextForm.getByLabel('Nombre', { exact: true })).toHaveValue('Beatriz');
    await expect(nextForm.getByLabel('Nombre', { exact: true })).toBeFocused();
    await nextForm.getByLabel('Nombre', { exact: true }).fill('Beatriz editada');
    await nextForm.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect.poll(() => api.puts().length).toBe(1);
    expect(api.puts()[0]).toEqual({ path: '/api/users/5/dentist', method: 'PUT', body: {
      firstName: 'Beatriz editada', lastName: 'Beta', phone: second.dentist!.phone,
      specialty: null, licenseNumber: null, publicInfo: null, photoUrl: second.dentist!.photoUrl,
    } });
    await expect(nextForm.getByLabel('Nombre', { exact: true })).toBeDisabled();
    await expect(openFirst).toBeDisabled();
    await expect(nextForm.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    response.release();
    await expect(page.getByText('Perfil de «Beatriz editada Beta» actualizado.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar perfil Beatriz editada Beta' })).toBeFocused();

    await openFirst.click();
    await form.getByLabel('Nombre', { exact: true }).fill('Borrador local');
    await page.screenshot({ path: `/tmp/opencode/dc-owner-02/equipo-${width}.png`, fullPage: true });
    await navigateToPassword(page, width < 768);
    const confirmation = page.getByRole('dialog', { name: 'Tienes cambios sin guardar' });
    await expect(confirmation.getByRole('button', { name: 'Seguir aquí' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue('Borrador local');
    await navigateToPassword(page, width < 768);
    await page.getByRole('dialog', { name: 'Tienes cambios sin guardar' }).getByRole('button', { name: 'Salir sin guardar' }).click();
    await expect(page.getByRole('heading', { name: 'Cambiar contraseña', exact: true })).toBeVisible();
    expect(api.puts()).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  });

  test(`DC-OWNER-02: respuesta tardía tras salir no contamina B a ${width}px (API interceptada)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = gate();
    const api = await fixture(page, 'OWNER', response.promise);
    await page.goto('/users');
    await page.getByRole('button', { name: 'Editar perfil Ana Alfa' }).click();
    const form = page.getByRole('form', { name: 'Editar perfil de Ana Alfa' });
    await form.getByLabel('Nombre', { exact: true }).fill('Ana enviada');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect.poll(() => api.puts().length).toBe(1);
    await navigateToPassword(page, width < 768);
    const confirmation = page.getByRole('dialog', { name: 'Guardado en curso' });
    await expect(confirmation.getByText('Hay un guardado en curso. Salir no garantiza que la operación se cancele')).toBeVisible();
    await confirmation.getByRole('button', { name: 'Salir de esta vista' }).click();
    await expect(page).toHaveURL(/\/change-password$/);
    // History changes before React commits the destination and releases the old guard.
    await expect(page.getByRole('heading', { name: 'Cambiar contraseña', exact: true })).toBeVisible();
    await expect(page.locator('dialog[data-unsaved-dialog][open]')).toHaveCount(0);
    await page.goBack();
    await page.getByRole('button', { name: 'Editar perfil Beatriz Beta' }).click();
    const nextForm = page.getByRole('form', { name: 'Editar perfil de Beatriz Beta' });
    await nextForm.getByLabel('Nombre', { exact: true }).fill('');
    await nextForm.getByRole('button', { name: 'Guardar cambios' }).click();
    const completed = page.waitForResponse(reply => reply.url().endsWith('/api/users/2/dentist') && reply.request().method() === 'PUT');
    response.release();
    await completed;
    await expect(nextForm.getByLabel('Nombre', { exact: true })).toHaveValue('');
    await expect(nextForm.getByText('Escribe un nombre de hasta 100 caracteres.')).toBeVisible();
    await expect(page.getByText('Perfil de «Ana enviada Alfa» actualizado.')).toHaveCount(0);
    await expect(nextForm.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    expect(api.puts()).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  });
}

for (const role of ['DENTIST', 'RECEPTIONIST', 'PATIENT'] as const) {
  test(`DC-OWNER-02: ${role} no monta Equipo ni solicita sus APIs`, async ({ page }) => {
    const api = await fixture(page, role);
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
    expect(api.calls.filter(call => call.path.startsWith('/api/users'))).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}

test('DC-OWNER-02: restricciones de estado, reemisión e invitación de recepción se conservan', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'Equipo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desactivar Ada Owner' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desactivar Perfil Pendiente' })).toHaveCount(0);
  await page.getByRole('listitem').filter({ hasText: 'pending@example.test' }).getByRole('button', { name: 'Copiar enlace de activación' }).click();
  await expect(page.getByLabel('Enlace de activación')).toHaveValue(/\/activate\?token=invitation-test-only$/);
  await page.getByRole('button', { name: 'Invitar recepción', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('nueva@example.test');
  await page.getByRole('button', { name: 'Invitar recepción', exact: true }).last().click();
  await expect(page.getByText('Invitación de recepción creada.')).toBeVisible();
  expect(api.calls.find(call => call.path === '/api/users/receptionists')).toEqual({ path: '/api/users/receptionists', method: 'POST', body: { email: 'nueva@example.test' } });
  await page.getByRole('button', { name: 'Desactivar reception@example.test' }).click();
  await page.getByRole('button', { name: 'Confirmar desactivación' }).click();
  await expect(page.getByRole('button', { name: 'Reactivar reception@example.test' })).toBeVisible();
  await page.getByRole('button', { name: 'Reactivar reception@example.test' }).click();
  await page.getByRole('button', { name: 'Confirmar reactivación' }).click();
  await expect(page.getByRole('button', { name: 'Desactivar reception@example.test' })).toBeVisible();
  expect(api.calls.filter(call => call.method === 'PATCH').map(call => call.body)).toEqual([{ active: false }, { active: true }]);
  expect(api.puts()).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

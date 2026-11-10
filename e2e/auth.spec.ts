import { expect, test, type Page, type Route } from '@playwright/test';

const ANA = {
  id: 1,
  email: 'ana@clinica.com',
  role: 'OWNER',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
};

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

type Handler = (route: Route) => Promise<void> | void;

/**
 * Intercepta el backend por ruta+metodo. Lo no declarado responde 404, que es
 * justo lo que necesita `hydrate` para concluir "sin sesion".
 */
async function mockBackend(page: Page, handlers: Record<string, Handler>): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const url = new URL(route.request().url());
      const key = `${route.request().method()} ${url.pathname}`;
      const handler = handlers[key];
      if (handler) {
        return handler(route);
      }
      return json(route, 404, {});
    },
  );
  await page.route(
    (url) => url.pathname.startsWith('/actuator/'),
    (route) => json(route, 200, { status: 'UP' }),
  );
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.describe('Autenticacion (Fase 2)', () => {
  test('sin sesion, la raíz muestra la landing y las rutas privadas conservan login', async ({ page }) => {
    await mockBackend(page, {
      'POST /api/auth/refresh': (route) => json(route, 401, {}),
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/appointments?create=1');
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('credenciales invalidas muestran el mensaje neutro y no abren sesion', async ({ page }) => {
    await mockBackend(page, {
      'POST /api/auth/refresh': (route) => json(route, 401, {}),
      'POST /api/auth/login': (route) =>
        json(route, 401, {
          status: 401,
          error: 'Unauthorized',
          message: 'Credenciales incorrectas.',
          path: '/api/auth/login',
          timestamp: '2026-01-01T00:00:00Z',
        }),
    });

    await page.goto('/login');
    await login(page, 'ana@clinica.com', 'mala');

    await expect(page.getByRole('alert')).toHaveText('Credenciales incorrectas.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('login correcto entra a la home y no persiste el token en storage', async ({ page }) => {
    await mockBackend(page, {
      'POST /api/auth/refresh': (route) => json(route, 401, {}),
      'POST /api/auth/login': (route) =>
        json(route, 200, {
          accessToken: 'access-1',
          tokenType: 'Bearer',
          accessTokenExpiresAt: '2026-01-01T00:15:00Z',
          user: ANA,
        }),
      'GET /api/auth/me': (route) => json(route, 200, ANA),
    });

    await page.goto('/login');
    await login(page, 'ana@clinica.com', 'Clave1234');

    await expect(page.getByRole('heading', { name: 'Resumen de la clínica' })).toBeVisible();
    await page.getByRole('banner').getByText('Cuenta', { exact: true }).click();
    await expect(page.getByText('ana@clinica.com', { exact: true })).toBeVisible();
    const persisted = await page.evaluate(() => ({ ...localStorage, ...sessionStorage }));
    expect(JSON.stringify(persisted)).not.toContain('access-1');
  });

  test('una recarga restaura la sesion con refresh + /me', async ({ page }) => {
    await mockBackend(page, {
      'POST /api/auth/refresh': (route) => json(route, 200, { accessToken: 'access-2' }),
      'GET /api/auth/me': (route) => json(route, 200, ANA),
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Resumen de la clínica' })).toBeVisible();
  });

  test('cerrar sesión vuelve a la landing pública', async ({ page }) => {
    await mockBackend(page, {
      'POST /api/auth/refresh': (route) => json(route, 200, { accessToken: 'access-3' }),
      'GET /api/auth/me': (route) => json(route, 200, ANA),
      'POST /api/auth/logout': (route) => json(route, 204, {}),
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Resumen de la clínica' })).toBeVisible();

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();

    await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});

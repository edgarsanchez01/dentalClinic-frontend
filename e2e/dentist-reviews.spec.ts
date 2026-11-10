import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-10-26T16:00:00Z';
const ownComment = 'Me explicó cada paso con claridad.\nMe sentí escuchada durante la consulta.';

// Synthetic authorized responses only. All APIs, unknown routes and attempted writes
// are intercepted: this is browser validation, not real backend integration.
async function fixture(page: Page, role = 'DENTIST', identity = 7) {
  const state = { error: false, empty: false, average: 4.375 as number | null, long: false, onePage: false };
  const calls: Array<{ path: string; method: string; search: string }> = [];
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    calls.push({ path, method, search: url.search });
    let body: unknown;
    if (path === '/api/auth/refresh') body = { accessToken: `synthetic-${role}-${identity}` };
    else if (path === '/api/auth/me') body = { id: identity, email: 'synthetic@example.test', role, active: true, dentistId: identity, createdAt: NOW };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else if (path === '/api/feedback' && method === 'GET') {
      if (role !== 'DENTIST' && role !== 'OWNER') { await route.fulfill({ status: 403, json: {} }); return; }
      if (state.error) { await route.fulfill({ status: 503, json: {} }); return; }
      const current = Number(url.searchParams.get('page') ?? 0);
      // Scope is selected by the simulated server's actor, never by a client dentistId.
      const comment = role === 'OWNER' ? 'Reseña global de otro profesional.' : identity === 7 ? ownComment : 'Reseña del segundo profesional autorizado.';
      const count = state.empty ? 0 : role === 'OWNER' ? 83 : identity === 7 ? 47 : 1;
      body = { count, average: state.empty ? null : state.average, page: current, size: 20, totalElements: count, totalPages: state.empty ? 0 : state.onePage || identity !== 7 ? 1 : 3,
        content: state.empty ? [] : current === 0 ? [
          { id: 101, rating: 5, comment: state.long ? `${'Comentario extenso. '.repeat(60)}\n${'palabralarga'.repeat(60)}` : comment, respondedAt: '2026-10-25T16:30:00Z' },
          { id: 102, rating: 2, comment: null, respondedAt: '2026-10-24T18:15:00Z' },
          { id: 103, rating: 4, comment: '<script>no ejecutar</script>', respondedAt: '2026-10-23T12:00:00Z' },
        ] : [{ id: current === 1 ? 201 : 301, rating: 3, comment: `Comentario autorizado de la página ${current + 1}.`, respondedAt: '2026-10-20T12:00:00Z' }] };
    } else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body });
  });
  return { state, calls };
}

test('BUILD05 OWNER conserva resultados, vacío y error en los cuatro anchos', async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!process.env.DC_REVIEWS_CAPTURE, 'Baseline opt-in con configuración aislada.');
  const api = await fixture(page, 'OWNER');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const variant of ['results', 'empty', 'error']) {
      api.state.empty = variant === 'empty'; api.state.error = variant === 'error';
      await page.goto('/reviews');
      if (variant === 'results') await expect(page.getByText('Reseña global de otro profesional.')).toBeVisible();
      else if (variant === 'empty') await expect(page.getByText('Aún no hay reseñas para mostrar.')).toBeVisible();
      else await expect(page.getByRole('alert')).toContainText('No se pudieron cargar las reseñas.');
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`OWNER-reviews-${variant}-${width}.png`, { fullPage: true, animations: 'disabled', maxDiffPixels: 0 });
    }
  }
});

for (const width of [1440, 768, 390, 320]) {
  test(`BUILD05 DENTIST resumen, reseñas, fechas y paginación a ${width}px`, async ({ page }) => {
    const api = await fixture(page);
    await page.setViewportSize({ width, height: 1000 });
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/feedback');
    await page.goto('/reviews?dentistId=8');
    const authorized = await (await response).json();
    expect(authorized.content[0].comment).toBe(ownComment);
    expect(authorized.count).toBe(47); expect(authorized.average).toBe(4.375);
    await expect(page.getByRole('heading', { name: 'Reseñas de pacientes', exact: true })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.locator('.reviews-summary')).toContainText('47');
    await expect(page.locator('.reviews-summary')).toContainText('4.38 de 5');
    await expect(page.getByRole('article')).toHaveCount(3);
    await expect(page.getByText('Reseña global de otro profesional.')).toHaveCount(0);
    await expect(page.getByText('Sin comentario', { exact: true })).toBeVisible();
    await expect(page.getByText('<script>no ejecutar</script>', { exact: true })).toBeVisible();
    expect(await page.locator('.reviews-comment').first().textContent()).toBe(ownComment);
    await expect(page.locator('time').first()).toHaveAttribute('datetime', '2026-10-25T16:30:00Z');
    await expect(page.locator('time').first()).toContainText('2026');
    await expect(page.locator('.reviews-rating').first()).toContainText('5 de 5 estrellas');
    await expect(page.locator('.reviews-rating').first().locator('svg[fill="currentColor"]')).toHaveCount(5);
    await expect(page.locator('.reviews-rating').nth(1).locator('svg[fill="currentColor"]')).toHaveCount(2);
    await expect(page.locator('.reviews-page').locator('input,textarea,select,form')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: /Responder|Moderar|Eliminar|Editar|Publicar/ })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`dentist-reviews-${width}.png`), fullPage: true, animations: 'disabled' });
    const pagination = page.getByRole('navigation', { name: 'Páginas de reseñas', exact: true });
    await expect(pagination.getByRole('button', { name: 'Anterior', exact: true })).toBeDisabled();
    const next = pagination.getByRole('button', { name: 'Siguiente', exact: true });
    const box = (await next.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    await next.focus();
    await expect(next).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Comentario autorizado de la página 2.')).toBeVisible();
    await expect(pagination).toContainText('Página 2 de 3');
    await expect(page.locator('.reviews-summary')).toContainText('47');
    await expect(page.locator('.reviews-summary')).toContainText('4.38 de 5');
    await next.click();
    await expect(page.getByText('Comentario autorizado de la página 3.')).toBeVisible();
    await expect(next).toBeDisabled();
    await pagination.getByRole('button', { name: 'Anterior', exact: true }).click();
    await expect(page.getByText('Comentario autorizado de la página 2.')).toBeVisible();
    const reads = api.calls.filter(({ path }) => path === '/api/feedback');
    expect(reads.map(({ search }) => search)).toEqual(['?page=0&size=20', '?page=1&size=20', '?page=2&size=20', '?page=1&size=20']);
    expect(api.calls.filter(({ path }) => !path.startsWith('/api/auth/')).every(({ method }) => method === 'GET')).toBe(true);
  });
}

test('BUILD05 carga, error recuperable y vacío sin estadísticas inventadas', async ({ page }) => {
  const api = await fixture(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  let release!: () => void;
  await page.route('**/api/feedback?**', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; }); await route.fallback();
  }, { times: 1 });
  await page.goto('/reviews');
  await expect(page.getByRole('status', { name: 'Cargando reseñas' })).toBeVisible();
  await expect(page.locator('.reviews-summary')).toHaveCount(0);
  await expect(page.getByText('Aún no hay reseñas para mostrar.')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('dentist-reviews-loading-390.png'), fullPage: true });
  api.state.error = true; release();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Sin valoraciones')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('dentist-reviews-error-390.png'), fullPage: true });
  api.state.error = false; api.state.empty = true;
  await page.getByRole('button', { name: 'Reintentar reseñas' }).click();
  await expect(page.getByText('Aún no hay reseñas para mostrar.')).toBeVisible();
  await expect(page.getByText('Sin valoraciones')).toBeVisible();
  await expect(page.locator('.reviews-summary dd').first()).toHaveText('0');
  await expect(page.getByRole('navigation', { name: 'Páginas de reseñas' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('dentist-reviews-empty-390.png'), fullPage: true });
  expect(api.calls.filter(({ path }) => path === '/api/feedback').map(({ search }) => search)).toEqual(['?page=0&size=20', '?page=0&size=20']);
});

test('BUILD05 error en página posterior reintenta esa página sin mezclar comentarios', async ({ page }) => {
  await fixture(page);
  await page.goto('/reviews');
  await expect(page.getByText(ownComment)).toBeVisible();
  await page.route('**/api/feedback?page=1&**', (route) => route.fulfill({ status: 503, json: {} }), { times: 1 });
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(ownComment)).toHaveCount(0);
  await page.getByRole('button', { name: 'Reintentar reseñas' }).click();
  await expect(page.getByText('Comentario autorizado de la página 2.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Páginas de reseñas' })).toContainText('Página 2 de 3');
});

test('BUILD05 comentarios largos, promedio nulo y contenido al 200% sin desbordes', async ({ page }) => {
  const api = await fixture(page); api.state.long = true; api.state.average = null; api.state.onePage = true;
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/reviews');
    await expect(page.getByText('Sin valoraciones')).toBeVisible();
    await expect(page.locator('.reviews-comment').first()).toContainText('palabralarga');
    await expect(page.getByRole('navigation', { name: 'Páginas de reseñas' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 720, height: 500 });
  await page.locator('.reviews-page').evaluate((root) => {
    const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
    const sizes = elements.map(el => parseFloat(getComputedStyle(el).fontSize));
    elements.forEach((el, index) => { (el as HTMLElement).style.fontSize = `${sizes[index]! * 2}px`; });
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dentist-reviews-long-720.png'), fullPage: true });
});

for (const role of ['PATIENT', 'RECEPTIONIST']) {
  test(`BUILD05 ${role} no monta reseñas ni consulta su API`, async ({ page }) => {
    const api = await fixture(page, role);
    await page.goto('/reviews');
    await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
    expect(api.calls.some(({ path }) => path === '/api/feedback')).toBe(false);
    await expect(page.getByRole('link', { name: 'Reseñas', exact: true })).toHaveCount(0);
  });
}

test('BUILD05 otra identidad DENTIST recibe su respuesta autorizada, no las reseñas del primero', async ({ page }) => {
  const api = await fixture(page, 'DENTIST', 8);
  await page.goto('/reviews');
  await expect(page.getByText('Reseña del segundo profesional autorizado.')).toBeVisible();
  await expect(page.getByText(ownComment)).toHaveCount(0);
  await expect(page.locator('.reviews-summary dd').first()).toHaveText('1');
  expect(api.calls.filter(({ path }) => path === '/api/feedback').map(({ search }) => search)).toEqual(['?page=0&size=20']);
});

test('BUILD05 contraste AA representativo y datos sin persistencia del navegador', async ({ page }) => {
  await fixture(page); await page.goto('/reviews');
  await expect(page.locator('.reviews-summary')).toContainText('47');
  const samples = await page.locator('.reviews-page').evaluate((root) => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d')!;
    function rgb(color: string) { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data); }
    function luminance(color: string) { return rgb(color).slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0); }
    return [...root.querySelectorAll('h1,h2,dt,dd,.reviews-rating,.reviews-date,.reviews-comment,.reviews-pagination-status,button')].map((el) => {
      let surface: Element = el;
      while (surface.parentElement && rgb(getComputedStyle(surface).backgroundColor)[3] === 0) surface = surface.parentElement;
      const css = getComputedStyle(el), a = luminance(css.color), b = luminance(getComputedStyle(surface).backgroundColor);
      return { text: el.textContent?.slice(0, 50), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), large: parseFloat(css.fontSize) >= 24, disabled: el.matches(':disabled') };
    });
  });
  for (const sample of samples.filter(sample => !sample.disabled)) expect(sample.contrast, sample.text).toBeGreaterThanOrEqual(sample.large ? 3 : 4.5);
  expect(await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, databases: (await indexedDB.databases()).length }))).toEqual({ local: 0, session: 0, databases: 0 });
});

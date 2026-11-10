import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-10-13T06:00:00Z';
const patient = { id: 9, email: 'patient@landing.test', role: 'PATIENT', active: true, patientId: 5, createdAt: NOW,
  medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } };
const service = { id: 73, name: 'Servicio operativo de prueba', description: null, durationMinutes: 30, referencePrice: 25 };
const days = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [] }));

/** SPA/navegador reales; APIs interceptadas. Nunca accede al backend ni PostgreSQL. */
async function fixture(page: Page, options: { registerError?: boolean; noServices?: boolean; slotsError?: boolean } = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  const calls: string[] = [], registrations: Record<string, unknown>[] = [], reservations: Record<string, unknown>[] = [];
  let authenticated = false;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    calls.push(path);
    if (path === '/api/auth/refresh') { await route.fulfill({ status: authenticated ? 200 : 401, json: { accessToken: 'landing-mock' } }); return; }
    if (path === '/api/auth/register') {
      registrations.push(request.postDataJSON());
      if (!options.registerError) authenticated = true;
      await route.fulfill({ status: options.registerError ? 409 : 201, json: options.registerError ? { message: 'No se pudo crear la cuenta. Revisa los datos.' } : { accessToken: 'landing-mock', user: patient } }); return;
    }
    if (path === '/api/auth/login') { authenticated = true; await route.fulfill({ json: { accessToken: 'landing-mock', user: patient } }); return; }
    if (path === '/api/availability' && options.slotsError) { await route.fulfill({ status: 503, json: { message: 'No se pudo consultar la disponibilidad. Inténtalo de nuevo.' } }); return; }
    let body: unknown;
    if (path === '/api/auth/me') body = patient;
    else if (path === '/api/public/schedule') body = { timezone: 'UTC', days, exceptions: [], dentists: [{ dentistId: 7, firstName: 'Profesional', lastName: 'de prueba', days }] };
    else if (path === '/api/availability/policy') body = { timezone: 'UTC', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 };
    else if (path === '/api/public/services') body = options.noServices ? [] : [service];
    else if (path === '/api/availability') {
      expect(url.searchParams.get('serviceId')).toBe('73');
      body = { dentistId: 7, durationMinutes: 30, timezone: 'UTC', slots: [{ startDate: '2026-10-13', startTime: '09:00:00', endTime: '09:30:00', start: '2026-10-13T09:00:00Z', end: '2026-10-13T09:30:00Z' }] };
    } else if (path === '/api/appointments' && request.method() === 'POST') {
      expect(request.headers()['idempotency-key']).toBeTruthy(); reservations.push(request.postDataJSON());
      await route.fulfill({ status: 201, json: { id: 42, ...request.postDataJSON(), patientFirstName: 'Paciente', patientLastName: 'de prueba', dentistFirstName: 'Profesional', dentistLastName: 'de prueba', status: 'SCHEDULED', occurrenceVersion: 1, durationMinutes: 30, createdByUserId: 9, createdAt: NOW, service } }); return;
    } else if (path === '/api/appointments') body = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
    else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body });
  });
  return { calls, registrations, reservations };
}

async function login(page: Page) {
  await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(patient.email);
  await page.getByLabel('Contraseña', { exact: true }).fill('Demo-password-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

for (const width of [320, 390, 768, 1440]) {
  test(`9C pública: composición, imágenes, contraste, teclado y responsive a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    const { calls } = await fixture(page);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const external: string[] = []; page.on('request', request => { if (!request.url().startsWith('http://localhost:5189')) external.push(request.url()); });
    await page.goto('/'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu sonrisa,nuestra prioridad');
    await expect(page).toHaveURL(/\/$/);
    await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
    await page.keyboard.press('Enter'); await expect(page.locator('#contenido-publico')).toBeFocused();
    const treatments = page.getByRole('region', { name: 'Nuestros tratamientos' });
    await expect(treatments.getByRole('article')).toHaveCount(4);
    await expect(treatments.locator('a, button')).toHaveCount(0);
    await expect(treatments.locator('.landing-treatment-icon')).toHaveCount(4);
    await expect(page.getByRole('region', { name: '¿Por qué elegirnos?' }).getByRole('listitem')).toHaveCount(4);
    if (width === 1440) {
      expect(await page.locator('.landing-benefits').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
      expect(await page.locator('.landing-hero-photo').evaluate(el => getComputedStyle(el).position)).toBe('absolute');
      expect((await page.locator('.landing-hero').boundingBox())!.height).toBeLessThan(600);
      expect((await page.locator('.landing-cta-inner').boundingBox())!.height).toBeLessThan(420);
    }
    const identity = await page.locator('.landing').evaluate(el => {
      const style = getComputedStyle(el);
      return { petrol: style.getPropertyValue('--auth-petrol').trim(), sage: style.getPropertyValue('--auth-sage').trim(), font: style.fontFamily };
    });
    expect(identity.petrol).toBe('#193f43'); expect(identity.sage).toBe('#b9d6c9'); expect(identity.font).toContain('IBM Plex Sans');
    const steps = page.getByRole('list', { name: 'Pasos para preparar tu visita' });
    await expect(steps.getByRole('listitem')).toHaveCount(4);
    await expect(steps.locator('a, button, [aria-current]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/[$€]|\b(?:MXN|USD|precio|descuento)\b/i);
    for (const id of ['tratamientos', 'nosotros', 'proceso', 'preguntas']) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    const question = page.getByText('¿Los tratamientos de esta página se pueden reservar?', { exact: true });
    await question.focus(); await page.keyboard.press('Enter');
    await expect(question.locator('..')).toHaveAttribute('open', '');
    await expect(question.locator('..')).toContainText('No representan el catálogo operativo');
    await page.keyboard.press('Space'); await expect(question.locator('..')).not.toHaveAttribute('open');
    const cta = page.getByRole('banner').getByRole('link', { name: 'Reservar cita' });
    await cta.focus(); expect(await cta.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    for (const image of await page.getByRole('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    const bookingSection = page.getByRole('region', { name: /Tu próximo paso:.*cuidar tu sonrisa/ });
    const ctaHeading = (await bookingSection.getByRole('heading').boundingBox())!;
    const ctaDescription = (await bookingSection.locator('p').boundingBox())!;
    const ctaActions = (await bookingSection.locator('.landing-cta-actions').boundingBox())!;
    const ctaPhoto = (await bookingSection.locator('.landing-photo').boundingBox())!;
    expect(ctaDescription.y).toBeGreaterThanOrEqual(ctaHeading.y + ctaHeading.height + 15);
    expect(ctaActions.y).toBeGreaterThanOrEqual(ctaDescription.y + ctaDescription.height + 27);
    if (width >= 768) expect(ctaActions.x + ctaActions.width).toBeLessThanOrEqual(ctaPhoto.x);
    else expect(ctaPhoto.y).toBeGreaterThanOrEqual(ctaActions.y + ctaActions.height + 31);
    for (const link of await bookingSection.getByRole('link').all()) {
      await link.focus();
      expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
      const bounds = (await link.boundingBox())!;
      const headerBottom = (await page.getByRole('banner').boundingBox())!.height;
      expect(bounds.y).toBeGreaterThanOrEqual(headerBottom);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    const card = treatments.getByRole('article').first();
    const restingCard = await card.evaluate(el => ({ shadow: getComputedStyle(el).boxShadow, border: getComputedStyle(el).borderColor }));
    await card.hover();
    expect(await card.evaluate(el => ({ shadow: getComputedStyle(el).boxShadow, border: getComputedStyle(el).borderColor }))).toEqual(restingCard);
    expect(await card.evaluate(el => getComputedStyle(el).cursor)).not.toBe('pointer');
    const rows = await treatments.getByRole('article').evaluateAll(articles => articles.map(article => {
      const box = article.getBoundingClientRect();
      return { top: box.top, height: box.height, title: article.querySelector('h3')!.getBoundingClientRect().top, description: article.querySelector('p')!.getBoundingClientRect().top };
    }));
    for (const row of rows) for (const other of rows.filter(item => Math.abs(item.top - row.top) < 1)) {
      expect(Math.abs(other.height - row.height)).toBeLessThan(1);
      expect(Math.abs(other.title - row.title)).toBeLessThan(1);
      expect(Math.abs(other.description - row.description)).toBeLessThan(1);
    }
    await question.focus(); await page.keyboard.press('Enter');
    expect(await question.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const contrast = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      const lum = (color: string) => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); const c = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }); return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722; };
      return [...document.querySelectorAll('.landing-button, .landing-treatment p, .landing-footer p, .landing-footer nav a, .landing-demo-note, .landing-tag, .landing-cta p, .landing-eyebrow, .landing-hero-copy p, .landing-step-copy p, .landing-questions summary, .landing-questions details[open] p')].map(el => {
        let bg: Element | null = el; while (bg && getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)') bg = bg.parentElement;
        const a = lum(getComputedStyle(el).color), b = lum(bg ? getComputedStyle(bg).backgroundColor : 'white'); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
    });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    const banner = page.getByRole('banner');
    for (const action of await banner.locator('a:visible, button:visible').all()) { const box = (await action.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44); }
    expect(Number.parseFloat(await page.locator('.landing-button').first().evaluate(el => getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(.00001);
    expect(Number.parseFloat(await question.locator('span').evaluate(el => getComputedStyle(el, '::after').transitionDuration))).toBeLessThanOrEqual(.00001);
    await page.keyboard.press('Space');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(Number.parseFloat(await question.evaluate(el => getComputedStyle(el).transitionDuration))).toBeCloseTo(.14);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.evaluate(() => scrollTo(0, 0));
    if (width === 1440) await page.screenshot({ path: '/tmp/opencode/dc-landing-final-polish/desktop.png', fullPage: true });
    if (width === 390) {
      await page.setViewportSize({ width, height: 1100 });
      await page.locator('.landing-hero').screenshot({ path: '/tmp/opencode/dc-landing-final-polish/hero-mobile.png' });
      await bookingSection.screenshot({ path: '/tmp/opencode/dc-landing-final-polish/cta-mobile.png' });
      const firstQuestion = page.locator('.landing-questions summary').first();
      await firstQuestion.focus(); await page.keyboard.press('Enter');
      await page.locator('#preguntas').screenshot({ path: '/tmp/opencode/dc-landing-final-polish/faq-mobile.png' });
    }
    expect(calls.filter(path => !path.startsWith('/api/auth/'))).toEqual([]);
    expect(external).toEqual([]); expect(errors).toEqual([]);
  });
}

for (const width of [320, 390, 768]) {
  test(`9C menú modal: foco, Escape, enlaces y cambio a escritorio ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await fixture(page); await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Abrir menú público' });
    await trigger.focus(); await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Menú público' });
    await expect(menu).toBeVisible(); await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('button', { name: 'Cerrar menú' })).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(menu.getByRole('link', { name: 'Crear cuenta', exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(menu.getByRole('button', { name: 'Cerrar menú' })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible(); await expect(trigger).toBeFocused();
    await trigger.click(); await menu.getByRole('link', { name: 'Tratamientos', exact: true }).click();
    await expect(menu).not.toBeVisible(); await expect(page).toHaveURL(/#tratamientos$/);
    await trigger.click(); await page.setViewportSize({ width: 1280, height: 900 });
    await expect(menu).not.toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación pública', exact: true }).getByRole('link', { name: 'Inicio', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
}

test('reserva → login de paciente histórico exento → catálogo operativo → creación (HTTP simulado)', async ({ page }) => {
  const { calls, registrations, reservations } = await fixture(page); await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Reservar cita' }).click();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await login(page);
  expect(registrations).toHaveLength(0);
  await expect(page).toHaveURL(/\/appointments\?create=1$/);
  const picker = page.getByRole('radio', { name: 'Servicio operativo de prueba', exact: true });
  await expect(picker).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /Ortodoncia|Restauración dental|Odontopediatría/ })).toHaveCount(0);
  await picker.check(); await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('7');
  await page.getByRole('button', { name: '09:00–09:30', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar solicitud', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu cita está reservada', exact: true })).toBeVisible();
  expect(reservations).toHaveLength(1); expect(reservations[0]).toMatchObject({ patientId: 5, serviceId: 73, dentistId: 7, startAt: '2026-10-13T09:00:00Z' });
  expect(calls).not.toContain('/api/services');
});

test('9C registro fallido conserva el error y el retorno de reserva', async ({ page }) => {
  await fixture(page, { registerError: true }); await page.goto('/');
  await page.getByRole('link', { name: '¿Primera vez? Crea tu cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(patient.email); await page.getByLabel('Contraseña', { exact: true }).fill('Demo-password-2026');
  await page.getByLabel('Repite la contraseña', { exact: true }).fill('Demo-password-2026'); await page.getByLabel('Nombre', { exact: true }).fill('Paciente'); await page.getByLabel('Apellidos').fill('Prueba');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo crear la cuenta');
  await page.getByRole('link', { name: 'Inicia sesión', exact: true }).click(); await login(page);
  await expect(page).toHaveURL(/\/appointments\?create=1$/);
});

for (const error of ['noServices', 'slotsError'] as const) {
  test(`9C reserva no inventa servicios ni horarios ante ${error}`, async ({ page }) => {
    const { reservations } = await fixture(page, { [error]: true }); await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Reservar cita' }).click(); await login(page);
    if (error === 'noServices') await expect(page.getByText(/No hay servicios activos/)).toBeVisible();
    else { await page.getByRole('radio', { name: 'Servicio operativo de prueba', exact: true }).check(); await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('7'); await expect(page.getByText(/No se pudo consultar la disponibilidad/)).toBeVisible(); }
    await expect(page.getByRole('button', { name: 'Confirmar solicitud', exact: true })).toHaveCount(0); expect(reservations).toEqual([]);
  });
}

test('9C contenido público disponible aunque auth/API y una fotografía fallen', async ({ page }) => {
  await page.route(url => url.pathname.startsWith('/api/'), route => route.abort('failed'));
  await page.route('**/images/landing/orthodontics-640.webp', route => route.abort('failed'));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Ortodoncia', exact: true })).toBeVisible();
  await page.locator('#tratamientos').scrollIntoViewIfNeeded(); await expect(page.getByText('Fotografía ilustrativa no disponible')).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Reservar cita' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('enlaces públicos a login, registro, anclas y créditos conservados', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { calls } = await fixture(page); await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navegación pública', exact: true });
  for (const [label, id] of [['Tratamientos', 'tratamientos'], ['¿Por qué nosotros?', 'nosotros'], ['Proceso', 'proceso'], ['Preguntas', 'preguntas']]) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'location');
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    const top = await page.locator(`#${id}`).evaluate(el => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(80);
  }
  await nav.getByRole('link', { name: 'Inicio', exact: true }).click();
  await page.getByRole('banner').getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Crear cuenta de paciente', exact: true }).click();
  await expect(page).toHaveURL(/\/register$/); await expect(page.getByRole('heading', { name: 'Crear cuenta de paciente', exact: true })).toBeVisible();
  await page.goto('/');
  const credits = page.getByText('Fotografías y licencia', { exact: true });
  await credits.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Licencia Pexels (abre otra pestaña)', exact: true })).toHaveAttribute('href', 'https://www.pexels.com/license/');
  expect(calls.filter(path => path.startsWith('/api/public/'))).toEqual([]);
});

test('hero fallido mantiene geometría y la página funciona con texto ampliado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page);
  await page.route('**/images/landing/clinic-768.webp', route => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('.landing-hero-photo')).toContainText('Fotografía ilustrativa no disponible');
  expect((await page.locator('.landing-hero-photo').boundingBox())!.height).toBeGreaterThan(250);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Reservar cita', exact: true })).toBeVisible();
});

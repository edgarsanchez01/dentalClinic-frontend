import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { NOW, TIMEZONE, uiUnificationFixture, type UiFixtureResult, type UiRole } from './uiUnificationFixture';

/**
 * F0 — baseline visual/técnica de DC-UI-UNIFICATION-01.
 *
 * - Ejecuta el SPA real en Chromium con reloj y APIs fijas; nunca levanta backend.
 * - Captura cada pantalla en `docs/design/evidence/DC-UI-UNIFICATION-01/`.
 * - Afirma por ruta: un solo h1, sin estado de carga, sin desbordamiento horizontal del
 *   documento y sin endpoints no declarados, prohibidos o escrituras bloqueadas.
 * - No mide contraste ni teclado todavía: esas comprobaciones quedan registradas como
 *   pendientes en el informe de evidencia, no se declaran aprobadas aquí.
 */

const EVIDENCE = path.resolve(process.cwd(), '..', 'docs/design/evidence/DC-UI-UNIFICATION-01');
const DAY = '/appointments?view=day&date=2026-10-26';
const WEEK = '/appointments?view=week&date=2026-10-26';
const MONTH = '/appointments?view=month&date=2026-10-26';

const ROUTES: Record<UiRole, string[]> = {
  PATIENT: [
    '/',
    '/appointments',
    '/appointments?create=1',
    '/appointments/21',
    '/appointments/20',
    '/patients/4',
    '/patient-profile',
    '/notifications',
  ],
  RECEPTIONIST: [
    '/',
    DAY,
    WEEK,
    '/appointments/20',
    '/patients',
    '/patients/4',
    '/services',
    '/scheduling',
    '/finances',
    '/finances/new?patientId=4',
    '/finances/1',
    '/finances/reports',
    '/collections',
    '/collections/20',
    '/notifications',
  ],
  DENTIST: [
    '/',
    DAY,
    WEEK,
    '/appointments/21',
    '/appointments/20',
    '/patients',
    '/patients/4',
    '/services',
    '/scheduling',
    '/finances',
    '/reviews',
    '/notifications',
  ],
  OWNER: [
    '/',
    DAY,
    WEEK,
    MONTH,
    '/appointments?scope=mine&view=day&date=2026-10-26',
    '/appointments/20',
    '/appointments/20?clinical=1',
    '/patients',
    '/patients/4',
    '/services',
    '/scheduling',
    '/users',
    '/clinic',
    '/finances',
    '/finances/new?patientId=4',
    '/finances/1',
    '/finances/reports',
    '/collections',
    '/collections/20',
    '/reviews',
    '/notifications',
  ],
};

/** Subconjunto representativo para 768/320; la matriz completa se captura en 1440/390. */
const RESPONSIVE_ROUTES: Record<UiRole, string[]> = {
  PATIENT: ['/', '/appointments', '/patients/4', '/patient-profile'],
  RECEPTIONIST: ['/', DAY, '/patients/4', '/finances'],
  DENTIST: ['/', '/appointments/21', '/patients/4', '/finances'],
  OWNER: ['/', WEEK, '/patients/4', '/finances'],
};

const ROLES: UiRole[] = ['PATIENT', 'RECEPTIONIST', 'DENTIST', 'OWNER'];

/**
 * Deudas visuales preexistentes detectadas por F0, no introducidas ni corregidas aquí.
 * Se anotan y se capturan; no se declaran resueltas. Si dejan de reproducirse, la anotación
 * debe retirarse y la captura revisarse en la fase que las corrija.
 */
const KNOWN_OVERFLOW = new Set(['RECEPTIONIST /finances 768', 'OWNER /finances 768']);

function reset(fixture: UiFixtureResult) {
  fixture.calls.length = 0;
  fixture.violations.undeclared.length = 0;
  fixture.violations.forbidden.length = 0;
  fixture.violations.blockedWrites.length = 0;
}

function slug(route: string) {
  const cleaned = route
    .replace(/^\//, '')
    .replace(/[?#&=]/g, '-')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned === '' ? 'inicio' : cleaned;
}

function assertNoViolations(fixture: UiFixtureResult) {
  expect(fixture.violations.undeclared, `Endpoints no declarados:\n${fixture.manifest()}`).toEqual([]);
  expect(fixture.violations.forbidden, `Endpoints prohibidos para el rol:\n${fixture.manifest()}`).toEqual([]);
  expect(fixture.violations.blockedWrites, `Escrituras bloqueadas al solo consultar:\n${fixture.manifest()}`).toEqual([]);
}

async function capture(
  page: Page,
  fixture: UiFixtureResult,
  role: UiRole,
  route: string,
  width: number,
) {
  reset(fixture);
  await page.goto(route);
  await expect(page.locator('h1'), `h1 único en ${route}`).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('status', { name: /^Cargando / }), `sin carga pendiente en ${route}`).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  // Una última comprobación de red estabiliza consultas disparadas al montar paneles ocultos.
  await page.waitForLoadState('networkidle');

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  const overflows = metrics.scrollWidth > metrics.innerWidth + 1;
  const known = KNOWN_OVERFLOW.has(`${role} ${route} ${width}`);

  await page.screenshot({
    path: path.join(EVIDENCE, `${role.toLowerCase()}-${slug(route)}-${width}.png`),
    fullPage: true,
  });

  if (known) {
    test.info().annotations.push({
      type: 'known-overflow',
      description: `${role} ${route} @${width}: ${metrics.scrollWidth}px > ${metrics.innerWidth}px. Deuda preexistente; F0 no la corrige.`,
    });
    // Si la deuda desaparece, este soft assert pide actualizar la baseline en la fase que la corrigió.
    expect.soft(overflows, `Deuda conocida resuelta en ${role} ${route} @${width}: retira la anotación`).toBe(true);
  } else {
    expect(
      overflows,
      `desbordamiento horizontal del documento en ${role} ${route} @${width} (${metrics.scrollWidth}px > ${metrics.innerWidth}px)`,
    ).toBe(false);
  }

  assertNoViolations(fixture);
}

for (const width of [1440, 390]) {
  for (const role of ROLES) {
    test(`${role} · matriz completa ${width}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });
      const fixture = await uiUnificationFixture(page, role);
      for (const route of ROUTES[role]) await capture(page, fixture, role, route, width);
    });
  }
}

for (const width of [768, 320]) {
  for (const role of ROLES) {
    test(`${role} · responsive representativo ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      const fixture = await uiUnificationFixture(page, role);
      for (const route of RESPONSIVE_ROUTES[role]) await capture(page, fixture, role, route, width);
    });
  }
}

/**
 * La vista Día/Semana del OWNER está aprobada y no se congela su geometría: esta prueba
 * solo verifica que ambas composiciones siguen presentes y seleccionadas, también en móvil.
 */
for (const width of [1440, 768, 390, 320]) {
  test(`OWNER · Día y Semana protegidas ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'OWNER');

    for (const [view, region, label] of [
      ['day', 'Agenda del día', 'Día'],
      ['week', 'Agenda semanal', 'Semana'],
    ] as const) {
      reset(fixture);
      await page.goto(`/appointments?view=${view}&date=2026-10-26`);
      await expect(page.locator('h1')).toHaveCount(1);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('region', { name: region, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.join(EVIDENCE, `owner-protegida-${view}-${width}.png`),
        fullPage: true,
      });
      assertNoViolations(fixture);
    }
  });
}

/** Complemento F0: verifica las ocho combinaciones, añade solo los seis PNG faltantes. */
for (const width of [1440, 768, 390, 320]) {
  test(`OWNER · ámbito personal Día y Semana ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'OWNER');

    for (const [view, region, label, total] of [
      ['day', 'Agenda del día', 'Día', '6 citas'],
      ['week', 'Agenda semanal', 'Semana', '8 citas en el período'],
    ] as const) {
      reset(fixture);
      const route = `/appointments?scope=mine&view=${view}&date=2026-10-26`;
      await page.goto(route);
      await expect(page.locator('h1')).toHaveCount(1);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('status', { name: /^Cargando / })).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);

      const environment = await page.evaluate(() => ({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: navigator.language,
        now: new Date().toISOString(),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(environment.timezone).toBe(TIMEZONE);
      expect(environment.locale).toBe('es-MX');
      expect(environment.now).toBe(new Date(NOW).toISOString());
      expect(environment.scrollWidth).toBeLessThanOrEqual(environment.innerWidth);
      expect(new URL(page.url()).searchParams.get('scope')).toBe('mine');

      const scope = page.getByRole('navigation', { name: 'Ámbito de trabajo' });
      await expect(scope.getByRole('link', { name: 'Mi actividad clínica', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(scope.getByRole('link', { name: 'Clínica', exact: true })).not.toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.dc-appointments')).toBeVisible();
      await expect(page.locator('.owner-day-list')).toHaveCount(0);
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');

      const agenda = page.getByRole('region', { name: region, exact: true });
      await expect(agenda).toBeVisible();
      await expect(agenda).toContainText(total);
      await expect(agenda).not.toContainText('Diego Molina');
      if (view === 'day') await expect(page.locator('.dc-day')).toBeVisible();
      else await expect(agenda.getByRole('navigation', { name: 'Días de esta semana' }).getByRole('button')).toHaveCount(7);

      const lists = fixture.calls.filter(call => call.method === 'GET' && call.path === '/api/appointments');
      expect(lists.length).toBeGreaterThan(0);
      expect(lists.every(call => call.params.get('dentistId') === '7'), fixture.manifest()).toBe(true);
      assertNoViolations(fixture);

      const file = path.join(EVIDENCE, `owner-${slug(route)}-${width}.png`);
      const preserved = existsSync(file);
      if (!preserved) {
        // Escritura exclusiva: ni un reintento ni otra ejecución pueden reemplazar evidencia.
        await writeFile(file, await page.screenshot({ fullPage: true }), { flag: 'wx' });
      }
      await test.info().attach(`owner-personal-${view}`, {
        body: JSON.stringify({ route, environment, evidence: file, capture: preserved ? 'preserved' : 'created', calls: fixture.manifest() }, null, 2),
        contentType: 'application/json',
      });
    }
  });
}

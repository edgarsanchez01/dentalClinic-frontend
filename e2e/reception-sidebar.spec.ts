import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const dir = '/tmp/opencode/reception-sidebar/evidence';
const phase = process.env.SIDEBAR_CAPTURE_PHASE === 'before' ? 'before' : 'after';
const now = '2026-10-19T16:00:00Z';

async function fixture(page: Page, role: string) {
  await page.clock.setFixedTime(new Date(now));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/auth/refresh': { accessToken: 'sidebar-synthetic' },
      '/api/auth/me': { id: 1, role, email: 'sidebar@example.test', active: true, patientId: role === 'PATIENT' ? 4 : null,
        dentistId: role === 'OWNER' || role === 'DENTIST' ? 7 : null, createdAt: now,
        medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } },
      '/api/onboarding/status': { status: 'COMPLETED', clinicConfigured: true },
      '/api/availability/policy': { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 },
      '/api/notifications/unread-count': { unread: 0 },
      '/api/notifications': { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 },
    };
    expect(path in responses, `Unexpected API: ${path}`).toBe(true);
    expect(route.request().method() === 'GET' || path === '/api/auth/refresh').toBe(true);
    await route.fulfill({ json: responses[path] });
  });
}

for (const role of ['RECEPTIONIST', 'PATIENT', 'OWNER', 'DENTIST']) {
  for (const width of [1440, 390]) {
    test(`sidebar ${role} ${width}: fondo, activo, geometría y teclado`, async ({ page }) => {
      await page.setViewportSize({ width, height: 960 });
      await fixture(page, role);
      await page.goto('/change-password');
      // Reproduce only the original role token for repeatable before/after evidence,
      // without reverting source files or changing PATIENT/OWNER/DENTIST.
      if (phase === 'before' && role === 'RECEPTIONIST') await page.addStyleTag({ content: '.reception-shell { --surface-sidebar: #eef1ec; }' });
      const mobile = width < 768;
      const trigger = page.getByRole('button', { name: 'Abrir menú de navegación', exact: true });
      if (mobile) await trigger.click();
      const surface = mobile ? page.getByRole('dialog', { name: 'Menú de navegación' }) : page.getByRole('complementary', { name: 'Navegacion' });
      const nav = page.getByRole('navigation', { name: mobile ? 'Navegación móvil' : 'Navegación de escritorio' });
      await expect(nav).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const active = nav.getByRole('link', { name: 'Contraseña', exact: true });
      await expect(active).toHaveAttribute('aria-current', 'page');
      if (role === 'RECEPTIONIST' || role === 'PATIENT') {
        await expect(active).toHaveCSS('background-color', 'rgb(185, 214, 201)');
        await expect(surface).toHaveCSS('background-color', phase === 'before' && role === 'RECEPTIONIST' && !mobile ? 'rgb(238, 241, 236)' : 'rgb(246, 247, 243)');
      }
      const pixels = await surface.screenshot({ path: `${dir}/${role.toLowerCase()}-${phase}-${width}.png` });
      const digest = createHash('sha256').update(pixels).digest('hex');
      await page.keyboard.press('Tab');
      await active.focus(); await expect(active).toBeFocused();
      if (role === 'RECEPTIONIST') await expect(active).toHaveCSS('outline-width', '2px');
      const idle = nav.getByRole('link', { name: 'Notificaciones', exact: true });
      await idle.hover();
      if (role === 'RECEPTIONIST') await expect(idle).toHaveCSS('color', 'rgb(25, 63, 67)');
      const ratios = role === 'RECEPTIONIST'
        ? await nav.getByRole('link').evaluateAll(links => links.map(link => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d')!;
          const luminance = (color: string) => {
            ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
            return r! * .2126 + g! * .7152 + b! * .0722;
          };
          let ancestor: Element | null = link;
          let background = 'white';
          while (ancestor) {
            const bg = getComputedStyle(ancestor).backgroundColor;
            ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = bg; ctx.fillRect(0, 0, 1, 1);
            if (ctx.getImageData(0, 0, 1, 1).data[3] === 255) { background = bg; break; }
            ancestor = ancestor.parentElement;
          }
          const a = luminance(getComputedStyle(link).color), b = luminance(background);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        })) : [];
      const state = {
        links: await nav.getByRole('link').evaluateAll(links => links.map(link => {
          const css = getComputedStyle(link), box = link.getBoundingClientRect();
          return { text: link.textContent, href: link.getAttribute('href'), x: box.x, y: box.y, width: box.width, height: box.height,
            font: css.font, padding: css.padding, background: css.backgroundColor, color: css.color };
        })),
        groups: await nav.locator('p').allTextContents(),
        focus: await active.evaluate(element => { const css = getComputedStyle(element); return [css.outlineColor, css.outlineWidth, css.outlineOffset, css.boxShadow]; }),
      };
      const baseline = `${dir}/${role.toLowerCase()}-before-${width}.json`;
      if (phase === 'before') writeFileSync(baseline, JSON.stringify({ state, digest, ratios }, null, 2));
      else if (existsSync(baseline)) {
        const previous = JSON.parse(readFileSync(baseline, 'utf8'));
        expect(state).toEqual(previous.state);
        // This scoped background change must never reduce existing text contrast.
        ratios.forEach((ratio, index) => expect(ratio).toBeGreaterThanOrEqual(previous.ratios[index] - .001));
        if (role !== 'RECEPTIONIST' || mobile) expect(digest).toBe(previous.digest);
      }
      if (phase === 'after') for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (mobile) {
        await page.keyboard.press('Escape');
        await expect(surface).toBeHidden(); await expect(trigger).toBeFocused();
        await trigger.click();
      }
      await idle.click();
      await expect(page).toHaveURL(/\/notifications$/);
      if (mobile) await expect(surface).toBeHidden();
    });
  }
}

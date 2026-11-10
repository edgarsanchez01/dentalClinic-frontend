import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { NotificationContent } from './NotificationContent';
import { PatientNotificationContent } from '../patient/PatientNotifications';

const notification = { id: 1, title: '<script>literal</script>', body: 'Texto\nLiteral', priority: 'HIGH' as const, read: false, createdAt: '2026-11-01T10:00:00Z' };
const recipe = { article: 'article', unread: 'unread', heading: 'heading', labels: 'labels', footer: 'footer' };
it('dos apariciones de un ID tienen relaciones ARIA únicas y no inventan acciones ni fechas', () => {
  const view = render(<><NotificationContent notification={notification} recipe={recipe} headingLevel={2} date={{ text: 'Fecha UTC', dateTime: notification.createdAt }} />
    <PatientNotificationContent notification={notification} timezone={undefined} preview /></>);
  const articles = screen.getAllByRole('article');
  const ids = articles.map(article => article.getAttribute('aria-labelledby'));
  expect(ids[0]).not.toBe(ids[1]);
  for (const id of ids) expect(document.getElementById(id!)).toHaveTextContent(notification.title);
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(notification.title);
  expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(notification.title);
  expect(screen.getByText('Fecha local no disponible')).toBeInTheDocument();
  expect(view.container.querySelectorAll('time')).toHaveLength(1);
  expect(view.container.querySelector('.patient-preview')?.textContent).toBe(notification.body);
  expect(view.container.querySelector('script')).toBeNull(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

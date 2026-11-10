import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { afterEach } from 'vitest';
import { App, appRoutes } from '../app/App';

const routers: ReturnType<typeof createBrowserRouter>[] = [];
export function renderApp({ strict = false } = {}) {
  const router = createBrowserRouter(appRoutes);
  routers.push(router);
  const app = <App router={router} />;
  return { ...render(strict ? <StrictMode>{app}</StrictMode> : app), router };
}
afterEach(() => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
});

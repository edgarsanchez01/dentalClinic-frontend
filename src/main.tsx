import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router-dom';

import { App, appRoutes } from './app/App';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('No se encontro el elemento #root');
}

// Crear fuera de React: StrictMode no debe registrar dos listeners de historial.
const router = createBrowserRouter(appRoutes);
createRoot(container).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
);

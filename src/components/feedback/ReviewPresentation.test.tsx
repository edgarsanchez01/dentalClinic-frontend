import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ReviewPresentation } from './ReviewPresentation';

it('usa resumen del servidor, bloquea navegación en fetching y conserva el formateador suministrado', () => {
  const data = { content: [{ id: 1, rating: 2, comment: 'Comentario\nLiteral', respondedAt: '2026-11-01T10:00:00Z' }],
    count: 47, average: 4.375, page: 1, size: 20, totalElements: 47, totalPages: 3 };
  const date = vi.fn(() => 'fecha del caller');
  const view = render(<ReviewPresentation data={data} page={1} fetching onPageChange={vi.fn()} summaryIntro="Global" formatDate={date} />);
  expect(screen.getByText('47')).toBeInTheDocument(); expect(screen.getByText('4.38 de 5')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  expect(screen.getByText('fecha del caller')).toHaveAttribute('datetime', data.content[0].respondedAt);
  expect(date).toHaveBeenCalledWith(data.content[0].respondedAt);
  expect(view.container.querySelector('main')).toBeNull();
  view.rerender(<ReviewPresentation data={{ ...data, average: null, content: [] }} page={1} fetching={false} onPageChange={vi.fn()} summaryIntro="Global" formatDate={date} />);
  expect(screen.getByText('Sin valoraciones')).toBeInTheDocument(); expect(screen.getByText('47')).toBeInTheDocument();
  expect(screen.getByText('Aún no hay reseñas para mostrar.')).toBeInTheDocument();
});

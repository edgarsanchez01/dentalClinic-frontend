import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SectionTabs } from './SectionTabs';

const items = [
  { id: 'one', label: 'Uno', content: <p>Contenido uno</p> },
  { id: 'two', label: 'Dos', content: <p>Contenido dos</p> },
  { id: 'three', label: 'Tres', content: <p>Contenido tres</p> },
];

function renderTabs(props: Partial<Parameters<typeof SectionTabs>[0]> = {}) {
  return render(<SectionTabs items={items} ariaLabel="Secciones de prueba" {...props} />);
}

describe('SectionTabs', () => {
  it('monta todos los paneles y solo expone el activo', () => {
    renderTabs();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');

    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels).toHaveLength(3);
    expect(panels[0]).not.toHaveAttribute('hidden');
    expect(panels[1]).toHaveAttribute('hidden');
    expect(panels[2]).toHaveAttribute('hidden');
    // Los paneles inactivos siguen montados, no se destruyen.
    expect(screen.getByText('Contenido dos')).toBeInTheDocument();
    expect(screen.getByText('Contenido tres')).toBeInTheDocument();
    expect(tabs[1]).toHaveAttribute('aria-controls', panels[1]!.id);
    expect(panels[1]).toHaveAttribute('aria-labelledby', tabs[1]!.id);
  });

  it('mueve el foco con flechas/Home/End y activa solo con clic o teclas nativas', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(tabs[1]!, { key: 'ArrowLeft' });
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(tabs[2]!, { key: 'Home' });
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(tabs[2]!);
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[2]!.id);
    expect(screen.getByText('Contenido tres')).toBeVisible();
  });

  it('conserva las clases y el tipo de panel que recibe cada wrapper', () => {
    renderTabs({
      className: 'outer',
      tabListClassName: 'list',
      tabClassName: active => active ? 'tab is-active' : 'tab',
      panelClassName: 'panel',
      panelTag: 'div',
    });

    expect(screen.getByRole('tablist', { name: 'Secciones de prueba' })).toHaveClass('list');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveClass('tab', 'is-active');
    expect(tabs[1]).toHaveClass('tab');
    expect(tabs[1]).not.toHaveClass('is-active');

    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels[0]!.tagName).toBe('DIV');
    expect(panels[0]).toHaveClass('panel');
    expect(screen.getByRole('tabpanel')).toHaveClass('panel');
  });
});

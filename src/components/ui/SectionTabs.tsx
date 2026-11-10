import { useId, useRef, useState, type ReactNode } from 'react';

export interface SectionTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Pestañas de presentación con activación manual.
 *
 * - Los paneles nunca se desmontan: se ocultan con `hidden`.
 * - Flechas/Home/End mueven el foco; Enter/Espacio activan el botón nativo.
 * - Cada wrapper conserva su contenedor, tablist, clases y tipo de panel.
 */
export function SectionTabs({
  items,
  ariaLabel,
  className,
  tabListClassName,
  tabClassName,
  panelClassName,
  panelTag = 'section',
}: {
  items: ReadonlyArray<SectionTab>;
  ariaLabel: string;
  className?: string | undefined;
  tabListClassName?: string | undefined;
  tabClassName?: ((active: boolean) => string | undefined) | undefined;
  panelClassName?: string | undefined;
  panelTag?: 'section' | 'div' | undefined;
}) {
  const prefix = useId();
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const Panel = panelTag ?? 'section';

  return <div className={className}>
    <div role="tablist" aria-label={ariaLabel} className={tabListClassName}>
      {items.map((item, index) => <button
        key={item.id}
        ref={element => { tabs.current[index] = element; }}
        type="button" role="tab"
        id={`${prefix}-tab-${item.id}`}
        aria-controls={`${prefix}-panel-${item.id}`}
        aria-selected={active === index}
        tabIndex={focused === index ? 0 : -1}
        className={tabClassName?.(active === index)}
        onFocus={() => setFocused(index)}
        onClick={() => setActive(index)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % items.length
            : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          tabs.current[next]?.focus();
        }}
      >{item.label}</button>)}
    </div>
    {items.map((item, index) => <Panel
      key={item.id} role="tabpanel" tabIndex={0}
      id={`${prefix}-panel-${item.id}`}
      aria-labelledby={`${prefix}-tab-${item.id}`}
      className={panelClassName}
      hidden={active !== index}
    >{item.content}</Panel>)}
  </div>;
}

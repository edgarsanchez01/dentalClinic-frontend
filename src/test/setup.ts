import '@testing-library/jest-dom/vitest';

// jsdom aplica display:none a popover, pero no implementa su API ni el top layer.
// Geometría, apertura nativa y teclado se verifican también en Chromium real.
Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: function (this: HTMLElement) {
  this.style.display = 'block';
} });

// jsdom no implementa aislamiento/foco modal; eso se verifica además en Chromium real.
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) {
  this.open = true;
} });
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
  if (!this.open) return;
  this.open = false;
  this.dispatchEvent(new Event('close'));
} });

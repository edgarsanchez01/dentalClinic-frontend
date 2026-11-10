import { type Locator, type Page } from '@playwright/test';

/** Choose the visible quadrant if needed, then use the same direct tooth control at every width. */
export async function selectDentalPiece(scope: Page | Locator, fdi: number) {
  const quadrant = scope.getByLabel('Cuadrante', { exact: true });
  if (await quadrant.isVisible()) {
    const index: Record<number, string> = { 1: '0', 2: '1', 4: '2', 3: '3', 5: '0', 6: '1', 8: '2', 7: '3' };
    await quadrant.selectOption(index[Math.floor(fdi / 10)]);
  }
  await scope.getByRole('button', { name: new RegExp(`^Pieza ${fdi}\\b`) }).click();
}

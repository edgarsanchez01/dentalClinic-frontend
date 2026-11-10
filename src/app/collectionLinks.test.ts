import { expect, it } from 'vitest';
import { collectionReturn } from './collectionLinks';

it.each(['/collections', '/collections?page=2&state=PARTIAL&patientId=1', '/collections?fromDay=2026-10-22&from=2026-10-22T06%3A00%3A00Z'])('retorno cerrado conserva contexto %s', target => {
  expect(collectionReturn(target)).toBe(target);
});
it.each([null, '', '/collections/7', '/collections-old', '/appointments', '/finances/20', '//evil.test/collections', '/\\evil.test/collections', 'https://evil.test/collections', '/collections\n', '/collections#fragment'])('rechaza destinos ajenos y formas abiertas %s', target => {
  expect(collectionReturn(target)).toBeNull();
});

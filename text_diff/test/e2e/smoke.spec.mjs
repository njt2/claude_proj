// 기본 비교 흐름 smoke (Phase 5의 dataset.smoke 검사를 실제 UI 흐름으로 갱신)
import { test, expect } from '@playwright/test';
import { ENGINES, openApp, fillAndCompare, D } from './util.mjs';

for (const engine of ENGINES) {
  test(`smoke [${engine.name}]: file://로 열고 비교하면 결과가 나온다`, async ({ page }) => {
    const log = await openApp(page, engine);
    await fillAndCompare(page, 'a\n', 'b\n');
    const ds = await page.evaluate(() => ({ ...document.body.dataset, ...document.getElementById('summary-text').dataset }));
    const r = D.diff('a\n', 'b\n');
    expect({ added: +ds.added, removed: +ds.removed, changes: +ds.changes }).toEqual({ ...r.stats });
    expect(ds.engine).toBe(engine.name);
    expect(log.errors).toEqual([]);
  });
}

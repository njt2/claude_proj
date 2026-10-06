// Phase 7 시나리오 1~11, 14. 각 시나리오를 worker 경로와 ?worker=0 경로 둘 다 실행한다.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ENGINES, PAGE_URL, D, openApp, waitReady, fillAndCompare, sample, lines, CODE_A, CODE_B } from './util.mjs';

const plain = (x) => JSON.parse(JSON.stringify(x));

async function summary(page) {
  return page.evaluate(() => {
    const d = document.getElementById('summary-text').dataset;
    return { added: +d.added, removed: +d.removed, changes: +d.changes, text: document.getElementById('summary-text').textContent };
  });
}

async function lineSequences(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#diff .row')];
    return {
      count: rows.length,
      old: rows.filter((r) => r.dataset.oldLine).map((r) => +r.dataset.oldLine),
      new: rows.filter((r) => r.dataset.newLine).map((r) => +r.dataset.newLine),
    };
  });
}

const seq = (n) => Array.from({ length: n }, (_, i) => i + 1);

for (const engine of ENGINES) {
  test.describe(`[${engine.name}]`, () => {
    test('1. 로드 시 콘솔 에러 0, 페이지 외 네트워크 요청 0 (blob:/data: 제외)', async ({ page }) => {
      const log = await openApp(page, engine);
      await fillAndCompare(page, CODE_A, CODE_B);
      const external = log.requests.filter((u) => !u.startsWith('blob:') && !u.startsWith('data:') && u.split('?')[0] !== PAGE_URL);
      expect(external).toEqual([]);
      expect(log.errors).toEqual([]);
    });

    test('2·3. Ctrl+Enter 비교 → 요약 숫자가 코어 계산과 일치, engine 표시', async ({ page }) => {
      await openApp(page, engine);
      await fillAndCompare(page, CODE_A, CODE_B);
      const s = await summary(page);
      const r = D.diff(CODE_A, CODE_B);
      expect({ added: s.added, removed: s.removed, changes: s.changes }).toEqual(plain(r.stats));
      expect(s.text).toContain(`+${r.stats.added}`);
      expect(s.text).toContain(`−${r.stats.removed}`);
      expect(await page.evaluate(() => document.body.dataset.engine)).toBe(engine.name);
    });

    test('4. 나란히 ↔ 통합 전환: 행 수와 줄번호가 블록 구조와 일치', async ({ page }) => {
      await openApp(page, engine);
      await page.selectOption('#opt-context', 'all');
      await fillAndCompare(page, CODE_A, CODE_B);
      const r = D.diff(CODE_A, CODE_B);
      let sbsRows = 0, uniRows = 0;
      for (const b of r.blocks) {
        const del = b.oldEnd - b.oldStart, add = b.newEnd - b.newStart;
        if (b.type === 'equal') { sbsRows += del; uniRows += del; }
        else { sbsRows += Math.max(del, add); uniRows += del + add; }
      }
      await page.click('#view-sbs');
      await waitReady(page);
      let s = await lineSequences(page);
      expect(s.count).toBe(sbsRows);
      expect(s.old).toEqual(seq(r.oldLines.length));
      expect(s.new).toEqual(seq(r.newLines.length));
      await page.click('#view-unified');
      await waitReady(page);
      await expect(page.locator('#diff')).toHaveClass(/uni/);
      s = await lineSequences(page);
      expect(s.count).toBe(uniRows);
      expect(s.old).toEqual(seq(r.oldLines.length));
      expect(s.new).toEqual(seq(r.newLines.length));
    });

    test('5. 접힌 구간 클릭 시 숨겨진 줄이 나타나고, 모두 펼치기 토글이 동작', async ({ page }) => {
      await openApp(page, engine);
      const { a, b } = sample(300, [10, 150, 290]);
      await fillAndCompare(page, a, b);
      const folds = page.locator('#diff .fold');
      await expect(folds).toHaveCount(4);
      await expect(page.locator('#diff [data-old-line="60"]')).toHaveCount(0);
      // 두 번째 접힌 구간(14~146줄)을 펼친다
      await folds.nth(1).click();
      await expect(folds).toHaveCount(3);
      await expect(page.locator('#diff [data-old-line="60"]')).toHaveCount(1);
      await page.click('#fold-toggle');
      await waitReady(page);
      await expect(folds).toHaveCount(0);
      expect((await lineSequences(page)).old).toEqual(seq(300));
      await expect(page.locator('#fold-toggle')).toHaveText('모두 접기');
      await page.click('#fold-toggle');
      await waitReady(page);
      await expect(folds).toHaveCount(4);
    });

    test('6. n/p 키로 이동: 카운터가 바뀌고 해당 블록이 뷰포트 안', async ({ page }) => {
      await openApp(page, engine);
      const { a, b } = sample(300, [10, 150, 290]);
      await fillAndCompare(page, a, b);
      await page.locator('#diff').click({ position: { x: 5, y: 5 } });
      const pos = page.locator('#nav-pos');
      await expect(pos).toHaveText('0 / 3');
      await page.keyboard.press('n');
      await expect(pos).toHaveText('1 / 3');
      await page.keyboard.press('j');
      await expect(pos).toHaveText('2 / 3');
      const second = page.locator('#diff .row.current').first();
      await expect(second).toHaveAttribute('data-old-line', '150');
      await expect(second).toBeInViewport();
      await page.keyboard.press('n');
      await expect(pos).toHaveText('3 / 3');
      await expect(page.locator('#diff .row.current').first()).toHaveAttribute('data-old-line', '290');
      await expect(page.locator('#diff .row.current').first()).toBeInViewport();
      await page.keyboard.press('p');
      await page.keyboard.press('k');
      await expect(pos).toHaveText('1 / 3');
      await expect(page.locator('#diff .row.current').first()).toBeInViewport();
      // 상단 바 ▼ 버튼으로도 이동
      await page.click('#nav-next');
      await expect(pos).toHaveText('2 / 3');
      // 입력 요소(select)에 포커스가 있으면 n/p로 이동하지 않는다
      await page.focus('#opt-context');
      await page.keyboard.press('n');
      await expect(pos).toHaveText('2 / 3');
    });

    test('7. 공백 무시 켜기 → 자동 재계산 → CRLF vs LF가 "차이 없음"', async ({ page }) => {
      await openApp(page, engine);
      await page.setInputFiles('#old-file', { name: 'crlf.txt', mimeType: 'text/plain', buffer: Buffer.from('a\r\nb\r\nc\r\n') });
      await page.setInputFiles('#new-file', { name: 'lf.txt', mimeType: 'text/plain', buffer: Buffer.from('a\nb\nc\n') });
      await expect(page.locator('#old-badges')).toContainText('CRLF');
      await expect(page.locator('#new-badges')).not.toContainText('CRLF');
      await page.keyboard.press('Control+Enter');
      await waitReady(page);
      expect(await summary(page)).toMatchObject({ added: 3, removed: 3, changes: 1 });
      await page.check('#opt-ws');
      await waitReady(page);
      await expect(page.locator('#summary-text')).toHaveText('차이 없음(무시 옵션 기준)');
      expect(await summary(page)).toMatchObject({ added: 0, removed: 0, changes: 0 });
    });

    test('8. patch 패널 텍스트 == Node makeUnifiedPatch 결과', async ({ page }) => {
      await openApp(page, engine);
      await fillAndCompare(page, CODE_A, CODE_B);
      await page.click('#patch-open');
      await expect(page.locator('#patch-dialog')).toBeVisible();
      const expected = D.makeUnifiedPatch(D.diff(CODE_A, CODE_B), { oldName: 'a', newName: 'b', context: 3 });
      expect(await page.inputValue('#patch-text')).toBe(expected);
      await expect(page.locator('#patch-note')).toBeHidden();
      // 컨텍스트 0으로 바꾸면 patch도 바뀐다
      await page.keyboard.press('Escape');
      await page.selectOption('#opt-context', '0');
      await page.click('#patch-open');
      const expected0 = D.makeUnifiedPatch(D.diff(CODE_A, CODE_B), { oldName: 'a', newName: 'b', context: 0 });
      expect(await page.inputValue('#patch-text')).toBe(expected0);
    });

    test('9. 다운로드 파일 내용 == patch (CRLF 파일의 \\r 보존)', async ({ page }) => {
      await openApp(page, engine);
      await fillAndCompare(page, CODE_A, CODE_B);
      await page.click('#patch-open');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#patch-download')]);
      expect(dl.suggestedFilename()).toBe('changes.diff');
      const expected = D.makeUnifiedPatch(D.diff(CODE_A, CODE_B), { oldName: 'a', newName: 'b', context: 3 });
      expect(readFileSync(await dl.path(), 'utf8')).toBe(expected);
      await page.keyboard.press('Escape');

      // CRLF 파일: textarea가 \r을 정규화해도 원문으로 비교하고 patch에 \r이 남아야 한다
      const A = 'one\r\ntwo\r\nthree\r\n', B = 'one\r\nTWO\r\nthree\r\n';
      await page.click('#back');
      await page.setInputFiles('#old-file', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from(A) });
      await page.setInputFiles('#new-file', { name: 'y.txt', mimeType: 'text/plain', buffer: Buffer.from(B) });
      await page.click('#patch-open');
      await expect(page.locator('#patch-dialog')).toBeVisible();
      const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#patch-download')]);
      expect(dl2.suggestedFilename()).toBe('x.txt.diff');
      const expected2 = D.makeUnifiedPatch(D.diff(A, B), { oldName: 'x.txt', newName: 'y.txt', context: 3 });
      const got = readFileSync(await dl2.path(), 'utf8');
      expect(got).toBe(expected2);
      expect(got).toContain('-two\r\n+TWO\r\n');
      expect(D.applyUnifiedPatch(A, got)).toBe(B);
    });

    test('10. 파일 입력으로 좌우 로드, 파일명 표시, 바이너리 거부', async ({ page }) => {
      await openApp(page, engine);
      await page.setInputFiles('#old-file', { name: 'left.txt', mimeType: 'text/plain', buffer: Buffer.from('﻿hello\nworld') });
      await page.setInputFiles('#new-file', { name: 'right.txt', mimeType: 'text/plain', buffer: Buffer.from('hello\nthere\n') });
      await expect(page.locator('#old-name')).toHaveText('left.txt');
      await expect(page.locator('#new-name')).toHaveText('right.txt');
      await expect(page.locator('#old-badges')).toContainText('BOM');
      await expect(page.locator('#old-badges')).toContainText('끝 개행 없음');
      await expect(page.locator('#old-badges')).toContainText('2줄');
      await page.keyboard.press('Control+Enter');
      await waitReady(page);
      await expect(page.locator('#diff .diff-head')).toContainText('left.txt');
      const r = D.diff('﻿hello\nworld', 'hello\nthere\n');
      expect(await summary(page)).toMatchObject(plain(r.stats));

      await page.click('#back');
      const bin = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x41, 0x42]);
      await page.setInputFiles('#old-file', { name: 'archive.zip', mimeType: 'application/zip', buffer: bin });
      await expect(page.locator('#old-msg')).toContainText('바이너리');
      // 거부된 파일은 내용을 바꾸지 않는다
      await expect(page.locator('#old-name')).toHaveText('left.txt');
    });

    test('11. 사용자 텍스트의 HTML은 실행되지 않고 텍스트로 표시', async ({ page }) => {
      const log = await openApp(page, engine);
      const evil = '<img src=x onerror=alert(1)>';
      const a = lines(['safe', evil, '<script>alert(2)</script>']);
      const b = lines(['safe', evil + ' changed', '<b onclick=alert(3)>x</b>']);
      await page.setInputFiles('#new-file', { name: '<img src=y onerror=alert(4)>.txt', mimeType: 'text/plain', buffer: Buffer.from(b) });
      await page.fill('#old-text', a);
      await page.keyboard.press('Control+Enter');
      await waitReady(page);
      await expect(page.locator('#diff')).toContainText(evil);
      await expect(page.locator('#diff')).toContainText('<script>alert(2)</script>');
      await expect(page.locator('#diff img, #diff script, #diff b')).toHaveCount(0);
      await expect(page.locator('#diff .diff-head')).toContainText('<img src=y onerror=alert(4)>.txt');
      await page.click('#view-unified');
      await waitReady(page);
      await page.click('#patch-open');
      await page.waitForTimeout(300);
      expect(log.dialogs).toBe(0);
      expect(log.errors).toEqual([]);
    });

    test('14. 색 대비: 추가·삭제 줄과 줄 내부 강조가 4.5:1 이상 (시스템 테마 + 반대 테마 강제)', async ({ page }) => {
      await openApp(page, engine);
      await fillAndCompare(page, CODE_A, CODE_B);
      const measure = () => page.evaluate(() => {
        const parse = (c) => {
          const m = c.match(/rgba?\(([^)]+)\)/);
          if (!m) return [0, 0, 0, 0];
          const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
          return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
        };
        const over = (top, bottom) => {
          const a = top[3];
          return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
        };
        const bgOf = (el) => {
          const stack = [];
          for (let e = el; e; e = e.parentElement) {
            const c = parse(getComputedStyle(e).backgroundColor);
            if (c[3] > 0) stack.push(c);
            if (c[3] === 1) break;
          }
          let base = [255, 255, 255, 1];
          for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
          return base;
        };
        const lum = (c) => {
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
        };
        const ratio = (fg, bg) => {
          const a = lum(fg), b = lum(bg);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const out = [];
        const sels = ['.row:not(.ign) .code.add', '.row:not(.ign) .code.del', '.hl-add', '.hl-del', '.row:not(.ign) .ln.add', '.row:not(.ign) .ln.del'];
        for (const sel of sels) {
          const els = [...document.querySelectorAll('#diff ' + sel)];
          if (!els.length) out.push({ sel, missing: true });
          for (const el of els.slice(0, 3)) {
            const bg = bgOf(el);
            const fg = over(parse(getComputedStyle(el).color), bg);
            out.push({ sel, ratio: ratio(fg, bg) });
            if (el.classList.contains('code')) {
              const sign = over(parse(getComputedStyle(el, '::before').color), bg);
              out.push({ sel: sel + '::before', ratio: ratio(sign, bg) });
            }
          }
        }
        return out;
      });
      const check = async (label) => {
        const res = await measure();
        expect(res.filter((r) => r.missing), label + ' 요소 없음').toEqual([]);
        const bad = res.filter((r) => r.ratio < 4.5);
        expect(bad, label + ' 대비 부족').toEqual([]);
      };
      await check('system');
      const scheme = await page.evaluate(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
      await page.selectOption('#theme', scheme === 'dark' ? 'light' : 'dark');
      await check(scheme === 'dark' ? 'forced light' : 'forced dark');
    });
  });
}

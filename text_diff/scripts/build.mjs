// dist/diff.html 생성: src/ui/index.html 템플릿에 styles.css, diff-core.js, app.js를 인라인한다.
// 빌드 결과를 자동 검사하고 하나라도 실패하면 exit 1.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const problems = [];
const template = read('src/ui/index.html');
const css = read('src/ui/styles.css');
const core = read('src/core/diff-core.js');
const app = read('src/ui/app.js');

// 인라인 안전성: </script 가 있으면 스크립트가 조기 종료된다. <!-- 는 HTML 파서의 script 이스케이프 상태를 연다.
// raw CR은 HTML 파서가 LF로 바꿔 버려 Worker에 주입되는 코어가 원본과 달라진다.
for (const [name, src] of [['diff-core.js', core], ['app.js', app]]) {
  if (/<\/script/i.test(src)) problems.push(`${name}: '</script' 문자열이 있음`);
  if (src.includes('<!--')) problems.push(`${name}: '<!--' 문자열이 있음`);
  if (src.includes('\r')) problems.push(`${name}: CR 문자가 있음`);
}
if (/<\/style/i.test(css)) problems.push(`styles.css: '</style' 문자열이 있음`);
for (const ph of ['<!--STYLES-->', '<!--CORE-->', '<!--APP-->']) {
  if (template.split(ph).length !== 2) problems.push(`index.html: 자리표시자 ${ph}가 정확히 한 번 있어야 함`);
}
if (problems.length) bail();

// String.replace의 $& 등 치환 패턴이 소스에 섞여 해석되지 않도록 함수로 넘긴다
const html = template
  .replace('<!--STYLES-->', () => `<style>\n${css}</style>`)
  .replace('<!--CORE-->', () => `<script id="diff-core">${core}</script>`)
  .replace('<!--APP-->', () => `<script>\n${app}</script>`);

// ── 빌드 결과 검사 ──
// 1) 외부 리소스 참조 없음
const external = [
  /\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//gi,
  /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//gi,
  /url\(\s*["']?\s*(?:https?:)?\/\//gi,
];
for (const re of external) {
  const m = html.match(re);
  if (m) problems.push(`외부 리소스 참조: ${m.slice(0, 3).join(', ')}`);
}
// 2) <script id="diff-core"> 내용이 소스와 같은 해시
const m = /<script id="diff-core">([\s\S]*?)<\/script>/.exec(html);
const extracted = m ? m[1] : '';
const srcHash = sha256(core), distHash = sha256(extracted);
if (!m) problems.push('<script id="diff-core">를 찾지 못함');
else if (srcHash !== distHash) problems.push(`코어 해시 불일치 src ${srcHash} ≠ dist ${distHash}`);
if (problems.length) bail();

mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
writeFileSync(path.join(ROOT, 'dist', 'diff.html'), html);
// 배포본 재검증용: dist에서 추출한 코어 (npm run fuzz -- --core tmp/dist-core.js)
mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
writeFileSync(path.join(ROOT, 'tmp', 'dist-core.js'), extracted);

const size = Buffer.byteLength(html, 'utf8');
console.log(`dist/diff.html  ${(size / 1024).toFixed(1)} KB (${size} bytes)`);
console.log(`코어 SHA-256    ${distHash} (src와 일치)`);
console.log('외부 리소스 참조 0개');
console.log('→ tmp/dist-core.js 저장');

function bail() {
  console.error('빌드 실패:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

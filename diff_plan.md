# plan.md — 텍스트 Diff 도구 (단일 HTML)

> 이 문서는 Claude Code가 처음부터 끝까지 그대로 실행하기 위한 작업 계획서다.
> **Phase 순서대로 진행하고, 각 Phase의 "완료 조건"이 전부 충족되기 전에는 다음 Phase로 넘어가지 않는다.**

---

## 0. 작업 규칙 (Claude Code가 항상 지킬 것)

1. Phase 순서대로 진행한다. 각 Phase가 끝나면 `완료 조건`을 하나씩 실제로 실행해 확인하고, 결과(명령과 출력 요약)를 `PROGRESS.md`에 기록한 뒤 git commit 한다.
2. **테스트를 통과시키려고 테스트를 약화시키지 않는다.** 테스트 기대값·반복 횟수·시간 목표를 낮추거나, 실패 케이스를 skip 하거나, 검증 로직을 우회하는 것은 금지. 기대값 자체가 틀렸다고 판단되면 근거를 `PROGRESS.md`에 쓰고 사용자에게 확인받는다.
3. 퍼징에서 실패가 나오면 실패 입력을 `test/regressions/`에 고정 케이스로 저장하고, 원인을 고친 뒤 회귀 테스트에 포함시킨다.
4. 이 문서의 **결정 사항(§2)** 과 다르게 구현해야 할 이유가 생기면, 임의로 바꾸지 말고 사유를 기록하고 사용자에게 묻는다.
5. 외부 런타임 의존성은 0개다. 최종 산출물 `dist/diff.html`은 네트워크 없이 `file://`로 열어서 완전히 동작해야 한다. (개발 의존성은 `@playwright/test`만 허용)
6. 코어 엔진(`src/core/diff-core.js`)은 DOM/브라우저 API를 쓰지 않는다. 브라우저 메인 스레드, Web Worker, Node 세 환경에서 동일하게 돌아야 한다.
7. 모든 사용자 노출 문자열은 한국어.
8. 이 문서 끝의 **부록 A(사전 검증 결과)** 는 계획 작성 시 실제로 실행해 확인한 사실이다. 그 항목은 다시 의심해 설계를 바꾸지 말고 그대로 따른다.

---

## 1. 목표와 범위

### 목표
두 텍스트(붙여넣기 또는 파일)를 비교해 차이를 보여주고, 표준 unified patch를 내보내는 **단일 HTML 파일** 도구.
"완벽"의 기준은 아래 세 가지를 **실행으로 증명**하는 것이다.

- **정확성**: 생성한 unified patch를 GNU `patch -F0`로 원본에 적용하면 대상 파일과 바이트 단위로 같다.
- **최소성**: 휴리스틱이 개입하지 않은 경우, 편집(삭제+추가 줄) 수가 `diff --minimal`과 같다.
- **실사용 성능**: 10만 줄급 입력을 정해진 시간 안에 처리하고 UI가 멈추지 않는다.

### 범위 안 (v1)
- 줄 단위 diff (Myers, 선형 공간), 줄 내부 단어/기호 단위 강조
- side-by-side / unified 보기 전환
- 옵션: 공백 무시, 대소문자 무시, 빈 줄 무시, 컨텍스트 줄 수
- 변경 없는 구간 접기/펼치기, 변경 간 키보드 이동
- 파일 열기, 드래그 앤 드롭, 붙여넣기, 좌우 바꾸기
- unified patch 보기·복사·다운로드
- 라이트/다크, 모바일 폭 대응

### 범위 밖 (v1에서 하지 않음)
- 3-way merge, 디렉터리 비교, 바이너리 비교, 이미지 비교
- 편집 결과 저장/동기화, 계정, 서버
- 문자 인코딩 자동 감지 (UTF-8 고정)
- patch를 **읽어서** 적용하는 UI 기능 (테스트용 `applyUnifiedPatch`는 만들지만 UI에는 노출하지 않음)

---

## 2. 결정 사항 (모호함 제거용 — 구현은 이것을 따른다)

| # | 항목 | 결정 |
|---|---|---|
| D1 | 줄 분리 | `\n` 기준으로만 자른다. `\r`은 줄 내용의 일부로 남긴다(CRLF 파일은 각 줄 끝에 `\r`이 붙은 상태). |
| D2 | 마지막 개행 | 텍스트가 `\n`으로 끝나면 `eol=true`이고 마지막 빈 조각은 줄로 치지 않는다. `""`는 0줄, `"\n"`은 빈 줄 1개(`eol=true`), `"a"`는 1줄(`eol=false`). |
| D3 | 개행 유무 차이 | GNU diff와 동일하게, 마지막 줄 `foo`(개행 없음)와 `foo\n`은 **다른 줄**이다. 비교 키에 "개행 없음" 표식을 붙여 구현한다. 이 규칙은 무시 옵션과 무관하게 **항상** 적용한다. |
| D4 | 공백 무시 | 비교 키에서 모든 공백 문자(`\s`, `\r` 포함)를 제거한다 (GNU `-w` 상당). 표시는 원문. |
| D5 | 대소문자 무시 | 비교 키를 `toLowerCase()` 한다 (GNU `-i` 상당). 표시는 원문. |
| D6 | 빈 줄 무시 | diff는 정상 수행하고, **삭제·추가된 줄이 전부 빈 줄(공백 무시가 켜져 있으면 공백만 있는 줄 포함)** 인 변경 블록을 `ignored=true`로 표시한다. ignored 블록은 통계·탐색·접기 판단에서 변경으로 치지 않는다. |
| D7 | 알고리즘 | Myers O(ND), 선형 공간 middle snake 분할정복. 전처리로 공통 prefix/suffix 제거, 상대편에 없는 줄 사전 확정. |
| D8 | 비용 상한 | `budget` = **middle snake 1회 호출에서 허용하는 최대 d(편집 단계)**. d가 budget을 넘으면 휴리스틱 분할로 전환하고 결과에 `minimal=false`. UI에 "대용량 입력이라 최소 diff가 아닐 수 있음" 배지를 표시. 상세는 §1.3. |
| D9 | 줄 내부 diff 토큰 | 정규식 `/[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}_\s]/gu` 로 토큰화(단어 / 공백 덩어리 / 기호 1개씩). `\p{M}`(결합 문자)은 단어에 포함. 줄 내부 diff는 무시 옵션과 무관하게 **원문**으로 계산한다. |
| D10 | 줄 짝짓기 | 변경 블록의 삭제 줄 i번째와 추가 줄 i번째를 위치 기준으로 짝짓는다. 유사도 = `2 × (old 줄에서 변경되지 않은 토큰들의 UTF-16 길이 합) / (len(a) + len(b))`, 두 줄이 모두 빈 문자열이면 1. 유사도가 0.3 미만이면 그 짝은 `pairs`에 넣지 않는다(줄 전체를 변경으로 표시). 두 줄 중 하나라도 10,000자를 넘으면 그 짝도 `pairs`에 넣지 않는다. |
| D11 | unified 형식 | GNU diff `-u` 형식. 기본 컨텍스트 3줄. 헤더는 `--- <왼쪽 이름>` / `+++ <오른쪽 이름>` (타임스탬프 없음). 이름 기본값 `a`, `b`, 파일을 열었으면 파일명. |
| D12 | 무시 옵션과 patch | 무시 옵션이 켜진 상태의 patch는 GNU `-w/-i/-B`와 같은 성격이다: 컨텍스트 줄은 왼쪽 원문으로 출력되고, 무시된 차이는 반영되지 않는다. patch 보기 화면에 이 사실을 한 줄로 안내한다. |
| D13 | 대용량 계산 | 계산은 Web Worker에서 수행한다. Worker 생성이 실패하면 메인 스레드로 폴백한다. URL 쿼리 `?worker=0`이면 강제로 메인 스레드를 사용한다(테스트용). |
| D14 | 렌더링 | 결과 행을 500행 단위 청크로 묶고, 각 청크에 `content-visibility: auto`와 `contain-intrinsic-size`를 지정해 화면 밖 렌더링을 건너뛴다. 긴 줄은 줄바꿈(`white-space: pre-wrap; overflow-wrap: anywhere`), 탭 폭 4. |
| D15 | 인코딩 | 파일은 UTF-8로 읽는다. BOM은 제거하지 않고 원문 그대로 비교하며, BOM이 있으면 해당 쪽에 `BOM` 배지를 표시한다. |
| D16 | 바이너리 | 파일 앞 8KB에 NUL 바이트가 있으면 바이너리로 판단하고 비교를 거부하는 안내를 표시한다. |
| D17 | 저장 | localStorage 등 브라우저 저장소를 쓰지 않는다(다크 모드 수동 선택 포함 — 세션 내 변수로만 유지). |

---

## 3. 저장소 구조

```
diff-tool/
├── package.json
├── PROGRESS.md                 # Phase별 실행 기록
├── README.md
├── src/
│   ├── core/diff-core.js       # 순수 엔진 (DOM 없음)
│   └── ui/
│       ├── index.html          # 템플릿 (빌드 시 css/js/core 인라인)
│       ├── styles.css
│       └── app.js
├── scripts/
│   ├── build.mjs               # dist/diff.html 생성
│   └── check-env.mjs           # 전제 도구 확인
├── test/
│   ├── unit/*.test.mjs         # node:test
│   ├── fuzz/fuzz.mjs           # GNU diff/patch 대조 퍼징
│   ├── fuzz/gen.mjs            # 시드 기반 입력 생성기
│   ├── perf/perf.mjs           # 성능 측정
│   ├── load-core.mjs           # 코어 파일 경로를 받아 vm으로 로드
│   ├── regressions/*.json      # 퍼징에서 나온 실패 케이스 고정 (JSON)
│   └── e2e/*.spec.mjs          # Playwright
└── dist/diff.html              # 최종 산출물 (빌드 결과)
```

> Phase 순서 주의: **빌드(Phase 5)를 UI(Phase 6)보다 먼저** 만든다. Worker가 인라인된 코어 소스 텍스트를 써야 하므로(D13), UI는 처음부터 빌드 결과물로만 확인한다. 별도의 "빌드 없는 개발 모드"는 만들지 않는다.

---

## Phase 0 — 환경 준비

### 할 일
- [ ] `git init`, `.gitignore`(node_modules, test-results, playwright-report, tmp) 작성
- [ ] `.gitattributes` 작성: `* -text` (git이 줄 끝을 바꾸지 않게. CRLF가 들어간 테스트 데이터 보호)
- [ ] `package.json` 작성: `"type": "module"`, `"engines": { "node": ">=22" }`
- [ ] npm scripts 정의
  - `test` → `node --test "test/unit/*.test.mjs"` (따옴표 필수. Node 22는 디렉터리 인자를 받지 않으며 glob은 Node가 직접 해석함 — 부록 A-6)
  - `fuzz` → `node test/fuzz/fuzz.mjs`
  - `perf` → `node test/perf/perf.mjs`
  - `build` → `node scripts/build.mjs`
  - `e2e` → `npm run build && npx playwright test`
  - `check-env` → `node scripts/check-env.mjs`
  - `all` → `check-env → test → fuzz → perf → build → e2e` 순서 실행 (앞 단계 실패 시 중단)
- [ ] `scripts/check-env.mjs` 작성: 아래를 확인하고 하나라도 없으면 설치 방법을 출력하고 exit 1
  - Node 버전 ≥ 22
  - **GNU** diff: 후보 `diff`, `gdiff`, `/opt/homebrew/bin/diff`, `/usr/local/bin/diff` 를 차례로 `--version` 실행해 출력에 `GNU diffutils`가 있는 첫 번째를 선택
  - **GNU** patch: 후보 `patch`, `gpatch`, `/opt/homebrew/bin/gpatch`, `/usr/local/bin/gpatch` 중 출력에 `GNU patch`가 있는 첫 번째를 선택
  - 찾은 경로를 `tmp/env.json`에 저장
  - 설치 안내 문구: Linux `apt install diffutils patch`, macOS `brew install diffutils gpatch`, Windows는 Git for Windows의 `usr/bin`(GNU diff/patch 포함)을 PATH에 추가
- [ ] Playwright 설치: `npm i -D @playwright/test` 및 `npx playwright install chromium`
  - 이미 설치된 Chromium을 써야 하는 환경이면 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 환경변수로 경로를 받아 config의 `launchOptions.executablePath`에 넘긴다
- [ ] `PROGRESS.md` 생성 (Phase별 섹션 뼈대)

### 완료 조건
- `npm run check-env` 가 exit 0, `tmp/env.json`에 GNU diff/patch 경로가 기록됨
- 첫 commit 완료

---

## Phase 1 — 코어 엔진 구현 (`src/core/diff-core.js`)

### 1.1 모듈 형식
- [ ] 파일 하나에 엔진 전체를 담는다. 외부 import 없음.
- [ ] 노출 방식: 파일 끝에서 `globalThis.DiffCore = { ... }`에 할당하고, 동시에 Node ESM에서 쓸 수 있도록 테스트 쪽에서 `vm`으로 로드하는 헬퍼(`test/load-core.mjs`)를 만든다.
  - 이유: 빌드 시 같은 소스를 `<script>`로 인라인하고 Worker에도 문자열로 주입해야 하므로, `export` 구문을 쓰지 않는 단일 스크립트 형식이 가장 단순하다.
  - `test/load-core.mjs`는 **파일 경로를 인자로 받아** 로드한다 (Phase 5에서 dist에서 추출한 코어를 같은 방식으로 로드하기 위해).

### 1.2 공개 API (이 시그니처 그대로)
```js
DiffCore.splitLines(text) → { lines: string[], eol: boolean }
DiffCore.diff(oldText, newText, options?) → DiffResult
DiffCore.makeUnifiedPatch(result, { oldName='a', newName='b', context=3 }?) → string
DiffCore.applyUnifiedPatch(oldText, patchText) → string   // 테스트용, 실패 시 throw
DiffCore.diffTokens(aLine, bLine) → { a: Range[], b: Range[], similarity: number }
DiffCore.VERSION → string
```
`options`: `{ ignoreWhitespace=false, ignoreCase=false, ignoreBlankLines=false, budget=DEFAULT_BUDGET, intraline=true }`

`DiffResult`:
```js
{
  oldLines: string[], newLines: string[],
  oldEol: boolean, newEol: boolean,
  blocks: Block[],        // 문서 전체를 빈틈없이 덮는 순서 있는 블록 목록
  stats: { added, removed, changes },   // ignored 블록 제외
  minimal: boolean,       // 휴리스틱 개입 여부
  identical: boolean,     // 바이트 단위로 같음
  equivalent: boolean,    // 무시 옵션 기준으로 차이 없음 (ignored 블록만 있거나 블록이 전부 equal)
}
Block = { type: 'equal'|'change', oldStart, oldEnd, newStart, newEnd, ignored?: boolean,
          pairs?: Array<{ oldIndex, newIndex, oldRanges: Range[], newRanges: Range[] }> }
Range = { start, end }   // 줄 문자열 안의 UTF-16 인덱스 구간, 변경된 부분
```
- `blocks` 불변식: 인접한 두 블록은 같은 type이 아니다(equal-equal, change-change 연속 금지). 모든 블록의 old 구간을 이으면 `[0, oldLines.length)`, new 구간도 마찬가지. equal 블록은 `oldEnd-oldStart == newEnd-newStart`.

### 1.3 구현 단계
- [ ] **splitLines**: D1, D2 규칙 구현
- [ ] **비교 키 생성**: 각 줄을 옵션에 따라 정규화(D4, D5) → 마지막 줄이고 `eol=false`면 키 끝에 `"\u0000<NOEOL>"` 추가(D3) → `Map<string, number>`로 정수 ID 부여 (양쪽이 같은 Map 공유)
- [ ] **전처리 1 — prefix/suffix**: 스택에서 하위 문제를 꺼낼 때마다 공통 prefix/suffix를 제거 (equal로 확정)
- [ ] **전처리 2 — 상대편에 없는 줄 제거**: 최상위에서 한 번, old에만 있는 ID의 줄은 삭제 확정, new에만 있는 ID의 줄은 추가 확정하고, 나머지로 축약 배열을 만든 뒤 인덱스 매핑 배열을 유지한다. 축약 배열에서 나온 결과를 원래 인덱스로 되돌린다.
  - 근거: 상대편에 없는 값은 어떤 공통 부분 수열에도 포함될 수 없으므로 제거해도 최소성이 유지된다. 이 근거를 코드 주석에 남긴다.
- [ ] **Myers middle snake (선형 공간)**: 아래 명세대로 구현. 결과는 `changedOld: Uint8Array`, `changedNew: Uint8Array` 표시 배열에 기록한다.
  - 지역 좌표: `N = aHi-aLo`, `M = bHi-bLo`, `delta = N-M`, `odd = (delta & 1) !== 0`, `maxD = ceil((N+M)/2)`
  - 정방향 `Vf[k]` = 대각선 k(`k = x - y`)에서 도달한 최대 x. 초기값 `Vf[1] = 0`.
  - 역방향 `Vb[c]` (c = k - delta) = 대각선 k에서 (N,M)으로부터 거꾸로 도달한 최소 x. 초기값 `Vb[c=1] = N+1`.
  - 아래 `a[i]`, `b[j]`는 **지역 인덱스**다(실제 접근은 `a[aLo+i]`, `b[bLo+j]`).
  - d = 0..maxD 반복:
    - 정방향, k = -d..d (2씩): `k == -d || (k != d && Vf[k-1] < Vf[k+1])` 이면 `x = Vf[k+1]` 아니면 `x = Vf[k-1] + 1`; `y = x - k`; snake 시작점 `(x0,y0)=(x,y)` 기록 후 **`x < N && y < M && a[x]==b[y]`** 인 동안 전진; `Vf[k] = x`.
      odd이고 `c = k - delta`가 `[-(d-1), d-1]` 범위이며 `Vf[k] >= Vb[c]` 이면 겹침 → 이 snake(시작점→끝점)가 middle snake, `D = 2d-1`.
    - 역방향, c = -d..d (2씩), `k = c + delta`: `c == -d || (c != d && Vb[c+1] - 1 < Vb[c-1])` 이면 `x = Vb[c+1] - 1` 아니면 `x = Vb[c-1]`; `y = x - k`; snake 끝점 `(x1,y1)=(x,y)` 기록 후 **`x > 0 && y > 0 && a[x-1]==b[y-1]`** 인 동안 후진; `Vb[c] = x`.
      odd가 아니고 k가 `[-d, d]` 범위이며 `Vf[k] >= x` 이면 겹침 → snake(현재점→기록한 끝점)가 middle snake, `D = 2d`.
  - ⚠ snake 루프의 **경계 조건(굵게 표시)은 생략하면 안 된다.** 하위 문제에서 경계를 넘으면 범위 밖의 실제 원소를 읽어 잘못된 snake가 나온다. 계획 검토 시 경계 조건을 뺀 프로토타입은 무작위 3만 케이스 중 42%에서 상자 밖 snake를 냈다(부록 A-4).
  - 분할: middle snake 앞쪽 `(aLo..aLo+x0, bLo..bLo+y0)`, 뒤쪽 `(aLo+x1..aHi, bLo+y1..bHi)` 를 각각 처리. 기저 사례: 한쪽이 비면 나머지 전부 삭제/추가.
  - **재귀 대신 처음부터 명시적 스택**으로 구현한다(휴리스틱 분할은 한쪽으로 치우쳐 깊이가 O(N)이 될 수 있음). 스택에 뒤쪽 → 앞쪽 순으로 넣는다.
  - **진전 보장 assert**: 찾은 분할점이 `0 ≤ x0 ≤ x1 ≤ N`, `0 ≤ y0 ≤ y1 ≤ M` 이 아니거나, `(x0,y0,x1,y1) == (0,0,N,M)` 이면 즉시 throw (퍼징에서 잡히도록).
  - 배열은 오프셋을 더한 `Int32Array`(크기 `2*maxD + 3`, 오프셋 `maxD + 1`)를 사용한다.
  - 성능: 하위 문제마다 새 배열을 할당하지 말고, 최상위에서 한 번 할당한 Vf/Vb를 재사용한다.
- [ ] **비용 상한 (D8)**: 정방향 단계 d를 시작하기 직전에 `d > budget` 이면:
  - 직전 단계(d-1)의 정방향 대각선들(k = -(d-1)..d-1, 2씩)에서 점 `(x, y = x-k)` 중 **상자 안(`0≤x≤N`, `0≤y≤M`)** 이고 `(0,0)`, `(N,M)`이 아닌 것 가운데 `x + y`가 최대인 점을 고른다.
  - 그 점을 길이 0짜리 snake `(x,y,x,y)`로 보고 앞뒤로 분할하고, 전역 플래그 `minimal = false`.
  - 조건을 만족하는 점이 없으면 휴리스틱을 쓰지 않고 이번 d를 그대로 진행한다.
  - `DEFAULT_BUDGET`은 입력 크기에 따라 정하는 함수로 둔다(예: `max(MIN, f(N+M))`). 아래 두 조건을 **둘 다** 만족해야 하며, 측정값과 선택 근거를 주석과 `PROGRESS.md`에 남긴다.
    - P1(Phase 4)이 `minimal=true`
    - P3가 시간 목표 안
    - 참고(계획 검토 시 최적화하지 않은 프로토타입 측정, P3 입력): budget 256 → 0.4s, 1024 → 1.4s, 4096 → 4.5s. **GNU diff의 기본값(최소 4096)을 그대로 가져오면 P3 목표를 넘을 수 있다.**
- [ ] **블록 구성**: `changedOld/changedNew` 배열을 앞에서부터 함께 걸으며 equal/change 블록을 만든다(§1.2 불변식 충족).
  - 주의: 둘 다 변경되지 않은 위치에서는 old의 다음 줄과 new의 다음 줄이 반드시 같은 ID여야 한다. 개발 중 assert로 확인.
- [ ] **빈 줄 무시 (D6)**: 블록 구성 후 change 블록 각각에 대해 판정해 `ignored` 설정.
- [ ] **줄 내부 diff (D9, D10)**: `intraline=true`이고 ignored가 아닌 change 블록에 대해 `pairs` 계산. 토큰 diff도 같은 Myers 구현을 재사용(토큰 → 정수 ID, budget 무제한). 결과 Range는 인접 구간을 병합하고, 순수 공백 토큰만으로 된 변경 구간도 그대로 표시한다. `pairs`는 `oldIndex` 오름차순이고, 조건(D10)을 통과한 짝만 들어 있다.
- [ ] **stats**: ignored 블록 제외. `added` = 추가 줄 수, `removed` = 삭제 줄 수, `changes` = change 블록 수.
- [ ] **identical / equivalent** 계산.
- [ ] **makeUnifiedPatch (D11, D12)**:
  - "유효 블록" = `ignored`가 아닌 change 블록. 하나도 없으면 빈 문자열 `""` 반환.
  - **병합**: 연속한 두 유효 블록 S1, S2 사이의 old 줄 수(`S2.oldStart - S1.oldEnd`, 사이에 있는 equal 블록과 ignored 블록의 old 줄을 모두 포함)가 `2*context` 이하면 같은 hunk로 묶는다. (GNU `diff -u`와 같은 규칙. 부록 A-2)
  - **hunk 내부**: 묶인 범위 안의 equal 블록은 `' '` 줄, ignored 블록을 포함한 change 블록은 `-`/`+` 줄로 전부 출력한다.
  - **앞뒤 컨텍스트**: hunk의 첫 유효 블록 바로 앞 블록은 불변식상 항상 equal(또는 없음)이므로, 그 equal 블록의 마지막 `min(context, 길이)` 줄을 앞 컨텍스트로 쓴다. 뒤 컨텍스트도 마지막 유효 블록 바로 뒤 equal 블록의 처음 `min(context, 길이)` 줄. 컨텍스트는 그 equal 블록을 넘어 확장하지 않는다. 그래서 hunk 밖의 ignored 블록은 출력되지 않는다.
  - 헤더 범위 형식: 길이 0이면 `start0,0`(start0 = 0-기준 시작 인덱스 = 앞에 있는 줄 수), 길이 1이면 `start0+1`, 그 외 `start0+1,len`.
  - 줄 출력: equal → `' ' + oldLine`, 삭제 → `'-' + oldLine`, 추가 → `'+' + newLine`. 한 change 블록 안에서는 삭제 줄 전부 → 추가 줄 전부 순서.
  - `\ No newline at end of file`: old의 마지막 줄을 `' '` 또는 `'-'`로 출력했고 `oldEol=false`면 그 줄 바로 뒤에 출력. new의 마지막 줄을 `'+'`로 출력했고 `newEol=false`면 그 줄 바로 뒤에 출력. (`' '` 줄은 D3 덕분에 old·new 모두의 마지막 줄이므로 표식은 한 번만.)
  - patch 텍스트의 모든 줄은 `\n`으로 끝난다.
- [ ] **applyUnifiedPatch**: 위 형식을 파싱해 적용하는 엄격한 구현. 컨텍스트·삭제 줄이 원본과 정확히 일치하지 않으면 throw. `\ No newline` 처리 포함. (테스트에서 GNU patch와 교차 검증하는 용도)
- [ ] **diffTokens**: 단독 호출용 래퍼 (UI·테스트에서 사용)

### 완료 조건
- 엔진 파일이 Node `vm`으로 로드됨 (브라우저·Worker 로드는 Phase 5 smoke 테스트에서 확인)
- 아래 Phase 2 단위 테스트가 작성 가능할 만큼 API가 완성됨
- commit

---

## Phase 2 — 단위 테스트 (`test/unit/`)

### 할 일 — 최소 아래 케이스 전부 작성
- [ ] `splitLines`: `""`, `"\n"`, `"a"`, `"a\n"`, `"a\n\n"`, `"a\r\nb\r\n"`, `"\n\n\n"`, 유니코드/이모지 줄
- [ ] 동일 입력: `identical=true`, blocks가 equal 하나(또는 둘 다 빈 텍스트면 빈 배열), patch `""`
- [ ] 빈 → 내용 있음, 내용 있음 → 빈 (헤더 `@@ -0,0 +1,N @@` / `@@ -1,N +0,0 @@` 확인)
- [ ] 한 줄짜리 파일 변경 (헤더 길이 1 생략 형식 확인)
- [ ] 마지막 개행만 다름: `"a"` vs `"a\n"` → 변경 1개, patch에 `\ No newline at end of file` 정확히 한 번, 위치 확인
- [ ] 양쪽 모두 개행 없이 끝나고 마지막 줄이 컨텍스트인 경우 → 표식 한 번
- [ ] 파일 시작/끝에 걸친 변경, 컨텍스트가 파일 경계에서 잘리는 경우
- [ ] hunk 병합 경계: context=3에서 사이 equal 줄 6개면 hunk 1개, 7개면 2개. context=0에서 사이 equal 줄 1개면 hunk 2개. (equal 0줄 사이의 두 change 블록은 불변식상 존재하지 않음)
- [ ] 빈 줄 무시 + 병합: 두 유효 블록 사이에 ignored 블록이 끼어 있고 old 기준 간격이 `2*context` 이하일 때 하나의 hunk에 `-`/`+`로 출력되는지, 간격이 크면 ignored 블록이 patch에 나오지 않는지
- [ ] 각 hunk 헤더의 줄 수가 실제 본문 줄 수(`' '`+`-` / `' '`+`+`)와 일치하는지 검사하는 함수를 모든 patch에 적용
- [ ] `-`, `+`, ` `, `\`, `@@`, `---`, `+++` 로 시작하는 내용 줄이 patch에서 깨지지 않음
- [ ] CRLF 파일 vs LF 파일: 옵션 없으면 전 줄 변경, 공백 무시면 equivalent
- [ ] 공백 무시 / 대소문자 무시 / 빈 줄 무시 각각과 조합
- [ ] 빈 줄 무시: 빈 줄만 추가된 블록은 ignored, 빈 줄과 내용 줄이 섞인 블록은 ignored 아님
- [ ] 줄 내부 diff: 단어 하나 변경, 한글 단어 변경, 기호만 변경, 유사도 0.3 미만이면 pairs 없음, 10,000자 초과 줄 생략
- [ ] `blocks` 불변식 검사 함수를 만들어 모든 테스트 결과에 적용
- [ ] 옵션 없는 모든 단위 케이스에 `applyUnifiedPatch(old, makeUnifiedPatch(diff(old,new))) === new` 적용. 옵션 있는 케이스는 Phase 3의 정규화 속성으로 확인
- [ ] 작은 budget(예: 1)으로 강제 휴리스틱 → `minimal=false`이고 patch는 여전히 정확
- [ ] Myers 정답 확인용 **참조 구현**: O(NM) DP로 LCS 길이를 계산하는 느리지만 단순한 함수를 테스트 코드에 두고, 작은 입력(알파벳 1~4, 길이 0~30) **1만 개 이상**에서 `엔진 편집 수 == (N + M - 2*LCS)` 확인 (GNU 도구 없이도 최소성 검증 가능하도록)
- [ ] 같은 참조 구현으로 budget 1~4의 강제 휴리스틱 입력(길이 1~300, 알파벳 2) 수천 개를 돌려, 결과가 항상 **올바른 정렬**(변경 안 된 줄끼리 순서대로 같음)인지 확인
- [ ] `test/unit/regressions.test.mjs`: `test/regressions/*.json`을 전부 읽어 퍼징과 같은 검사를 다시 수행 (파일이 없으면 통과)

### 완료 조건
- `npm test` 전부 통과, 결과를 `PROGRESS.md`에 기록, commit

---

## Phase 3 — 퍼징 (`test/fuzz/`)

### 3.1 입력 생성기 (`gen.mjs`)
- [ ] 시드 기반 PRNG(mulberry32 또는 xorshift128+) 사용. **단순 선형합동(LCG)은 쓰지 않는다** — 계획 검토 중 LCG로 연속 생성한 두 수열이 강하게 상관되어 측정값이 왜곡된 것을 확인함. 모든 케이스는 `(seed, caseIndex)`로 재현 가능해야 하므로, 케이스마다 `mulberry32(hash(seed, caseIndex))`로 새 PRNG를 만든다.
- [ ] 생성 전략을 섞는다 (케이스마다 무작위 선택):
  1. **독립 생성**: 줄 알파벳 크기 {1, 2, 3, 5, 26} 중 선택, 줄 수 0~40
  2. **변이 생성**: A를 만든 뒤 무작위 삽입/삭제/치환/줄 이동/블록 복제를 1~10회 적용해 B 생성
  3. **극단**: 빈 파일, 1줄, 모든 줄이 같은 파일, 완전히 다른 파일
- [ ] 줄 내용 풀에 반드시 포함: 빈 줄, 공백만 있는 줄, 탭, 끝에 `\r`, 한글·이모지, `-`/`+`/` `/`\`/`@@ -1 +1 @@`/`--- x`/`+++ y`로 시작하는 줄
- [ ] 마지막 개행 유무를 양쪽 독립적으로 무작위 결정

### 3.2 검사 (`fuzz.mjs`) — 케이스마다 전부 수행
- [ ] **불변식**: blocks 불변식 통과
- [ ] **자체 적용** (옵션 없는 케이스): `applyUnifiedPatch(A, patch) === B`. 옵션 있는 케이스는 아래 옵션 속성 테스트로 확인
- [ ] **GNU patch 적용**: 케이스마다 새 임시 디렉터리를 만들고(`.rej`/`.orig` 잔여 파일 격리) A와 patch를 파일로 쓴 뒤 `patch -s --binary -F0 -o out A p.diff` 실행 → exit 0이고 `out`이 기대값과 바이트 단위로 같아야 함. `--binary`는 Windows에서 줄 끝 변환을 막기 위해 항상 붙인다. patch가 빈 문자열이면 patch를 실행하지 않고 기대값이 A와 같은지만 확인.
  - 기대값: 옵션이 없으면 B, 옵션이 있으면 우리 `applyUnifiedPatch(A, patch)`의 결과
- [ ] **최소성** (옵션 없고 `minimal=true`인 케이스): `diff -a --minimal A B`(normal 형식)를 실행해 출력에서 `< `·`> `로 시작하는 줄 수의 합 == 엔진의 `added + removed`. diff의 exit code는 0(같음)·1(다름)이 정상이고 2만 오류로 처리한다.
- [ ] **옵션 속성 테스트** (케이스의 30%에 무작위 옵션 조합 적용):
  - 공백/대소문자 무시: `applyUnifiedPatch` 결과와 B를 줄 단위로 같은 정규화를 했을 때 일치
  - 빈 줄 무시: 위 비교에서 추가로 빈 줄(정규화 후 빈 문자열)을 제거하고 비교
  - GNU 대조: `diff --minimal -w`, `-i`, `-B` 옵션과의 편집 수 비교는 **하지 않는다** (GNU의 -B 의미가 D6과 정확히 같지 않으므로). 대신 정규화 속성으로만 검증한다.
- [ ] **강제 휴리스틱 케이스**: 케이스의 10%는 budget 1~4로 실행해 `minimal=false` 경로에서도 GNU patch 적용 일치 확인
- [ ] **hunk 헤더 일치**: Phase 2에서 만든 헤더 검사 함수를 모든 patch에 적용
- [ ] **줄 내부 diff 속성**: 각 pair에 대해 old 줄에서 `oldRanges`를 제외한 문자 시퀀스 == new 줄에서 `newRanges`를 제외한 문자 시퀀스 (공통 부분이 실제로 같아야 함)
- [ ] 실패 시: `{ seed, caseIndex, options, budget, A, B, patch, expected, actual, check }` 를 `test/regressions/<seed>-<idx>.json`으로 저장하고(문자열은 JSON 이스케이프로 `\r` 등을 보존) 비정상 종료
- [ ] 실행 옵션
  - `--cases N` (기본 5000)
  - `--seed S` (지정 시 그 seed만 실행)
  - `--random-seeds R` (기본 1): 고정 seed `20261002`를 먼저 돌리고, 무작위 seed R개를 추가로 돌린다. 각 seed 값을 출력해서 재현할 수 있게 한다.
  - `--core PATH` (기본 `src/core/diff-core.js`): 검사할 코어 파일
- [ ] 진행률과 최종 요약(seed별 케이스 수, 옵션 케이스 수, 휴리스틱 케이스 수, 소요 시간) 출력

### 완료 조건
- `npm run fuzz -- --cases 5000 --random-seeds 3` 이 **전부 통과** (고정 seed 1개 + 무작위 seed 3개)
- `test/regressions/`의 모든 케이스가 단위 테스트에서 자동으로 재실행됨
- 결과를 `PROGRESS.md`에 기록, commit

---

## Phase 4 — 성능 (`test/perf/perf.mjs`)

### 할 일
- [ ] 시드 기반으로 아래 입력을 생성해 각각 5회 측정, 중앙값 출력 (Node, 개발 머신 기준)

| 시나리오 | 입력 | 목표 (중앙값) |
|---|---|---|
| P1 유사 대용량 | 10만 줄 코드 비슷한 텍스트 (줄의 20%는 `}`, 빈 줄, `  return x;` 같은 20종 공통 줄 풀에서, 80%는 줄 번호가 들어간 고유한 줄). B는 무작위 1% 줄을 새 내용으로 바꾸고, 0.5% 위치에 줄 삽입, 0.5% 줄 삭제 | diff < 500ms, `minimal=true` |
| P2 완전 상이 | 10만 줄 vs 10만 줄, 공통 줄 없음 | diff < 1s |
| P3 병적 입력 | 5만 줄 vs 5만 줄, 각 줄을 `"0"`/`"1"` 중에서 독립적으로 무작위 선택 (매칭이 많고 D 큼) | diff < 3s, `minimal=false` 허용 |
| P4 긴 줄 | 1,000줄, 각 줄 5,000자, 10% 줄의 일부 단어 변경 | diff+줄 내부 < 1s |
| P5 patch 생성 | P1 결과로 makeUnifiedPatch | < 200ms |

- [ ] 각 시나리오에서 patch 정확성도 함께 확인(`applyUnifiedPatch`)
- [ ] 목표 미달 시 원인을 프로파일링해 고친다 (`node --cpu-prof`). 목표 수치는 낮추지 않는다(규칙 2).
- [ ] 결과 표를 `PROGRESS.md`에 기록 (머신 사양 포함)

### 완료 조건
- P1~P5 전부 목표 충족, commit

---

## Phase 5 — 빌드 (`scripts/build.mjs`)

### 할 일
- [ ] UI는 아직 없으므로 먼저 최소 템플릿을 만든다: `src/ui/index.html`(자리표시자 `<!--STYLES-->`, `<!--CORE-->`, `<!--APP-->` 포함), 빈 `styles.css`, Worker로 `diff("a\n","b\n")`를 한 번 돌려 결과(`stats`의 JSON)를 `document.body.dataset.smoke`에, 사용한 경로를 `document.body.dataset.engine`에 쓰는 최소 `app.js`. Phase 6에서 이 파일들을 실제 UI로 채운다.
- [ ] `src/ui/index.html` 템플릿의 자리표시자에 `styles.css`, `diff-core.js`, `app.js`를 인라인해 `dist/diff.html` 생성
  - 코어는 `<script id="diff-core">` 로 한 번만 넣고, Worker 생성 시 이 요소의 `textContent`를 재사용한다
  - 인라인하는 JS 소스에 `</script` (대소문자 무시)가 있으면 빌드 실패로 처리한다. 코어·앱 코드에서는 그런 문자열을 쓰지 않는다.
- [ ] 빌드 결과 검사 (빌드 스크립트 안에서 자동 수행, 실패 시 exit 1):
  - `dist/diff.html` 안에 `http://`, `https://`로 시작하는 리소스 참조(`src=`, `href=`, `@import`, `url(`)가 없음
  - `<script id="diff-core">` 내용을 추출해 SHA-256을 계산하고, `src/core/diff-core.js`의 SHA-256과 일치
  - 파일 크기 출력
- [ ] **배포본 재검증**: `dist/diff.html`에서 추출한 코어를 `tmp/dist-core.js`로 저장하고, 퍼징을 이 파일로 1,000케이스 실행 (`npm run fuzz -- --core tmp/dist-core.js --cases 1000`)
- [ ] `playwright.config` 작성(Phase 7 설정의 데스크톱 프로젝트만 먼저)과 `test/e2e/smoke.spec.mjs`: `file://`로 `dist/diff.html`을 열어 `document.body.dataset.smoke`가 기대한 결과로 채워지고 `dataset.engine === 'worker'`인지, 콘솔 에러가 없는지 확인

### 완료 조건
- `npm run build` 성공, 해시 일치, 외부 참조 0, 배포본 퍼징 통과, smoke e2e 통과, commit

---

## Phase 6 — UI 구현 (`src/ui/`)

### 6.1 화면 구성
- [ ] **상단 바**: 제목 "Diff", 비교 버튼, 보기 전환(나란히 / 통합), 옵션(공백 무시, 대소문자 무시, 빈 줄 무시, 컨텍스트 줄 수 0/3/5/10/전체), 테마 전환(시스템/라이트/다크), patch 버튼
- [ ] **입력 화면**: 좌(원본) / 우(변경본) 두 패널
  - 각 패널: 이름 표시(기본 "원본"/"변경본", 파일을 열면 파일명), 파일 열기 버튼, 지우기 버튼, textarea(고정폭 글꼴, 줄바꿈 안 함, spellcheck 끔)
  - 패널별 배지: 줄 수, `CRLF`(감지 시), `BOM`(D15), `끝 개행 없음`
  - 패널에 파일을 끌어오면 드롭 영역 하이라이트, 놓으면 해당 패널에 로드. 페이지 아무 데나 파일 2개를 한 번에 놓으면 좌·우에 순서대로 로드
  - 좌우 바꾸기 버튼
  - `Ctrl/Cmd+Enter`로 비교
- [ ] **결과 화면**
  - 요약 줄: `+추가 −삭제 · 변경 N곳`, `minimal=false`면 경고 배지(D8), equivalent면 "차이 없음(무시 옵션 기준)", identical이면 "두 텍스트가 같습니다"
  - 입력으로 돌아가기 버튼 (`Esc`)
  - **나란히 보기**: 행 = [왼쪽 줄번호 | 왼쪽 내용 | 오른쪽 줄번호 | 오른쪽 내용]. change 블록은 삭제 i번째와 추가 i번째를 같은 행에 놓고 남는 쪽은 빈 칸. 같은 행의 높이는 긴 쪽에 맞춤(그리드 행)
  - **통합 보기**: 행 = [왼쪽 줄번호 | 오른쪽 줄번호 | 기호 | 내용], 블록 내 삭제 줄 전부 → 추가 줄 전부
  - 색만으로 구분하지 않는다: 삭제 줄 앞 `−`, 추가 줄 앞 `+` 기호 표시
  - 줄 내부 변경 구간은 더 진한 배경으로 강조
  - ignored 블록은 흐린 스타일 + "무시됨" 표시
  - `\ No newline at end of file` 상황은 해당 줄 끝에 작은 `⏎ 없음` 표식
  - **접기**: 변경과 인접한 context 줄만 보이고 그 사이 equal 구간은 "⋯ N줄 숨김 (클릭해서 펼치기)" 행 하나로 접는다. 클릭 시 그 구간 전체 펼침. "모두 펼치기/접기" 토글 제공
- [ ] **탐색**: `n`/`j` 다음 변경, `p`/`k` 이전 변경(입력 요소에 포커스가 없을 때만). 현재 위치 `3 / 17` 표시, 이동 시 해당 블록을 화면 중앙으로 스크롤하고 강조 테두리. 상단 바에 ▲/▼ 버튼도 제공. ignored 블록은 건너뜀
- [ ] **patch 패널**: 모달 또는 하단 패널로 patch 텍스트 표시(고정폭, 읽기 전용), 복사 버튼, 다운로드 버튼(`<왼쪽이름>.diff` 기본, 왼쪽 이름이 기본값이면 `changes.diff`), 무시 옵션 사용 중이면 D12 안내 문구. 차이가 없으면 "내보낼 차이가 없습니다"
  - 복사는 `navigator.clipboard.writeText` 시도 후 실패 시 textarea 선택 + `document.execCommand('copy')` 폴백, 둘 다 실패하면 "직접 선택해서 복사하세요" 안내
- [ ] **오류/상태 표시**: 바이너리 거부(D16), 50MB 초과 파일은 페이지 안 확인 상자(`window.confirm`/`alert` 사용 금지 — 자동화 테스트를 막음)로 진행 여부 확인, 계산 중 진행 표시(스피너 + "비교 중…"), 계산 오류 시 메시지와 재시도 버튼

### 6.2 계산 흐름
- [ ] 비교 요청 시 Worker로 `{ oldText, newText, options, requestId }` 전송, 응답의 `requestId`가 최신이 아니면 버림
- [ ] 계산 중 새 비교 요청이 오면 기존 Worker를 `terminate()` 하고 새로 만든다
- [ ] Worker는 빌드 시 인라인된 코어 소스 문자열 + 메시지 핸들러로 Blob URL을 만들어 생성 (D13). 생성 실패 또는 `?worker=0`이면 메인 스레드에서 실행하되, 실행 전에 "비교 중…" 표시가 그려지도록 한 프레임 양보(`requestAnimationFrame` 후 `setTimeout 0`)
- [ ] 옵션 변경 시 결과 화면이면 자동 재계산. 보기 전환·접기·컨텍스트 줄 수 변경은 재계산 없이 다시 그리기만
- [ ] 마지막으로 사용한 경로(worker / main)를 `document.body.dataset.engine`에 기록 (e2e 검증용)

### 6.3 렌더링
- [ ] 결과 → 행 모델 배열 생성 → 500행 청크 DOM 생성 (D14). DOM은 `textContent`/요소 생성으로만 만든다 (**`innerHTML`에 사용자 텍스트를 넣지 않는다** — XSS 방지)
- [ ] 줄 내부 강조는 Range를 기준으로 `<span>`을 나눠 만든다. Range가 서로게이트 쌍 중간을 자르지 않는지 확인
- [ ] 첫 화면이 그려지기까지 긴 작업이 메인 스레드를 막지 않도록, 청크 DOM 생성을 프레임 단위로 나눠 수행
- [ ] 각 줄 요소에 `data-old-line`, `data-new-line` 속성 (e2e 검증용)

### 6.4 스타일
- [ ] 색은 `:root` CSS 변수 토큰으로만 정의. 다크는 `@media (prefers-color-scheme: dark)` + `:root[data-theme="dark"]`, 라이트 강제는 `:root[data-theme="light"]`
- [ ] 글꼴: 시스템 UI 글꼴 + 시스템 고정폭 글꼴 스택(웹폰트 사용 안 함, 외부 요청 0)
- [ ] 추가/삭제/줄 내부 강조 배경색은 라이트·다크 모두에서 본문 대비 4.5:1 이상
- [ ] 360px 폭에서 가로 페이지 스크롤 없음. 768px 미만에서는 입력 패널을 위아래로 쌓고, 나란히 보기는 자동으로 통합 보기로 전환(사용자가 명시적으로 나란히를 고르면 허용)
- [ ] 키보드 포커스 표시가 보임, 모든 버튼에 접근 가능한 이름(`aria-label` 또는 텍스트)
- [ ] `prefers-reduced-motion` 존중

### 완료 조건
- `npm run build` 성공, smoke e2e 통과(Phase 5의 smoke는 실제 UI로 바뀐 뒤에도 통과하도록 `dataset.smoke` 대신 기본 비교 흐름으로 갱신)
- 데스크톱·모바일 크기 스크린샷을 한 번씩 찍어 열어 보고, 화면이 깨지지 않았는지 확인
- commit

---

## Phase 7 — 브라우저 E2E (`test/e2e/`, Playwright + Chromium)

### 할 일
- [ ] `playwright.config` 확장: `file://<절대경로>/dist/diff.html` 사용, 데스크톱(1280×800)과 모바일(390×844) 두 프로젝트, 라이트/다크 color scheme
- [ ] 시나리오 (각각 worker 경로와 `?worker=0` 경로 **둘 다** 실행):
  1. 페이지 로드 시 콘솔 에러 0개, 네트워크 요청이 페이지 자체 외에 0개. 이때 Worker용 `blob:` URL 요청과 `data:` 요청은 제외하고 센다(부록 A-5에서 `blob:` 요청이 잡히는 것을 확인함)
  2. 두 textarea에 텍스트 입력(`fill`) → `Ctrl+Enter` → 요약의 +/− 숫자가 코어 계산값과 일치
  3. `document.body.dataset.engine` 이 각각 `worker` / `main`
  4. 나란히 ↔ 통합 전환 후 행 수와 줄번호가 블록 구조와 일치
  5. 접힌 구간 클릭 시 숨겨진 줄이 나타남, 모두 펼치기 토글 동작
  6. `n`/`p` 키로 이동 시 카운터가 바뀌고 해당 블록이 뷰포트 안에 있음
  7. 공백 무시 켜기 → 자동 재계산 → CRLF vs LF 입력이 "차이 없음"
  8. patch 패널 텍스트 == Node에서 같은 입력으로 `makeUnifiedPatch` 한 결과
  9. 다운로드 버튼 → 받은 파일 내용이 위 patch와 같음
  10. 파일 입력(`setInputFiles`)으로 좌우 로드, 파일명 표시, 바이너리 파일은 거부 메시지
  11. 사용자 텍스트에 `<img src=x onerror=alert(1)>` 를 넣어도 스크립트 실행 없음(다이얼로그 이벤트 0회), 텍스트로 표시됨
  12. 대용량: P1 입력(10만 줄)을 **파일로 만들어 `setInputFiles`로** 넣고 비교(5MB를 `fill`로 넣으면 느려 측정이 왜곡됨) → 10초 이내 결과 요약 표시, 이후 결과 영역을 끝까지 스크롤하면 마지막 변경 블록의 줄 요소가 뷰포트에 보임
  13. 모바일 프로젝트: 가로 스크롤 없음(`document.documentElement.scrollWidth <= innerWidth`), 기본 보기가 통합
  14. 색 대비: 라이트·다크 각각에서 추가 줄, 삭제 줄, 줄 내부 강조 요소의 계산된 글자색과 배경색(`getComputedStyle`, 배경이 투명이면 부모로 올라가 합성)으로 WCAG 대비를 계산해 전부 4.5 이상
- [ ] 스크린샷 저장: 입력 화면, 나란히 결과, 통합 결과, patch 패널 × (라이트, 다크) × (데스크톱, 모바일) → `test-results/screens/`
- [ ] **스크린샷을 직접 열어 눈으로 확인**하고 이상(겹침, 잘림, 대비 부족, 정렬 어긋남)을 고친다. 확인 결과를 `PROGRESS.md`에 항목별로 기록

### 완료 조건
- `npm run e2e` 전부 통과, 스크린샷 육안 검토 기록 완료, commit

---

## Phase 8 — 마무리

### 할 일
- [ ] `README.md`: 사용법, 키보드 단축키 표, 옵션 의미(D4~D6, D12 포함), 알려진 한계(D8 휴리스틱, UTF-8 고정, 바이너리 미지원), 검증 방법(`npm run all`)
- [ ] 페이지 안 도움말: 상단 바 `?` 버튼 → 단축키와 옵션 설명 (README와 내용 일치)
- [ ] `npm run all` 을 처음부터 끝까지 한 번에 실행해 전부 통과 확인
- [ ] `PROGRESS.md` 최종 요약: 퍼징 총 케이스 수·seed 목록, 성능 표, e2e 결과, 알려진 한계
- [ ] 최종 commit, 태그 `v1.0.0`

### 최종 완료 조건 (전부 충족해야 "완성")
- [ ] 단위 테스트 전부 통과
- [ ] 퍼징: 5,000케이스 × seed 4개 이상 통과 (GNU patch 적용 일치 + 최소성 일치 + 옵션 속성 + 강제 휴리스틱)
- [ ] 배포본에서 추출한 코어로도 퍼징 통과, 소스와 해시 일치
- [ ] 성능 P1~P5 목표 충족
- [ ] E2E 전부 통과 (worker / main 양쪽), 스크린샷 육안 검토 완료
- [ ] `dist/diff.html` 하나만으로 오프라인 `file://` 실행 가능, 외부 요청 0

---

## 부록 A — 사전 검증 결과 (계획 작성 시 실제 실행, Node 22.22 · GNU diffutils 3.10 · GNU patch 2.7.6 · Chromium)

| # | 확인한 것 | 결과 | 계획에 반영된 곳 |
|---|---|---|---|
| A-1 | GNU `patch -F0`가 CRLF 줄, LF/CRLF 혼합, `\r`만 다른 줄, 빈 파일↔내용, 끝 개행 없음, `--`/`++`/`\`/`@@`로 시작하는 내용 줄이 든 unified patch를 정확히 적용하는가 | 전부 바이트 단위 일치 (`--binary` 유무 무관) | Phase 3 GNU 대조. `--binary`는 Windows 대비용으로만 붙임 |
| A-2 | GNU `diff -u`의 hunk 병합 규칙 | context 3: 사이 equal 6줄이면 hunk 1개, 7줄이면 2개. context 0: 사이 1줄이면 2개 | §1.3 makeUnifiedPatch, Phase 2 |
| A-3 | GNU diff가 `b`(끝 개행 없음)와 `b\n`을 다른 줄로 보는가 | 다른 줄(`2c2` + `\ No newline at end of file`), exit 1 | D3, Phase 3 최소성 |
| A-4 | §1.3의 Myers middle snake 명세를 그대로 프로토타입으로 구현해 O(NM) LCS와 대조 | 경계 조건 포함 시 3만 케이스 전부 최소·정확. **경계 조건을 빼면 42%에서 상자 밖 snake.** budget 0~4 강제 휴리스틱도 수천 케이스 전부 올바른 정렬 | §1.3 굵은 경계 조건, 휴리스틱 규칙 |
| A-5 | `file://`로 연 페이지에서 Blob URL Web Worker가 동작하는가 (Chromium) | 동작함. 단 Playwright의 request 이벤트에 `blob:null/...` 요청이 잡힘 | D13, Phase 7 시나리오 1 |
| A-6 | Node 22에서 `node --test test/unit/` | **실패**(`Cannot find module .../unit`). `node --test "test/unit/*.test.mjs"`는 통과 | Phase 0 npm scripts |
| A-7 | 최적화하지 않은 프로토타입의 P3(5만 vs 5만, 알파벳 2) 소요 시간 | budget 256: 0.4s · 1024: 1.4s · 4096: 4.5s. P1 유사 입력은 budget 4096에서 80ms, minimal | §1.3 DEFAULT_BUDGET |


# PROGRESS — 텍스트 Diff 도구

계획서: [diff_plan.md](diff_plan.md). Phase별로 완료 조건을 실제로 실행한 기록을 남긴다.

**개발 머신**: AMD Ryzen 5 7500F (6코어/12스레드), RAM 32GB, Windows 11 Home (10.0.26200)
**도구**: Node 24.15.0 · GNU diffutils 3.12 · GNU patch 2.7.6 (Git for Windows `usr/bin`) · Playwright 1.63.0 + Chromium 1243

## 계획 변경 기록

| 날짜 | 항목 | 변경 | 사유 |
|---|---|---|---|
| 2026-10-02 | §3 저장소 루트 | `diff-tool/` 대신 기존 폴더 `text_diff/`를 루트로 사용 | 계획서가 이미 이 폴더에 있음 |
| 2026-10-02 | §0 규칙 1 (git) | Claude는 git 명령을 실행하지 않고, 사용자가 수동으로 commit | 사용자 요청. (요청 전에 `git init` + Phase 0 commit `bfa1c21` 하나는 이미 만들어짐) |
| 2026-10-02 | §1.3 makeUnifiedPatch 병합·컨텍스트 | ignored 블록도 일반 change 블록처럼 병합 대상(간격 ≤ 2·context), ignored만으로 된 hunk는 생략, 컨텍스트는 항상 `context`줄(파일 경계에서만 잘림) | 아래 "실측 1·2" 참고. 원래 규칙은 GNU patch `-F0`가 거부하는 patch를 만든다 |
| 2026-10-02 | D3 구현 방식 | 키에 `"\u0000<NOEOL>"`를 붙이는 대신 개행 없는 마지막 줄에 별도 ID 부여 | 원래 방식은 내용이 `x\u0000<NOEOL>`인 줄과 개행 없는 `x`가 같은 키가 되어 잘못된 patch가 나올 수 있음. 동작(D3의 의미)은 같음 |
| 2026-10-02 | §1.3 경계 이동 추가 | GNU diff `shift_boundaries` 이식 (블록 구성 직전) | Myers가 반복 줄 구간에서 변경 위치를 임의로 고르는 것을 정리해 읽기 좋은 diff를 만든다. 편집 수 불변이라 최소성 검증에 영향 없음 |
| 2026-10-02 | §1.3 DEFAULT_BUDGET | `max(256, ⌊2×10⁸/(N+M)⌋)` (GNU식 `max(4096, √n)` 대신) | 병적 입력 비용이 (N+M)×budget에 비례(실측) → 최악 시간을 크기와 무관하게 약 1초로 고정. 약 2만 줄 이하는 항상 최소. Phase 4 참고 |
| 2026-10-02 | 줄 내부 diff 구현 | 공통 앞뒤 토큰을 먼저 잘라내는 빠른 경로 추가 | P2(10만 쌍 짝짓기) 비용 절반. 결과 의미(D9·D10)는 같음 |
| 2026-10-02 | §6 입력 처리 (신규 결정) | 파일에서 읽은 원문을 따로 보관하고, textarea 내용이 넣은 직후와 같으면 원문으로 비교. patch는 문자열로 보관해 복사·다운로드에 사용 | textarea의 `value`는 HTML 명세상 `\r\n`·`\r`을 `\n`으로 정규화한다. 그대로 쓰면 D1(CR은 내용의 일부)과 CRLF 파일의 patch가 깨진다. Phase 6 참고 |
| 2026-10-02 | Phase 7 시나리오 7 | CRLF 입력을 `fill` 대신 `setInputFiles`로 넣음 | textarea가 CR을 지우므로 `fill`로는 CRLF 입력을 만들 수 없음 |
| 2026-10-02 | Phase 7 프로젝트 | 데스크톱·모바일 × 라이트·다크 4개. 대용량(12)은 데스크톱 라이트에서만, 모바일(13)은 모바일에서만 (각각 worker/main 둘 다). 색 대비(14)는 반대 테마 강제 상태도 추가 검사 | 계획의 "두 프로젝트 + 라이트/다크"를 프로젝트 4개로 표현 |
| 2026-10-02 | Phase 0 check-env 후보 | `git --exec-path`로 Git for Windows의 `usr/bin`을 찾아 `diff.exe`/`patch.exe`를 후보에 추가 | PowerShell·cmd에서 실행하면 GNU 도구가 PATH에 없어 실패함. 찾은 절대 경로를 `tmp/env.json`에 저장하므로 퍼징도 셸과 무관하게 동작 |

---

## Phase 0 — 환경 준비

- `npm run check-env` (PowerShell에서 실행, PATH에 GNU 도구 없음) → exit 0
  ```
  Node   24.15.0
  diff   C:\Program Files\Git\usr\bin\diff.exe  (diff (GNU diffutils) 3.12)
  patch  C:\Program Files\Git\usr\bin\patch.exe  (GNU patch 2.7.6)
  → tmp/env.json 저장
  ```
- `npm i -D @playwright/test` (1.63.0), `npx playwright install chromium` → `chromium-1243` 설치
- `.gitattributes` = `* -text`, `git config core.autocrlf false`
- 작업 폴더에 NVIDIA 드라이버가 만든 `NVIDIA Corporation/umdlogs`가 생겨서 `.gitignore`에 추가 (삭제하지 않음)

## Phase 1 — 코어 엔진

### 계획 검토 중 실측 (GNU diffutils 3.12, GNU patch 2.7.6)

**실측 1** — 원래 §1.3 규칙대로라면, 유효 변경 뒤에 equal 1줄과 ignored 블록이 오는 경우 뒤 컨텍스트가 1줄로 잘린다:
```
@@ -2,5 +2,5 @@        ← 앞 컨텍스트 3줄, 뒤 1줄, 파일 중간
 2
 3
 4
-X
+Y
 5
```
`patch -s --binary -F0` → **`1 out of 1 hunk FAILED`, exit 1**. 앞 1줄/뒤 1줄로 맞추면 exit 0, 앞이 짧고 뒤가 긴 경우도 exit 0.
GNU patch `locate_hunk`는 뒤 컨텍스트가 앞보다 짧으면 "파일 끝에만 맞는 hunk"로 본다.

**실측 2** — GNU `diff -u -B`는 무시 대상 변경을 hunk에 `+`/`-`로 넣고 컨텍스트를 채우지만, 무시 대상의 병합 문턱이 `context`라서 두 hunk가 같은 줄(6~8)을 공유하며 **겹친다**:
```
@@ -2,7 +2,7 @@ … 6 7 8
@@ -6,8 +6,9 @@   6 7 8 + 9 -10 +ten …
```
→ 채택한 규칙: ignored 블록도 문턱 `2·context`로 병합. hunk 간격이 항상 `2·context+1` 이상이 되어 컨텍스트가 꽉 차고 겹치지 않는다.

### 구현
- `src/core/diff-core.js` — `splitLines`, `diff`, `makeUnifiedPatch`, `applyUnifiedPatch`, `diffTokens`, `VERSION` (+ `defaultBudget`)
- `test/load-core.mjs` — 경로를 받아 `vm` 컨텍스트(전역 객체만, `require`/`process` 없음)에서 로드
- Node `vm` 로드 확인: 기본 케이스(1줄 변경, 끝 개행 차이, 빈↔내용, 양쪽 개행 없음, hunk 병합, 빈 줄 무시) 출력과 `applyUnifiedPatch` 왕복 확인

## Phase 2 — 단위 테스트

- 공용 검사: `test/checks.mjs` (blocks 불변식·stats·ignored 완전성, 줄 내부 속성, patch 형식: 헤더 줄 수/길이 1 생략/컨텍스트가 파일 경계가 아니면 정확히 context줄/hunk 겹침 금지, O(NM) LCS 참조, 정규화 비교)
- `test/case-check.mjs`: 퍼저·회귀 테스트가 공유하는 케이스 검사 (엔진 검사 + GNU patch/diff 대조)
- `scripts/env.mjs`로 GNU 도구 탐지를 분리 (check-env와 회귀 테스트가 공유). GNU 도구가 없으면 회귀 테스트는 건너뛰지 않고 실패
- 파일: `core.test.mjs`(40), `options.test.mjs`(25), `intraline.test.mjs`(19), `reference.test.mjs`(3), `regressions.test.mjs`(1)
  - 참조 대조: 알파벳 1~4·길이 0~30 **12,000케이스** 편집 수 == N+M−2·LCS, 공백/대소문자 무시 3,000케이스(정규화 키 기준 최소), 강제 휴리스틱 budget 1~4·길이 1~300·알파벳 2 **3,000케이스**(그중 minimal=false가 1,000개 이상인지도 확인) — 전부 올바른 정렬 + 정확한 patch
- 작성 중 고친 것 (엔진 버그 아님, 테스트 쪽):
  - vm 컨텍스트에서 만든 배열은 Array 프로토타입이 달라 `deepStrictEqual`이 실패 → `Array.from`/길이 비교로 바꿈
  - hunk 헤더 기대값을 잘못 셈(`-7,9` → 실제 `-7,10`이 맞음: 7~16줄)
  - "세 옵션을 다 켜면 equivalent" 단언 삭제: 빈 줄이 내용 줄 사이에서 짝을 바꾸는 입력은 어떤 LCS가 골라지느냐에 따라 내용 줄이 변경으로 남을 수 있다(GNU `-B`도 같은 성질). 정규화 속성 검사는 그대로 유지
- `npm test` → **88 pass / 0 fail** (1.6s)

## Phase 3 — 퍼징

- `test/prng.mjs`: mulberry32 + `(seed, caseIndex)` 해시로 케이스마다 독립 PRNG
- `test/fuzz/gen.mjs`: 독립 생성(알파벳 {1,2,3,5,26}, 0~40줄) 40% / 변이 생성(삽입·삭제·치환·이동·블록 복제 1~10회) 50% / 극단(빈 파일, 1줄, 모두 같은 줄, 완전히 다름, 개행만 다름) 10%. 줄 풀에 빈 줄·공백·탭·끝 `\r`·한글·이모지·결합 문자·`-`/`+`/` `/`\`/`@@ -1 +1 @@`/`--- x`/`+++ y` 포함. 끝 개행은 양쪽 독립. 30% 옵션 조합, 10% budget 1~4
- `test/fuzz/fuzz.mjs`: 엔진 검사는 동기, GNU patch/diff는 **비동기 동시 12개**로 실행
  - 측정: Windows에서 GNU 도구 1회 실행이 순차 56~89ms → 동시 12개면 실효 9.4ms. 순차였다면 5,000케이스에 약 12분, 동시 실행으로 약 2.5분
  - 실패 시 `test/regressions/<seed>-<idx>.json` 저장 후 exit 1 (작업 폴더는 조사용으로 남김)
- **완료 조건 실행**: `npm run fuzz -- --cases 5000 --random-seeds 3` → exit 0
  ```
  seed 20261002:   5000케이스 · 옵션 1466 · 강제 휴리스틱 515 (minimal=false 240) · GNU patch 적용 4888 · GNU 최소성 대조 3356 · 141.1s
  seed 1074375106: 5000케이스 · 옵션 1522 · 강제 휴리스틱 499 (minimal=false 231) · GNU patch 적용 4890 · GNU 최소성 대조 3327 · 153.1s
  seed 1961802310: 5000케이스 · 옵션 1544 · 강제 휴리스틱 499 (minimal=false 250) · GNU patch 적용 4898 · GNU 최소성 대조 3285 · 162.8s
  seed 1075669273: 5000케이스 · 옵션 1495 · 강제 휴리스틱 483 (minimal=false 232) · GNU patch 적용 4878 · GNU 최소성 대조 3353 · 175.5s
  퍼징 통과: 총 20000케이스
  ```
  실패 0건 → `test/regressions/`는 비어 있음 (회귀 테스트는 "회귀 케이스 없음"으로 통과)
- 이후 Phase 4에서 코어가 바뀌었으므로(토큰 diff 빠른 경로, 기본 budget) 최종 코어로 Phase 8에서 다시 전체 퍼징한다

## Phase 4 — 성능

**측정 조건**: 위 개발 머신, Node 24.15.0, `node test/perf/perf.mjs`, 각 5회 중앙값. 다른 부하 없음.

| 시나리오 | 목표 | 결과 | 비고 |
|---|---|---|---|
| P1 유사 대용량 10만 줄 | < 500ms, minimal | **44.5ms**, minimal=true | +1531 −1485, 1989곳, budget 999 |
| P2 완전 상이 10만 줄 | < 1s | **332ms** | |
| P3 병적 입력 5만×5만 (0/1) | < 3s | **1059ms**, minimal=false | 편집 18952, budget 2000 |
| P4 긴 줄 1000×5000자 | < 1s | **20.8ms** | 80곳, 줄 내부 짝 85 |
| P5 patch 생성 (P1) | < 200ms | **1.6ms** | 589KB |

모든 시나리오에서 `applyUnifiedPatch`로 patch 정확성도 확인.

### 개선 1 — 줄 내부 토큰 diff 빠른 경로
첫 측정에서 P2가 692ms(퍼징이 돌던 중이라 부하 상태)였다. 원인: 공통 줄이 없어도 10만 쌍을 위치 기준으로 짝지어 토큰 diff를 10만 번 실행. 공통 앞뒤 토큰을 먼저 잘라내고, 가운데가 한쪽이라도 비면 Myers를 건너뛰도록 함 → 같은 조건에서 P2가 약 절반으로 줄었다(최종 332ms, 무부하).

### 개선 2 — 기본 budget (DEFAULT_BUDGET) 선택
budget 스윕 (`node test/perf/perf.mjs --sweep`, 3회 중앙값):

| budget | P1 | P1 minimal | P3 | P3 편집 수 |
|---|---|---|---|---|
| 128 | 39ms | **false** | 77ms | 19650 |
| 256 | 43ms | true | 153ms | 19230 |
| 512 | 36ms | true | 286ms | 19196 |
| 1024 | 35ms | true | 557ms | 19000 |
| 2048 | 34ms | true | 1059ms | 18936 |
| 4096 | 34ms | true | 1946ms | 18892 |
| 8192 | 33ms | true | 3138ms | 18876 |

- P3 시간이 budget에 정비례: 최악 비용 ≈ 4.7ns × (N+M) × budget. 편집 수 차이는 1024와 8192 사이에서 0.7%뿐
- GNU식 `max(4096, √n)`이면 P3 1.95초로 목표의 65% — 느린 기기에선 넘을 수 있음
- **채택**: `budget = max(256, ⌊2×10⁸ / (N+M)⌋)` → 최악 시간을 입력 크기와 무관하게 약 1초로 묶는다. 검증:
  ```
  0/1   5000 × 5000:    43 ms  budget 20000  minimal=true
  0/1  10000 × 10000:   148 ms  budget 10000  minimal=true
  0/1  20000 × 20000:   588 ms  budget 5000  minimal=true
  0/1  50000 × 50000:  1054 ms  budget 2000  minimal=false
  0/1 100000 × 100000:  1135 ms  budget 1000  minimal=false
  0/1 200000 × 200000:  1167 ms  budget 500  minimal=false
  ```
  약 2만 줄까지는 병적 입력도 최소 diff, 그 이상은 약 1.1초에서 평평. P1(minimal에 256 이상 필요)은 하한 256 덕분에 아주 큰 입력에서도 유지
- 변경 후 `npm test` 88/88 통과

## Phase 5 — 빌드

- `src/ui/index.html`(자리표시자 3개) + 최소 `styles.css` + smoke용 `app.js`로 먼저 빌드 파이프라인 구성
- `scripts/build.mjs` 자동 검사: JS에 `</script`·`<!--`·CR 문자 금지(CR은 HTML 파서가 LF로 바꿔 Worker 코어가 원본과 달라지므로 추가), CSS에 `</style` 금지, 외부 리소스 참조 금지, `<script id="diff-core">` SHA-256 == 소스. 치환은 함수형 `replace`로 해서 소스의 `$&` 등이 해석되지 않게 함
- `npm run build`:
  ```
  dist/diff.html  81.8 KB (83759 bytes)
  코어 SHA-256    5929fe648be762c4e2b8cfd9a8f4c16b5f297d29c209789570bff1753fb865cb (src와 일치)
  외부 리소스 참조 0개
  ```
- 배포본 재검증: `npm run fuzz -- --core tmp/dist-core.js --cases 1000` → 1000케이스 통과 (28.1s)
- smoke e2e (`file://`, worker / `?worker=0` 둘 다): 2 passed, 콘솔 에러 0 (최소 앱 단계에서 확인. Phase 6에서 실제 UI 흐름으로 교체)

## Phase 6 — UI

### 구현 요점
- 상단 바: 비교 / ← 입력 / 나란히·통합 / 공백·대소문자·빈 줄 무시 / 컨텍스트(0·3·5·10·전체) / ▲ n/N ▼ / patch / 테마(시스템·라이트·다크) / ?
- 입력: 좌우 패널(이름, 줄 수·CRLF·BOM·끝 개행 없음 배지, 파일 열기·지우기), ⇄ 바꾸기, 패널별·페이지 전체 드래그 앤 드롭(2개면 좌·우), Ctrl/⌘+Enter
- 결과: 요약(`+N −M · 변경 K곳`, minimal=false 배지, 무시된 변경 수, 같음/차이 없음), 나란히(그리드 행: 줄번호|내용|줄번호|내용) / 통합, `−`/`+` 기호, 줄 내부 강조, ignored 블록 흐리게 + "무시됨", `⏎ 없음`, 변경 행의 `\r`은 `␍`로 표시
- **접기**: 줄이 아니라 "조용한 구간"(유효 변경 사이의 equal + ignored 블록 — D6) 단위. 구간 키 = 첫 블록 인덱스라 보기·컨텍스트를 바꿔도 펼친 상태 유지. 접힌 행은 단독 렌더링 단위라, 펼칠 때 그 자리만 500행 청크로 교체(전체 다시 그리기·스크롤 이동 없음)
- **렌더링**: 행 모델 → 500행 청크(`content-visibility: auto` + `contain-intrinsic-size: auto <행수×20>px`) → 12ms씩 나눠 `setTimeout`으로 이어 그림. 아직 안 그린 블록으로 이동하면 그 블록까지 즉시 그림. DOM은 `textContent`/텍스트 노드로만 생성
- **계산**: 인라인 코어 `textContent` + 메시지 핸들러로 Blob Worker 생성(재사용), 계산 중 새 요청이면 `terminate()` 후 새로 생성, 응답의 requestId가 최신이 아니면 버림, Worker 생성 실패·`error` 이벤트·`?worker=0`이면 메인 스레드(rAF → setTimeout 0으로 한 프레임 양보). Worker는 `oldLines/newLines`를 빼고 보내고 메인이 다시 자름(구조 복제 비용 절감)
- 옵션 변경 → 결과 화면이면 자동 재계산. 보기·컨텍스트·접기는 다시 그리기만
- patch 창: `<dialog>`, D12 안내, 빈 patch면 "내보낼 차이가 없습니다", 복사(clipboard API → `copy` 이벤트로 원문 주입 + execCommand → "직접 선택해서 복사하세요"), 다운로드(`<왼쪽이름>.diff` / `changes.diff`)
- 50MB 초과 파일은 페이지 안 확인 상자, 바이너리(앞 8KB NUL) 거부, `TextDecoder('utf-8', { ignoreBOM: true })`로 BOM 유지
- 테스트용 표식: `body[data-engine]`, `body[data-state=busy|ready|error]`, `#diff[data-rendered]`, `#summary-text[data-added|removed|changes]`, 행의 `data-old-line`/`data-new-line`/`data-blk`

### 작성 중 발견해 고친 문제
- **textarea의 CR 정규화**: `textarea.value`는 `\r\n`·`\r`을 `\n`으로 바꾼다(HTML 명세). 처음 구현은 (1) CRLF 파일을 열면 CR이 사라져 CRLF 배지·CRLF↔LF 비교가 틀리고 (2) patch 다운로드·복사가 textarea 값을 써서 `\r`이 빠졌다. → 파일 원문 보관 + patch 문자열 보관으로 수정, e2e 9번에 "CRLF 파일 patch 다운로드에 `\r` 보존 + GNU 형식 적용 결과가 B" 검사를 넣어 고정
- 현재 블록 강조를 `box-shadow: inset`으로 했더니 셀 배경에 가려짐 → `::after` 테두리로 변경
- 통합 보기 머리글이 2열이라 "+ 변경본"이 가운데 떠 보임 → 한 줄로
- `app.js` 수정 중 주석에 CR 문자가 섞여 들어감 → 빌드 검사가 잡아 실패 처리(의도대로 동작). 제거 후 재빌드

### 완료 조건
- `npm run build` 성공 (83.7KB, 코어 해시 일치, 외부 참조 0)
- smoke e2e를 실제 비교 흐름으로 갱신(`fillAndCompare` 후 요약 숫자 == 코어, `data-engine`, 콘솔 에러 0) — worker/main × 4개 프로젝트 통과
- 데스크톱·모바일 스크린샷 확인 (아래 Phase 7 육안 검토에 포함)

## Phase 7 — 브라우저 E2E

- `playwright.config.mjs`: `desktop-light`/`desktop-dark`(1280×800), `mobile-light`/`mobile-dark`(390×844, isMobile, DPR 2)
- `test/e2e/app.spec.mjs` 시나리오 1~11, 14 / `large.spec.mjs` 12 / `mobile.spec.mjs` 13 / `smoke.spec.mjs` / `screens.spec.mjs` — 모두 worker와 `?worker=0` 둘 다
  - 1: 콘솔 에러 0, 요청은 페이지 자신 + `blob:`/`data:`만
  - 4: 컨텍스트 "전체"에서 행 수 = Σequal + Σmax(삭제,추가)(나란히) / Σequal + Σ(삭제+추가)(통합), `data-old-line`이 1..N, `data-new-line`이 1..M 순서
  - 5: 접힌 행 4개 → 하나 펼치면 3개 + 숨겨졌던 60번째 줄 등장 → 모두 펼치기(접힌 행 0, 1..300 전부) → 모두 접기
  - 6: n/j/p/k + ▼ 버튼, 카운터, 현재 블록 `toBeInViewport`, select에 포커스가 있으면 이동 안 함
  - 7: CRLF/LF 파일 → +3 −3 → 공백 무시 체크 → 자동 재계산 → "차이 없음(무시 옵션 기준)"
  - 8·9: patch 창 == Node `makeUnifiedPatch`(컨텍스트 3, 0), 다운로드 파일 == patch, CRLF 파일 patch의 `\r` 보존 + `x.txt.diff` 파일명
  - 10: 파일명·BOM·끝 개행 없음·줄 수 배지, 바이너리 거부 메시지, 거부 후 기존 내용 유지
  - 11: `<img onerror>`·`<script>`·`<b onclick>` 내용과 파일명 → 다이얼로그 0회, `#diff`에 img/script/b 요소 0개, 텍스트로 표시
  - 12: P1(10만 줄) 파일 입력 → 요약까지 **worker 1612ms / main 1550ms** (목표 10초), 끝까지 스크롤하면 마지막 변경 블록이 뷰포트 안
  - 13: 입력·통합·나란히·patch 창 모두 `scrollWidth <= innerWidth`, 기본 보기 통합
  - 14: 추가·삭제 줄 내용과 기호(`::before`), 줄번호 칸, 줄 내부 강조의 글자색/합성 배경 대비 ≥ 4.5 — 시스템 테마와 반대 테마 강제 둘 다
- `npm run e2e` → **106 passed** (25.8s)

### 스크린샷 육안 검토 (`test-results/screens/`, 16장)
| 화면 | 데스크톱 라이트 | 데스크톱 다크 | 모바일 라이트 | 모바일 다크 |
|---|---|---|---|---|
| 입력 | 정상: 좌우 패널, 배지(70줄·끝 개행 없음), ⇄ | 정상 | 정상: 패널 세로 쌓임, ⇄가 세로 방향으로 회전, 바 3줄로 줄바꿈 | 정상 |
| 나란히 | 정상: 줄 내부 강조, 무시됨 행 흐림, 접힌 행, 현재 블록 테두리, `⏎ 없음` | 정상: 대비 충분 | (사용자가 명시 선택 시) 긴 줄 줄바꿈, 가로 스크롤 없음 | 정상 |
| 통합 | 정상: 머리글 한 줄 | 정상 | 기본 보기로 표시, 정렬 맞음 | 정상 |
| patch | 정상: D12 안내(빈 줄 무시 켬), 무시된 빈 줄이 hunk 안 `-`로 | 정상 | 대화상자가 화면 폭에 맞음 | 정상 |

겹침·잘림·정렬 어긋남 없음. 발견해 고친 항목: 통합 머리글 2열 → 1열 (위 Phase 6).

## Phase 8 — 마무리

- `README.md`: 사용법, 단축키 표, 옵션 의미(D4~D6, D12 + hunk 안 ignored 블록), 동작 규칙, 알려진 한계(D8 휴리스틱, UTF-8 고정, 바이너리 미지원, textarea CR), 개발·검증 명령
- 페이지 안 도움말(`?`)을 README와 같은 내용으로 맞춤
- `package.json` version 1.0.0 (코어 `VERSION`과 일치), `test/regressions/.gitkeep`
- **`npm run all`** (check-env → test → fuzz → perf → build → e2e, 처음부터 끝까지 한 번에) → **exit 0**
  ```
  npm test                 88 pass / 0 fail
  npm run fuzz             seed 20261002:   5000케이스 · 옵션 1466 · 강제 휴리스틱 515 · GNU patch 4888 · GNU 최소성 3356 · 152.8s
                           seed 1081478289: 5000케이스 · 옵션 1440 · 강제 휴리스틱 493 · GNU patch 4886 · GNU 최소성 3391 · 157.2s
  npm run perf             P1 64.1ms (minimal) · P5 3.4ms · P2 385.0ms · P3 1064.1ms · P4 21.8ms — 전부 충족
  npm run build            dist/diff.html 84.7KB · 코어 SHA-256 5929fe64…65cb (src와 일치) · 외부 참조 0
  npm run e2e              106 passed (대용량: main 619ms / worker 1803ms 만에 요약 표시)
  ```
- **최종 코어로 전체 퍼징** `npm run fuzz -- --cases 5000 --random-seeds 3` → exit 0
  ```
  seed 20261002:   5000케이스 · 옵션 1466 · 강제 휴리스틱 515 (minimal=false 240) · GNU patch 적용 4888 · GNU 최소성 대조 3356 · 150.1s
  seed 163299803:  5000케이스 · 옵션 1491 · 강제 휴리스틱 495 (minimal=false 241) · GNU patch 적용 4898 · GNU 최소성 대조 3343 · 155.8s
  seed 816102226:  5000케이스 · 옵션 1544 · 강제 휴리스틱 526 (minimal=false 259) · GNU patch 적용 4878 · GNU 최소성 대조 3271 · 163.7s
  seed 1454245325: 5000케이스 · 옵션 1544 · 강제 휴리스틱 494 (minimal=false 221) · GNU patch 적용 4875 · GNU 최소성 대조 3291 · 177.3s
  퍼징 통과: 총 20000케이스
  ```
- git commit·태그 `v1.0.0`은 사용자가 수동으로 진행 (규칙 1 변경)

### 최종 요약

| 완료 조건 | 결과 |
|---|---|
| 단위 테스트 | 88/88 통과 (LCS 참조 대조 12,000 + 옵션 3,000 + 휴리스틱 3,000 케이스 포함) |
| 퍼징 5,000 × seed 4개 이상 | 최종 코어(SHA-256 `5929fe64…65cb`) 기준 **총 31,000케이스 통과**: seed 20261002·163299803·816102226·1454245325 (각 5,000) + `npm run all`의 20261002·1081478289 (각 5,000) + 배포본 코어 1,000. 이전 코어 기준 20,000케이스(seed 20261002·1074375106·1961802310·1075669273)도 통과. 실패 0건, `test/regressions/` 비어 있음 |
| 배포본 코어 퍼징 + 해시 일치 | `tmp/dist-core.js` 1,000케이스 통과, SHA-256 일치 |
| 성능 P1~P5 | P1 44~64ms(minimal) · P2 332~385ms · P3 1.06s · P4 21ms · P5 1.6~3.4ms — 전부 목표 충족 |
| E2E (worker/main) | 106 passed, 스크린샷 16장 육안 검토 완료 |
| 오프라인 단일 파일 | `dist/diff.html` 84.7KB, 외부 참조 0, `file://`에서 Worker 포함 동작 (e2e 1번: 페이지 외 요청 0) |

**알려진 한계**: 약 2만 줄을 넘고 서로 많이 다른 입력은 휴리스틱으로 최소 diff가 아닐 수 있음(배지 표시, 결과는 정확) · UTF-8 고정 · 바이너리 미지원 · 붙여넣은 텍스트의 CR은 브라우저가 지움(파일로 열면 보존) · 빈 줄 무시에서 equivalent 여부는 LCS 선택에 따라 달라질 수 있음(GNU `-B`와 같은 성질)

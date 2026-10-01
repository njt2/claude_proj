# PROGRESS — 텍스트 Diff 도구

계획서: [diff_plan.md](diff_plan.md). Phase별로 완료 조건을 실제로 실행한 기록을 남긴다.

**개발 머신**: AMD Ryzen 5 7500F (6코어/12스레드), RAM 32GB, Windows 11 Home (10.0.26200)
**도구**: Node 24.15.0 · GNU diffutils 3.12 · GNU patch 2.7.6 (Git for Windows `usr/bin`) · Playwright 1.63.0 + Chromium 1243

## 계획 변경 기록

| 날짜 | 항목 | 변경 | 사유 |
|---|---|---|---|
| 2026-10-02 | §3 저장소 루트 | `diff-tool/` 대신 기존 폴더 `text_diff/`를 루트로 사용 | 계획서가 이미 이 폴더에 있음 |
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

## Phase 2 — 단위 테스트

## Phase 3 — 퍼징

## Phase 4 — 성능

## Phase 5 — 빌드

## Phase 6 — UI

## Phase 7 — 브라우저 E2E

## Phase 8 — 마무리

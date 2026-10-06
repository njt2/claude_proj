import { defineConfig } from '@playwright/test';

// 이미 설치된 Chromium을 써야 하는 환경이면 PLAYWRIGHT_CHROMIUM_EXECUTABLE로 경로를 넘긴다
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

const desktop = { viewport: { width: 1280, height: 800 } };
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  outputDir: 'test-results/artifacts',
  use: {
    headless: true,
    launchOptions: { executablePath },
    acceptDownloads: true,
  },
  projects: [
    // 대용량 시나리오는 데스크톱 라이트에서만 (worker/main 둘 다), 모바일 전용 시나리오는 모바일에서만
    { name: 'desktop-light', use: { ...desktop, colorScheme: 'light' }, testIgnore: /mobile\.spec/ },
    { name: 'desktop-dark', use: { ...desktop, colorScheme: 'dark' }, testIgnore: [/mobile\.spec/, /large\.spec/] },
    { name: 'mobile-light', use: { ...mobile, colorScheme: 'light' }, testIgnore: /large\.spec/ },
    { name: 'mobile-dark', use: { ...mobile, colorScheme: 'dark' }, testIgnore: /large\.spec/ },
  ],
});

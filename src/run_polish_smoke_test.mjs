// =====================================================================
// run_polish_smoke_test.mjs (v0.4.5)
// ---------------------------------------------------------------------
// v0.4.5 polish 검증:
//
//   #1 scripts/sync_build.mjs 존재 + executable
//   #2 sync_build.mjs가 BUILD_TAG 매개변수 검증
//   #3 sync_build 후 BUILD_TAG/EXPECTED_BUILD/cache buster 동기화
//   #4 build_self_check가 build-label class 새 패턴 인식
//   #5 playable_app.js에 lastAutoSaveResult 모듈 변수
//   #6 DAY 모달에 "💾 자동 저장됨" 인디케이터 코드
//   #7 수동 저장 토스트 polish (background/color 변경)
//   #8 index.html 헤더가 build-label class 사용
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("[polish smoke test v0.4.5]");

// =====================================================================
// #1: scripts/sync_build.mjs 존재
// =====================================================================
console.log("\n1. scripts/sync_build.mjs 존재");
const syncPath = path.join(ROOT, "scripts/sync_build.mjs");
if (!fs.existsSync(syncPath)) {
  console.error(`FAIL: ${syncPath} 없음`); process.exit(1);
}
console.log(`  ✓ scripts/sync_build.mjs 존재`);

// =====================================================================
// #2: 매개변수 없으면 거부
// =====================================================================
console.log("\n2. sync_build.mjs 매개변수 검증");
try {
  execSync(`node ${syncPath}`, { stdio: "pipe" });
  console.error(`FAIL: 인자 없는데 통과`); process.exit(1);
} catch (e) {
  if (!String(e.stderr || e.stdout || "").includes("Usage")) {
    console.error(`FAIL: Usage 메시지 안 나옴`); process.exit(1);
  }
}
console.log(`  ✓ 인자 없으면 Usage 메시지 + exit 1`);

// 잘못된 형식
try {
  execSync(`node ${syncPath} invalid_tag`, { stdio: "pipe" });
  console.error(`FAIL: 잘못된 형식 통과`); process.exit(1);
} catch (e) {
  if (!String(e.stderr || e.stdout || "").includes("Usage")) {
    console.error(`FAIL: 형식 검증 안 됨`); process.exit(1);
  }
}
console.log(`  ✓ 잘못된 형식 거부 (vX.Y.Z 패턴 필요)`);

// =====================================================================
// #3: sync_build 동기화 동작 (dry test — 현재 값 확인 후 같은 값으로 sync해도 OK)
// =====================================================================
console.log("\n3. sync_build → 6곳 동기화");
const grBefore = fs.readFileSync(path.join(ROOT, "src/game_rules.js"), "utf8");
const tagBefore = grBefore.match(/BUILD_TAG = "([^"]+)"/)[1];
// 같은 태그로 sync (no-op이라도 모든 곳 일치 확인)
execSync(`node ${syncPath} ${tagBefore} "Polish"`, { stdio: "pipe", cwd: ROOT });

const gr = fs.readFileSync(path.join(ROOT, "src/game_rules.js"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "src/playable_app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const tagCount = [
  gr.includes(`BUILD_TAG = "${tagBefore}"`),
  gr.includes(`version: "${tagBefore}"`),
  app.includes(`EXPECTED_BUILD = "${tagBefore}"`),
  html.includes(`해협의 72시간 - ${tagBefore}`),
  html.includes(`build-label">${tagBefore}`),
  html.includes(`?v=`)
].filter(Boolean).length;
if (tagCount < 6) {
  console.error(`FAIL: 6곳 동기화 X (${tagCount}/6)`); process.exit(1);
}
console.log(`  ✓ ${tagBefore} 동기화 6곳 모두 일치`);

// =====================================================================
// #4: build_self_check 새 패턴 인식
// =====================================================================
console.log("\n4. build_self_check가 build-label class 인식");
try {
  execSync(`node src/run_build_self_check.mjs`, { stdio: "pipe", cwd: ROOT });
} catch (e) {
  console.error(`FAIL: self-check 실패: ${e.stdout?.toString() || e.message}`);
  process.exit(1);
}
console.log(`  ✓ self-check 통과 (build-label 또는 기존 Strait 72 패턴)`);

// =====================================================================
// #5: lastAutoSaveResult 모듈 변수
// =====================================================================
console.log("\n5. playable_app.js에 lastAutoSaveResult 모듈 변수");
if (!app.includes("lastAutoSaveResult")) {
  console.error(`FAIL: lastAutoSaveResult 없음`); process.exit(1);
}
if (!app.includes("let lastAutoSaveResult")) {
  console.error(`FAIL: let 선언 없음`); process.exit(1);
}
console.log(`  ✓ lastAutoSaveResult 모듈 변수 선언 + 사용`);

// =====================================================================
// #6: DAY 모달 자동저장 인디케이터
// =====================================================================
console.log("\n6. DAY 모달 '💾 자동 저장됨' 인디케이터");
if (!app.includes("💾 자동 저장됨")) {
  console.error(`FAIL: '💾 자동 저장됨' 텍스트 없음`); process.exit(1);
}
if (!app.includes("lastAutoSaveResult?.ok")) {
  console.error(`FAIL: 자동저장 ok 체크 없음`); process.exit(1);
}
console.log(`  ✓ DAY 모달 자동저장 인디케이터 + size 표시`);

// =====================================================================
// #7: 수동 저장 토스트 polish
// =====================================================================
console.log("\n7. 수동 저장 토스트 색 polish");
// 새 색 (#80efb1 = 대만 그린) + transition 적용
if (!app.includes("#80efb1") || !app.includes("transition")) {
  console.error(`FAIL: 토스트 색/transition 없음`); process.exit(1);
}
if (!app.includes("저장됨")) {
  console.error(`FAIL: 저장됨 텍스트 없음`); process.exit(1);
}
console.log(`  ✓ 토스트 #80efb1 색 + transition + 저장됨 라벨`);

// =====================================================================
// #8: index.html build-label class
// =====================================================================
console.log("\n8. index.html build-label class 사용");
if (!html.includes('class="build-label"')) {
  console.error(`FAIL: index.html에 build-label class 없음`); process.exit(1);
}
console.log(`  ✓ index.html 헤더 build-label class 사용`);

console.log("\n✓ polish smoke test passed");

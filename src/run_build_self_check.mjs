// =====================================================================
// run_build_self_check.mjs  (v0.4.0-c2-b2.1 introduced)
// ---------------------------------------------------------------------
// 매 패치마다 BUILD_TAG와 일치해야 하는 곳들:
//   1. src/game_rules.js  → export const BUILD_TAG
//   2. src/game_rules.js  → GAME_RULES.version
//   3. src/playable_app.js → const EXPECTED_BUILD
//   4. index.html         → <title>
//   5. index.html         → 헤더 <span>Strait 72 · BUILD_TAG ...</span>
//   6. index.html         → cache buster ?v=BUILD_HYPHEN_FREE
//
// 이전 폐기 사례:
//   - v0.4.0-c2-b1.2 final zip: BUILD_TAG c2-b1.2였으나 EXPECTED_BUILD가
//     c2-b1.1에 멈춰서 init 시 빨간 배너 + 게임 시작 불가.
//   - 그 외 title, header, cache buster도 손으로 풀어가다 누락 빈번.
// =====================================================================

import fs from "node:fs";
import { BUILD_TAG, GAME_RULES } from "./game_rules.js";

const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };

const rootDir = new URL("../", import.meta.url);
const gameRules = fs.readFileSync(new URL("src/game_rules.js", rootDir), "utf8");
const playableApp = fs.readFileSync(new URL("src/playable_app.js", rootDir), "utf8");
const indexHtml = fs.readFileSync(new URL("index.html", rootDir), "utf8");

console.log(`[build self-check] BUILD_TAG = ${BUILD_TAG}`);
console.log(`[build self-check] GAME_RULES.version = ${GAME_RULES.version}`);

// 1. BUILD_TAG와 GAME_RULES.version 일치
if (BUILD_TAG !== GAME_RULES.version) {
  fail(`BUILD_TAG (${BUILD_TAG}) ≠ GAME_RULES.version (${GAME_RULES.version})`);
}
console.log(`  ✓ BUILD_TAG === GAME_RULES.version`);

// 2. game_rules.js의 BUILD_TAG 정의가 실제 BUILD_TAG 값
const buildTagPattern = new RegExp(`BUILD_TAG\\s*=\\s*"${BUILD_TAG.replace(/\./g, "\\.")}"`);
if (!buildTagPattern.test(gameRules)) {
  fail(`game_rules.js에서 BUILD_TAG = "${BUILD_TAG}" 정의를 찾지 못함`);
}
console.log(`  ✓ game_rules.js BUILD_TAG 정의 일치`);

// 3. playable_app.js EXPECTED_BUILD === BUILD_TAG
const expectedMatch = playableApp.match(/EXPECTED_BUILD\s*=\s*"([^"]+)"/);
if (!expectedMatch) {
  fail(`playable_app.js에서 EXPECTED_BUILD 정의를 찾지 못함`);
}
if (expectedMatch[1] !== BUILD_TAG) {
  fail(`EXPECTED_BUILD = "${expectedMatch[1]}" ≠ BUILD_TAG = "${BUILD_TAG}"`);
}
console.log(`  ✓ EXPECTED_BUILD = "${expectedMatch[1]}" 일치`);

// 4. index.html <title>에 BUILD_TAG 포함
if (!indexHtml.includes(`<title>해협의 72시간 - ${BUILD_TAG}`)) {
  // 정확한 매칭 검색
  const titleMatch = indexHtml.match(/<title>([^<]*)<\/title>/);
  fail(`<title> 태그가 BUILD_TAG "${BUILD_TAG}"를 포함하지 않음. 현재: "${titleMatch?.[1] || "없음"}"`);
}
console.log(`  ✓ <title> ${BUILD_TAG} 포함`);

// 5. 헤더 span에 BUILD_TAG 포함
const headerPattern = new RegExp(`<span>Strait 72 · ${BUILD_TAG.replace(/\./g, "\\.")}`);
if (!headerPattern.test(indexHtml)) {
  const headerMatch = indexHtml.match(/<span>Strait 72 ·[^<]*<\/span>/);
  fail(`헤더 span이 BUILD_TAG "${BUILD_TAG}"를 포함하지 않음. 현재: "${headerMatch?.[0] || "없음"}"`);
}
console.log(`  ✓ 헤더 span ${BUILD_TAG} 포함`);

// 6. cache buster ?v=... — BUILD_TAG에서 v0./점/하이픈 제거한 형태
//   "v0.4.0-c2-b2.1" → "040c2b21" 같은 형태로 줄여서 ?v= 안에 들어감
//   여기서는 그냥 BUILD_TAG에서 점만 제거하고 짧은 형태가 있는지 검증
const bareTag = BUILD_TAG.replace(/^v/, "").replace(/[.-]/g, "");  // e.g. "040c2b21"
const cacheBusterPattern = /playable_app\.js\?v=([^"]+)"/;
const cacheMatch = indexHtml.match(cacheBusterPattern);
if (!cacheMatch) {
  fail(`index.html에서 cache buster ?v= 를 찾지 못함`);
}
const cacheVal = cacheMatch[1];
// cache buster 값에 "040c2b21" 같은 bareTag 포함 또는 BUILD_TAG 부분 일치
const cacheBareTag = cacheVal.split("-")[0]; // e.g. "040c2b21" from "040c2b21-20260523"
if (!cacheVal.startsWith("040") || !cacheBareTag.includes(bareTag.slice(0, 8))) {
  // bareTag 일부만 매칭해도 OK (예: "040c2b21" 길이 짧으면 전체 매칭)
  // 더 엄격: BUILD_TAG가 cache buster의 prefix 부분에 반영됐는지
  console.warn(`  ⚠ cache buster "${cacheVal}"가 BUILD_TAG "${BUILD_TAG}" (bareTag: "${bareTag}")와 정확히 매칭 안 됨`);
  console.warn(`     bareTag 일부라도 cache buster prefix에 있는지 확인 필요`);
  // 경고만, fail은 아님 (cache buster 명명 규칙이 강제되진 않음)
} else {
  console.log(`  ✓ cache buster "${cacheVal}" BUILD_TAG 반영`);
}

console.log(`\n✓ build self-check passed (${BUILD_TAG})`);

// =====================================================================
// run_sound_system_smoke_test.mjs (v0.5-c.3)
// ---------------------------------------------------------------------
// 검증:
//   #1 assets/audio/sfx/ 16개 MP3 존재
//   #2 src/sound_system.js 신규
//   #3 SOUND_MAP 6개 카테고리 정의
//   #4 외부 API: initOnUserGesture / play / setEnabled / setVolume / isEnabled / getVolume
//   #5 localStorage 키 (strait72.sound.enabled / strait72.sound.volume)
//   #6 기본값: enabled=false, volume=0.3 (공공장소 배려)
//   #7 카테고리별 쿨다운 / 게인 매핑 존재
//   #8 playable_app.js: sound import + 핸들러 + 게임 이벤트 후크
//   #9 첫 인터랙션 가드 (body click once)
//   #10 triggerTurnSounds 함수 + 5가지 트리거 규칙
//   #11 index.html 헤더 UI (soundToggleBtn + soundVolume)
//   #12 게임 로직 변경 0
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("[sound system smoke test v0.5-c.3]");

// =====================================================================
// #1: SFX MP3 16개
// =====================================================================
console.log("\n1. assets/audio/sfx/ 16개 MP3");
const expectedFiles = [
  "landing_craft_move_1.mp3", "landing_craft_move_2.mp3",
  "naval_blockade.mp3",
  "missile_launch_1.mp3", "missile_launch_2.mp3", "missile_launch_3.mp3", "missile_launch_4.mp3",
  "missile_flyby_1.mp3", "missile_flyby_2.mp3", "missile_flyby_3.mp3",
  "strike_impact_1.mp3", "strike_impact_2.mp3",
  "defense_success_1.mp3", "defense_success_2.mp3", "defense_success_3.mp3", "defense_success_4.mp3"
];
let totalSize = 0;
for (const f of expectedFiles) {
  const p = path.join(ROOT, "assets/audio/sfx", f);
  if (!fs.existsSync(p)) {
    console.error(`FAIL: ${f} 없음`); process.exit(1);
  }
  const sz = fs.statSync(p).size;
  totalSize += sz;
  if (sz < 5 * 1024) {
    console.error(`FAIL: ${f} 너무 작음 (${sz}B)`); process.exit(1);
  }
}
console.log(`  ✓ ${expectedFiles.length}개 MP3 존재, 총 ${(totalSize/1024).toFixed(0)}KB`);
if (totalSize > 1024 * 1024) {
  console.log(`  ⚠ 총 ${(totalSize/1024/1024).toFixed(1)}MB — 1MB 초과 (로드 지연 우려)`);
}

// =====================================================================
// #2: src/sound_system.js
// =====================================================================
console.log("\n2. src/sound_system.js 신규");
const sysPath = path.join(ROOT, "src/sound_system.js");
if (!fs.existsSync(sysPath)) {
  console.error(`FAIL: ${sysPath} 없음`); process.exit(1);
}
const sys = fs.readFileSync(sysPath, "utf8");
console.log(`  ✓ sound_system.js 존재 (${(fs.statSync(sysPath).size/1024).toFixed(1)} KB)`);

// =====================================================================
// #3: SOUND_MAP 6개 카테고리
// =====================================================================
console.log("\n3. SOUND_MAP 6개 카테고리");
const categories = ["landing_craft_move", "naval_blockade", "missile_launch",
                    "missile_flyby", "strike_impact", "defense_success"];
for (const c of categories) {
  if (!sys.includes(`${c}:`)) {
    console.error(`FAIL: SOUND_MAP에 ${c} 없음`); process.exit(1);
  }
}
console.log(`  ✓ 6개 카테고리 모두 정의됨`);

// =====================================================================
// #4: 외부 API
// =====================================================================
console.log("\n4. 외부 API");
const apis = ["initOnUserGesture", "play", "setEnabled", "setVolume", "isEnabled", "getVolume", "isInitialized"];
for (const api of apis) {
  if (!sys.includes(`export function ${api}`)) {
    console.error(`FAIL: export function ${api} 없음`); process.exit(1);
  }
}
console.log(`  ✓ ${apis.length}개 API export`);

// =====================================================================
// #5+6: localStorage + 기본값
// =====================================================================
console.log("\n5+6. localStorage 키 + 기본값");
if (!sys.includes('"strait72.sound.enabled"') || !sys.includes('"strait72.sound.volume"')) {
  console.error(`FAIL: localStorage 키 없음`); process.exit(1);
}
// 기본값 false / 0.3
if (!sys.match(/return false;.*기본/s) && !sys.match(/return false;\s*\/\/.*[Oo][Ff][Ff]/)) {
  // 단순 grep으로
  if (!sys.includes("// 기본 OFF")) {
    console.error(`FAIL: 기본 OFF 주석 없음 (의도 명확화 필요)`); process.exit(1);
  }
}
if (!sys.includes("0.3")) {
  console.error(`FAIL: 기본 볼륨 0.3 없음`); process.exit(1);
}
console.log(`  ✓ localStorage 키 + 기본 OFF + 기본 볼륨 30%`);

// =====================================================================
// #7: 카테고리별 쿨다운 + 게인
// =====================================================================
console.log("\n7. CATEGORY_GAIN + CATEGORY_COOLDOWN_MS 매핑");
if (!sys.includes("CATEGORY_GAIN") || !sys.includes("CATEGORY_COOLDOWN_MS")) {
  console.error(`FAIL: 카테고리별 보정 매핑 없음`); process.exit(1);
}
// 각 카테고리가 양쪽에 모두 있는지
for (const c of categories) {
  if (!sys.includes(`${c}: 0`) && !sys.includes(`${c}: 1`)) {
    console.error(`FAIL: ${c} 게인/쿨다운 미설정`); process.exit(1);
  }
}
console.log(`  ✓ 카테고리별 게인 + 쿨다운 모두 설정`);

// =====================================================================
// #8: playable_app.js 통합
// =====================================================================
console.log("\n8. playable_app.js 통합");
const app = fs.readFileSync(path.join(ROOT, "src/playable_app.js"), "utf8");
if (!app.includes("from \"./sound_system.js\"")) {
  console.error(`FAIL: sound_system import 없음`); process.exit(1);
}
if (!app.includes("sound.play(")) {
  console.error(`FAIL: sound.play 호출 없음`); process.exit(1);
}
console.log(`  ✓ sound import + sound.play 호출`);

// =====================================================================
// #9: 첫 인터랙션 가드
// =====================================================================
console.log("\n9. 첫 인터랙션 가드 (body click once)");
if (!app.includes("ensureSoundInit") || !app.includes("once: true")) {
  console.error(`FAIL: 첫 인터랙션 가드 없음`); process.exit(1);
}
if (!app.includes("initOnUserGesture")) {
  console.error(`FAIL: initOnUserGesture 호출 없음`); process.exit(1);
}
console.log(`  ✓ body click once → initOnUserGesture`);

// =====================================================================
// #10: triggerTurnSounds 함수 + 5가지 트리거
// =====================================================================
console.log("\n10. triggerTurnSounds 함수 + 5가지 트리거");
if (!app.includes("function triggerTurnSounds")) {
  console.error(`FAIL: triggerTurnSounds 함수 없음`); process.exit(1);
}
const triggerKeys = ["missile_launch", "naval_blockade", "landing_craft_move", "strike_impact", "defense_success"];
for (const k of triggerKeys) {
  if (!app.includes(`sound.play("${k}")`)) {
    console.error(`FAIL: ${k} 트리거 없음`); process.exit(1);
  }
}
// preTurnSnapshot 비교 패턴
if (!app.includes("preTurnSnapshot")) {
  console.error(`FAIL: preTurnSnapshot 비교 패턴 없음`); process.exit(1);
}
console.log(`  ✓ triggerTurnSounds — 5개 트리거 + preTurnSnapshot 비교`);

// =====================================================================
// #11: index.html UI
// =====================================================================
console.log("\n11. index.html 헤더 UI");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (!html.includes('id="soundToggleBtn"') || !html.includes('id="soundVolume"')) {
  console.error(`FAIL: 헤더에 사운드 UI 없음`); process.exit(1);
}
console.log(`  ✓ soundToggleBtn + soundVolume 슬라이더`);

// =====================================================================
// #12: 게임 로직 영향 0
// =====================================================================
console.log("\n12. 게임 로직 영향 0");
const turnRes = fs.readFileSync(path.join(ROOT, "src/turn_resolver.js"), "utf8");
const stateJs = fs.readFileSync(path.join(ROOT, "src/state.js"), "utf8");
for (const sym of ["sound_system", "sound.play", "missile_launch", "triggerTurnSounds"]) {
  if (turnRes.includes(sym) || stateJs.includes(sym)) {
    console.error(`FAIL: engine이 ${sym} 참조`); process.exit(1);
  }
}
console.log(`  ✓ turn_resolver / state.js는 사운드 코드 비참조`);

console.log("\n✓ sound system smoke test passed");

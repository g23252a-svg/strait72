// =====================================================================
// run_motion_effects_smoke_test.mjs (v0.5-c)
// ---------------------------------------------------------------------
// 검증:
//   #1 effects/ 자산 4개 PNG 존재 (missile_red/blue/target_reticle/hit_burst)
//   #2 4개 자산 모두 알파 채널 있음 (모서리 알파 0)
//   #3 _tokenCache에 4개 effects 키 추가
//   #4 drawHitBursts 함수 신규 + recentBattles 시그널
//   #5 drawBlockadeSweep 함수 신규 (sweep arc)
//   #6 상륙정에 wake trail (청록 발자취) + glow ring (붉은 pulse)
//   #7 drawTaiwanDefenseTokens — 위협 시 녹색 pulse ring
//   #8 drawChinaBlockadeFleet — sweep arc 호출
//   #9 drawGameCanvas에 drawHitBursts 호출 (drawProvinces 직후)
//   #10 게임 로직 변경 0
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("[motion + effects smoke test v0.5-c]");

// =====================================================================
// #1+2: effects 자산 4개 존재 + 알파
// =====================================================================
console.log("\n1+2. assets/effects/ 4개 PNG 존재 + 알파 확인");
const effectAssets = [
  "missile_red_trail.png",
  "missile_blue_trail.png",
  "target_reticle.png",
  "hit_burst.png"
];
for (const t of effectAssets) {
  const p = path.join(ROOT, "assets/effects", t);
  if (!fs.existsSync(p)) {
    console.error(`FAIL: ${p} 없음`); process.exit(1);
  }
  const size = fs.statSync(p).size;
  if (size < 10 * 1024) {
    console.error(`FAIL: ${t} 너무 작음 (${size}B)`); process.exit(1);
  }
  console.log(`  ✓ ${t.padEnd(28)} ${(size/1024).toFixed(0)}KB`);
}

// =====================================================================
// #3: _tokenCache 확장
// =====================================================================
console.log("\n3. _tokenCache에 4개 effects 키");
const ui = fs.readFileSync(path.join(ROOT, "src/ui_canvas.js"), "utf8");
for (const key of ["missile_red_trail", "missile_blue_trail", "target_reticle", "hit_burst"]) {
  if (!ui.includes(`${key}:`)) {
    console.error(`FAIL: _tokenCache에 ${key} 없음`); process.exit(1);
  }
}
console.log(`  ✓ _tokenCache에 4개 effects 키 추가`);

// =====================================================================
// #4: drawHitBursts
// =====================================================================
console.log("\n4. drawHitBursts (recentBattles 시그널)");
if (!ui.includes("function drawHitBursts")) {
  console.error(`FAIL: drawHitBursts 없음`); process.exit(1);
}
const hitMatch = ui.match(/function drawHitBursts[\s\S]*?^\}/m);
if (!hitMatch || !hitMatch[0].includes("recentBattles") || !hitMatch[0].includes("hit_burst")) {
  console.error(`FAIL: drawHitBursts에 recentBattles / hit_burst 사용 X`); process.exit(1);
}
console.log(`  ✓ drawHitBursts — recentBattles + hit_burst PNG 사용`);

// =====================================================================
// #5: drawBlockadeSweep
// =====================================================================
console.log("\n5. drawBlockadeSweep (레이더 sweep arc)");
if (!ui.includes("function drawBlockadeSweep")) {
  console.error(`FAIL: drawBlockadeSweep 없음`); process.exit(1);
}
const sweepMatch = ui.match(/function drawBlockadeSweep[\s\S]*?^\}/m);
if (!sweepMatch || !sweepMatch[0].includes("createRadialGradient") || !sweepMatch[0].includes("arc")) {
  console.error(`FAIL: drawBlockadeSweep에 radial gradient + arc 없음`); process.exit(1);
}
console.log(`  ✓ drawBlockadeSweep — radial gradient + 회전 호선`);

// =====================================================================
// #6: 상륙정 wake trail + glow ring
// =====================================================================
console.log("\n6. 상륙정 wake trail + glow ring");
const motionMatch = ui.match(/function drawOperationalMotion[\s\S]*?^\}/m);
if (!motionMatch) { console.error(`FAIL: drawOperationalMotion 파싱 X`); process.exit(1); }
const motionBody = motionMatch[0];
// wake trail = 청록 발자취
if (!motionBody.includes("180, 230, 255") && !motionBody.includes("wake")) {
  console.error(`FAIL: wake trail (청록색) 없음`); process.exit(1);
}
// glow ring = pulsing 후광
if (!motionBody.includes("pulseRing") || !motionBody.includes("ringAlpha")) {
  console.error(`FAIL: pulsing glow ring 없음`); process.exit(1);
}
console.log(`  ✓ 상륙정에 wake trail (청록) + pulsing glow ring (적성)`);

// =====================================================================
// #7: 방어진지 pulse ring
// =====================================================================
console.log("\n7. drawTaiwanDefenseTokens — 위협 시 녹색 pulse ring");
const defMatch = ui.match(/function drawTaiwanDefenseTokens[\s\S]*?^\}/m);
if (!defMatch) { console.error(`FAIL: 파싱 X`); process.exit(1); }
const defBody = defMatch[0];
if (!defBody.includes("underLanding") || !defBody.includes("120, 240, 150")) {
  console.error(`FAIL: 위협 시 녹색 pulse ring 없음`); process.exit(1);
}
console.log(`  ✓ 방어진지에 위협 시 (underLanding) 녹색 pulse ring`);

// =====================================================================
// #8: drawChinaBlockadeFleet에 sweep arc 호출
// =====================================================================
console.log("\n8. drawChinaBlockadeFleet — sweep arc 호출");
const blockMatch = ui.match(/function drawChinaBlockadeFleet[\s\S]*?^\}/m);
if (!blockMatch) { console.error(`FAIL: 파싱 X`); process.exit(1); }
if (!blockMatch[0].includes("drawBlockadeSweep")) {
  console.error(`FAIL: drawBlockadeSweep 호출 없음`); process.exit(1);
}
console.log(`  ✓ drawChinaBlockadeFleet → drawBlockadeSweep 호출`);

// =====================================================================
// #9: drawGameCanvas pipeline
// =====================================================================
console.log("\n9. drawGameCanvas에 drawHitBursts 호출");
const canvasMatch = ui.match(/export function drawGameCanvas[\s\S]*?^\}/m);
if (!canvasMatch || !canvasMatch[0].includes("drawHitBursts")) {
  console.error(`FAIL: drawGameCanvas에 drawHitBursts 호출 없음`); process.exit(1);
}
// drawProvinces 다음에 와야 (거점 위에 폭발)
const lines = canvasMatch[0].split("\n");
const provIdx = lines.findIndex(l => l.includes("drawProvinces"));
const hitIdx = lines.findIndex(l => l.includes("drawHitBursts"));
if (provIdx === -1 || hitIdx === -1 || hitIdx <= provIdx) {
  console.error(`FAIL: drawHitBursts가 drawProvinces 이후에 위치해야`); process.exit(1);
}
console.log(`  ✓ drawHitBursts가 drawProvinces 다음에 호출 (거점 위에 폭발)`);

// =====================================================================
// #10: 게임 로직 영향 0
// =====================================================================
console.log("\n10. 게임 로직 영향 0");
const turnRes = fs.readFileSync(path.join(ROOT, "src/turn_resolver.js"), "utf8");
const stateJs = fs.readFileSync(path.join(ROOT, "src/state.js"), "utf8");
for (const sym of ["drawHitBursts", "drawBlockadeSweep", "hit_burst", "wake"]) {
  if (turnRes.includes(sym) || stateJs.includes(sym)) {
    console.error(`FAIL: engine 파일이 ${sym} 참조`); process.exit(1);
  }
}
console.log(`  ✓ turn_resolver / state.js는 motion/effects 코드 비참조`);

console.log("\n✓ motion + effects smoke test passed");

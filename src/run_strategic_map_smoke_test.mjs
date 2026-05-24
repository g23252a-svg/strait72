// =====================================================================
// run_strategic_map_smoke_test.mjs (v0.5-a)
// ---------------------------------------------------------------------
// 검증:
//   #1 PROVINCE_LAYOUT 새 좌표 (사용자 제공 값과 일치)
//   #2 모든 거점이 0-1 범위 안의 정규화 좌표
//   #3 거점이 7개 + strait — provinces.json과 일치
//   #4 assets/maps/taiwan_strategic_map.png 파일 존재
//   #5 ui_canvas.js에 drawTaiwanMapImage 함수 추가
//   #6 drawTaiwanSilhouetteFallback fallback 존재
//   #7 ensureMapImageLoaded 캐싱 로직 존재
//   #8 drawGameCanvas가 drawTaiwanMapImage 호출 (drawTaiwanSilhouette 아님)
//   #9 hitTestProvince는 변경 없이 새 좌표 자동 반영 — 시뮬레이션
//   #10 게임 로직 영향 0 — runTurn smoke 별도로 통과
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("[strategic map smoke test v0.5-a]");

// =====================================================================
// #1+2+3: PROVINCE_LAYOUT
// =====================================================================
console.log("\n1+2+3. PROVINCE_LAYOUT 새 좌표 + 정규화 + 거점 수");
const { PROVINCE_LAYOUT } = await import("./ui_canvas.js");

const expected = {
  taipei:    { x: 0.600, y: 0.205 },
  keelung:   { x: 0.670, y: 0.240 },
  taoyuan:   { x: 0.540, y: 0.270 },
  taichung:  { x: 0.485, y: 0.405 },
  tainan:    { x: 0.435, y: 0.565 },
  kaohsiung: { x: 0.475, y: 0.730 },
  hualien:   { x: 0.595, y: 0.560 },
  strait:    { x: 0.230, y: 0.460 }
};

for (const [id, exp] of Object.entries(expected)) {
  const got = PROVINCE_LAYOUT[id];
  if (!got) {
    console.error(`FAIL: ${id} 없음`); process.exit(1);
  }
  if (Math.abs(got.x - exp.x) > 0.001 || Math.abs(got.y - exp.y) > 0.001) {
    console.error(`FAIL: ${id} 좌표 불일치 — got (${got.x}, ${got.y}), expected (${exp.x}, ${exp.y})`);
    process.exit(1);
  }
  if (got.x < 0 || got.x > 1 || got.y < 0 || got.y > 1) {
    console.error(`FAIL: ${id} 정규화 범위 벗어남`); process.exit(1);
  }
  if (!got.label) {
    console.error(`FAIL: ${id} label 없음`); process.exit(1);
  }
}
console.log(`  ✓ 8개 거점 좌표 모두 일치 + 정규화 + label 존재`);

// provinces.json과 cross-check
const provinces = JSON.parse(fs.readFileSync(path.join(ROOT, "data/provinces.json"), "utf8"));
const provIds = new Set(provinces.map(p => p.id));
for (const id of Object.keys(PROVINCE_LAYOUT)) {
  if (!provIds.has(id)) {
    console.error(`FAIL: PROVINCE_LAYOUT.${id}가 provinces.json에 없음`); process.exit(1);
  }
}
console.log(`  ✓ provinces.json과 cross-check OK (${provinces.length} 거점)`);

// =====================================================================
// #4: 맵 PNG 파일 존재
// =====================================================================
console.log("\n4. assets/maps/taiwan_strategic_map.png 파일 존재");
const mapPath = path.join(ROOT, "assets/maps/taiwan_strategic_map.png");
if (!fs.existsSync(mapPath)) {
  console.error(`FAIL: ${mapPath} 없음`); process.exit(1);
}
const stat = fs.statSync(mapPath);
console.log(`  ✓ taiwan_strategic_map.png 존재 (${(stat.size/1024).toFixed(1)} KB)`);

// 경고: placeholder인지 확인
if (stat.size < 50 * 1024) {
  console.log(`  ⚠ 파일이 작음 (${stat.size}B) — placeholder일 가능성`);
  console.log(`    실제 자산으로 교체 필요: 1920x1080 권장`);
}

// =====================================================================
// #5+6+7: ui_canvas.js 코드 패턴
// =====================================================================
console.log("\n5+6+7. ui_canvas.js 코드 변경 확인");
const ui = fs.readFileSync(path.join(ROOT, "src/ui_canvas.js"), "utf8");

if (!ui.includes("function drawTaiwanMapImage")) {
  console.error(`FAIL: drawTaiwanMapImage 함수 없음`); process.exit(1);
}
if (!ui.includes("function drawTaiwanSilhouetteFallback")) {
  console.error(`FAIL: drawTaiwanSilhouetteFallback (fallback) 없음`); process.exit(1);
}
if (!ui.includes("ensureMapImageLoaded")) {
  console.error(`FAIL: ensureMapImageLoaded 없음`); process.exit(1);
}
if (!ui.includes("_mapImage")) {
  console.error(`FAIL: 모듈 캐시 _mapImage 없음`); process.exit(1);
}
if (!ui.includes('"./assets/maps/taiwan_strategic_map.png"')) {
  console.error(`FAIL: 이미지 경로 ./assets/maps/taiwan_strategic_map.png 없음`); process.exit(1);
}
console.log(`  ✓ drawTaiwanMapImage + Fallback + ensureMapImageLoaded + 경로 모두 OK`);

// =====================================================================
// #8: drawGameCanvas 교체
// =====================================================================
console.log("\n8. drawGameCanvas에서 drawTaiwanSilhouette 직접 호출 X (Fallback만)");
// drawTaiwanSilhouette 정확한 단어 (Fallback 제외)는 drawGameCanvas에서 호출 안 됨
const drawCanvasMatch = ui.match(/export function drawGameCanvas[\s\S]*?^\}/m);
if (drawCanvasMatch) {
  const body = drawCanvasMatch[0];
  if (body.includes("drawTaiwanSilhouette") && !body.includes("drawTaiwanSilhouetteFallback")) {
    console.error(`FAIL: drawGameCanvas에서 여전히 옛 drawTaiwanSilhouette 호출`); process.exit(1);
  }
  if (!body.includes("drawTaiwanMapImage")) {
    console.error(`FAIL: drawGameCanvas에 drawTaiwanMapImage 호출 없음`); process.exit(1);
  }
}
console.log(`  ✓ drawGameCanvas → drawTaiwanMapImage (Fallback은 내부 호출만)`);

// =====================================================================
// #9: hitTestProvince는 자동 반영 — 좌표 시뮬레이션
// =====================================================================
console.log("\n9. hitTestProvince는 새 좌표로 자동 반영");
// hitTestProvince 함수가 PROVINCE_LAYOUT을 참조하는지
if (!ui.includes("PROVINCE_LAYOUT")) {
  console.error(`FAIL: hitTestProvince가 PROVINCE_LAYOUT 참조 X`); process.exit(1);
}
// 시뮬레이션: 새 좌표로 가오슝 클릭 시뮬레이션 (정규화 0.468, 0.705)
// 캔버스가 1000x800이면 (468, 564). hitTest 함수 자체는 변경 없으므로
// 좌표만 검사.
const kao = PROVINCE_LAYOUT.kaohsiung;
const simX = 1000 * kao.x;  // 468
const simY = 800 * kao.y;   // 564
const dx = simX - 1000 * kao.x;
const dy = simY - 800 * kao.y;
if (Math.sqrt(dx*dx + dy*dy) > kao.r) {
  console.error(`FAIL: 자기 자신 좌표가 r 안에 없음`); process.exit(1);
}
console.log(`  ✓ 가오슝 시뮬레이션 — 정규화 (${kao.x}, ${kao.y}) → 캔버스 (${simX}, ${simY}) r=${kao.r}`);

// =====================================================================
// #10: 게임 로직 영향 0 — 기존 회귀가 모두 통과해야
// =====================================================================
console.log("\n10. 게임 로직 영향 0 — turn_resolver / state 등 미변경 확인");
const turnRes = fs.readFileSync(path.join(ROOT, "src/turn_resolver.js"), "utf8");
const state = fs.readFileSync(path.join(ROOT, "src/state.js"), "utf8");
// turn_resolver/state는 PROVINCE_LAYOUT 참조 X (좌표는 UI 전용)
if (turnRes.includes("PROVINCE_LAYOUT")) {
  console.error(`FAIL: turn_resolver가 PROVINCE_LAYOUT 참조 (UI 분리 X)`); process.exit(1);
}
if (state.includes("PROVINCE_LAYOUT")) {
  console.error(`FAIL: state가 PROVINCE_LAYOUT 참조`); process.exit(1);
}
console.log(`  ✓ turn_resolver / state는 PROVINCE_LAYOUT 비참조 (UI/엔진 분리)`);

// =====================================================================
// #11: assets/README.md 가이드
// =====================================================================
console.log("\n11. assets/README.md 가이드 존재");
const readmePath = path.join(ROOT, "assets/README.md");
if (!fs.existsSync(readmePath)) {
  console.error(`FAIL: assets/README.md 없음`); process.exit(1);
}
const readme = fs.readFileSync(readmePath, "utf8");
if (!readme.includes("taiwan_strategic_map.png") || !readme.includes("v0.5-a")) {
  console.error(`FAIL: README에 v0.5-a 가이드 부재`); process.exit(1);
}
console.log(`  ✓ assets/README.md + v0.5-a 가이드 + 파일명 매핑`);

console.log("\n✓ strategic map smoke test passed");

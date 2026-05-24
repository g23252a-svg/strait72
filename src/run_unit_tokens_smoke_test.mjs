// =====================================================================
// run_unit_tokens_smoke_test.mjs (v0.5-b)
// ---------------------------------------------------------------------
// 검증:
//   #1 5개 토큰 PNG 파일 존재 (assets/tokens/)
//   #2 _tokenCache 5개 key 정의
//   #3 ensureTokenLoaded / drawTokenImage 함수 존재
//   #4 drawChinaBlockadeFleet 함수 신규 (naval_blockade axis 시그널 사용)
//   #5 drawTaiwanDefenseTokens 함수 신규 (stable_defense 거점에 표시)
//   #6 drawGameCanvas가 새 함수 호출
//   #7 us_carrier_group / japan_patrol_aircraft drawTokenImage 사용
//   #8 china_landing_craft drawTokenImage 사용 + fallback drawShipIcon
//   #9 game logic 영향 0 — turn_resolver / state.js 변경 X
//   #10 placeholder가 아닌 실제 자산 (50KB 이상)
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("[unit tokens smoke test v0.5-b]");

// =====================================================================
// #1+10: 5개 토큰 PNG 존재 + 실제 자산
// =====================================================================
console.log("\n1+10. assets/tokens/ 5개 PNG 존재 + 실제 자산");
const tokens = [
  "china_landing_craft.png",
  "china_blockade_fleet.png",
  "us_carrier_group.png",
  "japan_patrol_aircraft.png",
  "taiwan_defense_emplacement.png"
];
for (const t of tokens) {
  const p = path.join(ROOT, "assets/tokens", t);
  if (!fs.existsSync(p)) {
    console.error(`FAIL: ${p} 없음`); process.exit(1);
  }
  const size = fs.statSync(p).size;
  if (size < 50 * 1024) {
    console.error(`FAIL: ${t} 크기 ${size}B — placeholder 의심 (50KB 이상 필요)`);
    process.exit(1);
  }
  console.log(`  ✓ ${t.padEnd(40)} ${(size/1024).toFixed(0)}KB`);
}

// =====================================================================
// #2+3: 토큰 캐시 시스템
// =====================================================================
console.log("\n2+3. 토큰 캐시 + 로더 함수");
const ui = fs.readFileSync(path.join(ROOT, "src/ui_canvas.js"), "utf8");

if (!ui.includes("_tokenCache")) {
  console.error(`FAIL: _tokenCache 없음`); process.exit(1);
}
for (const key of [
  "china_landing_craft", "china_blockade_fleet",
  "us_carrier_group", "japan_patrol_aircraft", "taiwan_defense_emplacement"
]) {
  if (!ui.includes(`${key}:`)) {
    console.error(`FAIL: _tokenCache에 ${key} 없음`); process.exit(1);
  }
}
if (!ui.includes("function ensureTokenLoaded")) {
  console.error(`FAIL: ensureTokenLoaded 없음`); process.exit(1);
}
if (!ui.includes("function drawTokenImage")) {
  console.error(`FAIL: drawTokenImage 없음`); process.exit(1);
}
console.log(`  ✓ _tokenCache 5개 key + ensureTokenLoaded + drawTokenImage`);

// =====================================================================
// #4: drawChinaBlockadeFleet
// =====================================================================
console.log("\n4. drawChinaBlockadeFleet (naval_blockade axis)");
if (!ui.includes("function drawChinaBlockadeFleet")) {
  console.error(`FAIL: drawChinaBlockadeFleet 없음`); process.exit(1);
}
if (!ui.includes("naval_blockade")) {
  console.error(`FAIL: naval_blockade axis 시그널 사용 X`); process.exit(1);
}
if (!ui.includes("recentChinaAxes") || !ui.includes("thisTurn?.chinaAxis")) {
  console.error(`FAIL: chinaAxis state 읽기 X`); process.exit(1);
}
console.log(`  ✓ drawChinaBlockadeFleet — thisTurn.chinaAxis + recentChinaAxes 시그널`);

// =====================================================================
// #5: drawTaiwanDefenseTokens — v0.5-b1: 평시 숨김
// =====================================================================
console.log("\n5. drawTaiwanDefenseTokens (위협/선택 거점만 — v0.5-b1)");
if (!ui.includes("function drawTaiwanDefenseTokens")) {
  console.error(`FAIL: drawTaiwanDefenseTokens 없음`); process.exit(1);
}
// v0.5-b1: stable_defense 조건은 제거되고, underLanding / isSelected로 대체
if (!ui.includes("underLanding") || !ui.includes("isSelected")) {
  console.error(`FAIL: v0.5-b1 표시 조건 (underLanding / isSelected) 없음`); process.exit(1);
}
// 평시 표시 막는지: china_control + beachhead_established 제외
if (!ui.includes('"china_control"') || !ui.includes('"beachhead_established"')) {
  console.error(`FAIL: 함락 거점 제외 로직 없음`); process.exit(1);
}
console.log(`  ✓ drawTaiwanDefenseTokens — 평시 숨김, underLanding/isSelected 트리거`);

// =====================================================================
// #6: drawGameCanvas 호출
// =====================================================================
console.log("\n6. drawGameCanvas가 새 함수 호출");
const canvasMatch = ui.match(/export function drawGameCanvas[\s\S]*?^\}/m);
if (!canvasMatch) {
  console.error(`FAIL: drawGameCanvas 파싱 실패`); process.exit(1);
}
const canvasBody = canvasMatch[0];
if (!canvasBody.includes("drawChinaBlockadeFleet")) {
  console.error(`FAIL: drawGameCanvas에 drawChinaBlockadeFleet 호출 없음`); process.exit(1);
}
if (!canvasBody.includes("drawTaiwanDefenseTokens")) {
  console.error(`FAIL: drawGameCanvas에 drawTaiwanDefenseTokens 호출 없음`); process.exit(1);
}
console.log(`  ✓ drawGameCanvas에 봉쇄 함대 + 방어진지 호출`);

// =====================================================================
// #7: 미 항모전단 + 일본기 PNG 사용
// =====================================================================
console.log("\n7. drawAlliedIntervention이 us_carrier_group + japan_patrol_aircraft PNG 사용");
const alliedMatch = ui.match(/function drawAlliedIntervention[\s\S]*?^\}/m);
if (!alliedMatch) {
  console.error(`FAIL: drawAlliedIntervention 파싱 실패`); process.exit(1);
}
const alliedBody = alliedMatch[0];
if (!alliedBody.includes('"us_carrier_group"')) {
  console.error(`FAIL: us_carrier_group 토큰 사용 X`); process.exit(1);
}
if (!alliedBody.includes('"japan_patrol_aircraft"')) {
  console.error(`FAIL: japan_patrol_aircraft 토큰 사용 X`); process.exit(1);
}
// fallback 유지
if (!alliedBody.includes("drawFleetGroup")) {
  console.error(`FAIL: drawFleetGroup fallback 없음 (PNG 로드 실패 대응)`); process.exit(1);
}
console.log(`  ✓ 미 항모전단 + 일본기 PNG + drawFleetGroup fallback`);

// =====================================================================
// #8: 상륙정 PNG + fallback
// =====================================================================
console.log("\n8. drawOperationalMotion이 china_landing_craft PNG 사용 + drawShipIcon fallback");
const motionMatch = ui.match(/function drawOperationalMotion[\s\S]*?^\}/m);
if (!motionMatch) {
  console.error(`FAIL: drawOperationalMotion 파싱 실패`); process.exit(1);
}
const motionBody = motionMatch[0];
if (!motionBody.includes('"china_landing_craft"')) {
  console.error(`FAIL: china_landing_craft 토큰 사용 X`); process.exit(1);
}
if (!motionBody.includes("drawShipIcon")) {
  console.error(`FAIL: drawShipIcon fallback 없음`); process.exit(1);
}
console.log(`  ✓ 상륙정 PNG + drawShipIcon fallback`);

// =====================================================================
// #9: 게임 로직 영향 0
// =====================================================================
console.log("\n9. game logic 영향 0 — engine 파일 변경 X");
const turnRes = fs.readFileSync(path.join(ROOT, "src/turn_resolver.js"), "utf8");
const stateJs = fs.readFileSync(path.join(ROOT, "src/state.js"), "utf8");
// turn_resolver / state는 토큰 키 / drawTokenImage 등 참조 X
for (const sym of ["drawTokenImage", "_tokenCache", "ensureTokenLoaded"]) {
  if (turnRes.includes(sym) || stateJs.includes(sym)) {
    console.error(`FAIL: engine 파일이 ${sym} 참조 (UI/engine 분리 X)`); process.exit(1);
  }
}
console.log(`  ✓ turn_resolver / state.js 모두 UI 토큰 코드 비참조`);

// =====================================================================
// #11: 자동 리포트 메트릭 회귀 X — 별도 실행 확인은 build pipeline에서
// =====================================================================
console.log("\n10. v0.5-b 시그널 명확성 — naval_blockade / landingStage / controlStage");
// v0.5-b1: stable_defense 시그널 직접 사용은 제거 (평시 숨김 정책)
const signals = ["naval_blockade", "landingStage", "controlStage"];
for (const s of signals) {
  if (!ui.includes(s)) {
    console.error(`FAIL: 시그널 키워드 '${s}' 없음`); process.exit(1);
  }
}
console.log(`  ✓ 시그널 키워드 모두 존재: ${signals.join(", ")}`);

console.log("\n✓ unit tokens smoke test passed");

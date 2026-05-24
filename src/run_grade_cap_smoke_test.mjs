// =====================================================================
// run_grade_cap_smoke_test.mjs (v0.4.0-d4)
// ---------------------------------------------------------------------
// 등급 cap + 수도권 페널티 + 해설 조건 강화 검증.
//
// 사용자 명세 4가지:
//   1. S급 하드 조건 — 영토 0~1 + 수도 안전 + 정부 70+ + us 100 + japan 60+
//   2. 점령지 수에 따른 등급 상한 (0~1: S, 2: A, 3+: B)
//   3. 수도권 압박 페널티 (contested/breach/beachhead)
//   4. 해설 조건 — "방어선이 흔들리지 않았다"는 S 하드 조건일 때만
// =====================================================================

import {
  buildFinalReport, calculateFinalScore, gradeFromScore,
  determineGradeCap, gradeWithCap, analyzeTerritorialState,
  generateFinalInterpretation
} from "./final_grade.js";

console.log("[grade cap smoke test v0.4.0-d4]");

function mkProvs(spec) {
  // spec: { taipei: "contested"|"china_control"|..., taichung: "china_control", ... }
  const types = {
    taipei: "capital", keelung: "port", taoyuan: "airport",
    taichung: "city", tainan: "city", kaohsiung: "major_port", hualien: "east_port"
  };
  const provs = {};
  for (const [id, controlStage] of Object.entries(spec)) {
    provs[id] = {
      id, name: id, type: types[id] || "city",
      controlStage: typeof controlStage === "string" ? controlStage : controlStage.stage,
      landingStage: typeof controlStage === "string" ? "none" : (controlStage.landing || "none")
    };
  }
  return provs;
}

function mkState({ outcome = "taiwan_survival_win", turn = 30, gauges = {}, provinces = {}, rewards = [], triggered = [] } = {}) {
  return {
    outcome, turn,
    gauges: {
      usIntervention: 80, japanIntervention: 60, koreaRearSupport: 20,
      internationalOpinion: 60, chinaPoliticalPressure: 50,
      chinaTempo: 50, chinaSupply: 50,
      taiwanMorale: 70, taiwanGovernment: 75, taiwanCommand: 80, taiwanSupply: 60,
      ...gauges
    },
    provinces, log: [],
    persistent: { rewards, triggeredOnce: triggered }
  };
}

// 1. analyzeTerritorialState 정확성
console.log("\n1. analyzeTerritorialState");
const t1 = analyzeTerritorialState(mkState({
  provinces: mkProvs({
    taipei: { stage: "contested", landing: "beachhead" },
    keelung: "china_control",
    taichung: "china_control",
    tainan: "china_control"
  })
}));
if (t1.lostCount !== 3) {
  console.error(`FAIL: lostCount 3 아님, got ${t1.lostCount}`); process.exit(1);
}
if (t1.taipeiRisk !== "beachhead") {
  console.error(`FAIL: taipeiRisk beachhead 아님, got ${t1.taipeiRisk}`); process.exit(1);
}
if (!t1.capitalAtRisk) {
  console.error(`FAIL: capitalAtRisk true이어야`); process.exit(1);
}
if (t1.keelungStage !== "china_control") {
  console.error(`FAIL: keelungStage 부정확`); process.exit(1);
}
console.log(`  ✓ lostCount=3, taipeiRisk=beachhead, capitalAtRisk=true, keelung china_control`);

// 2. determineGradeCap — 점령지 수
console.log("\n2. determineGradeCap — 점령지 수 기반");
const cap0 = determineGradeCap(mkState({ provinces: mkProvs({ taipei: "stable_defense" }) }), "taiwan");
const cap1 = determineGradeCap(mkState({ provinces: mkProvs({ taipei: "stable_defense", kaohsiung: "china_control" }) }), "taiwan");
const cap2 = determineGradeCap(mkState({ provinces: mkProvs({ taipei: "stable_defense", kaohsiung: "china_control", tainan: "china_control" }) }), "taiwan");
const cap3 = determineGradeCap(mkState({ provinces: mkProvs({ taipei: "stable_defense", kaohsiung: "china_control", tainan: "china_control", taichung: "china_control" }) }), "taiwan");
// 0/1: S 가능, 단 S 하드 조건 미충족이면 A. mkState 기본은 us 80이라 S 조건 미충족
if (cap0 !== "A") { console.error(`FAIL: 점령 0 + S 조건 미충족 → A, got ${cap0}`); process.exit(1); }
if (cap1 !== "A") { console.error(`FAIL: 점령 1 + S 조건 미충족 → A, got ${cap1}`); process.exit(1); }
if (cap2 !== "A") { console.error(`FAIL: 점령 2 → A, got ${cap2}`); process.exit(1); }
if (cap3 !== "B") { console.error(`FAIL: 점령 3 → B, got ${cap3}`); process.exit(1); }
console.log(`  ✓ 점령 0/1/2/3: ${cap0}/${cap1}/${cap2}/${cap3}`);

// 3. S 하드 조건 — 영토 0 + 수도 안전 + gov 70+ + us 100 + jp 60+
console.log("\n3. S 하드 조건");
const sQualified = determineGradeCap(mkState({
  gauges: { taiwanGovernment: 75, usIntervention: 100, japanIntervention: 65 },
  provinces: mkProvs({ taipei: "stable_defense" })
}), "taiwan");
if (sQualified !== "S") { console.error(`FAIL: S 조건 충족인데 cap=${sQualified}`); process.exit(1); }
console.log(`  ✓ S 조건 충족: cap=S`);

const sFailGov = determineGradeCap(mkState({
  gauges: { taiwanGovernment: 65, usIntervention: 100, japanIntervention: 65 },
  provinces: mkProvs({ taipei: "stable_defense" })
}), "taiwan");
if (sFailGov !== "A") { console.error(`FAIL: 정부 70 미만 → A cap, got ${sFailGov}`); process.exit(1); }
console.log(`  ✓ 정부 65 → A`);

const sFailUs = determineGradeCap(mkState({
  gauges: { taiwanGovernment: 75, usIntervention: 95, japanIntervention: 65 },
  provinces: mkProvs({ taipei: "stable_defense" })
}), "taiwan");
if (sFailUs !== "A") { console.error(`FAIL: us 95 < 100 → A, got ${sFailUs}`); process.exit(1); }
console.log(`  ✓ 미국 95 → A`);

// 4. 수도 상태 cap
console.log("\n4. 수도 상태 cap");
const capContested = determineGradeCap(mkState({
  gauges: { taiwanGovernment: 75, usIntervention: 100, japanIntervention: 65 },
  provinces: mkProvs({ taipei: { stage: "contested", landing: "coastal_breach" } })
}), "taiwan");
if (capContested !== "B") { console.error(`FAIL: 타이베이 breach → B, got ${capContested}`); process.exit(1); }
console.log(`  ✓ 타이베이 breach → B cap`);

const capTaipeiLost = determineGradeCap(mkState({
  provinces: mkProvs({ taipei: "china_control" })
}), "taiwan");
if (capTaipeiLost !== "D") { console.error(`FAIL: 타이베이 china_control → D, got ${capTaipeiLost}`); process.exit(1); }
console.log(`  ✓ 타이베이 china_control → D cap`);

// 5. gradeWithCap 적용
console.log("\n5. gradeWithCap — 자연 등급보다 cap이 낮으면 cap");
if (gradeWithCap(95, "B") !== "B") { console.error(`FAIL: 95/B → B`); process.exit(1); }
if (gradeWithCap(95, "S") !== "S") { console.error(`FAIL: 95/S → S`); process.exit(1); }
if (gradeWithCap(45, "S") !== "C") { console.error(`FAIL: 45/S → C (cap 위쪽이면 자연등급)`); process.exit(1); }
console.log(`  ✓ gradeWithCap: 95+B=B, 95+S=S, 45+S=C`);

// 6. 수도권 페널티 components 등장
console.log("\n6. calculateFinalScore — 수도권 페널티 components");
const penState = mkState({
  provinces: mkProvs({
    taipei: { stage: "contested", landing: "coastal_breach" },
    keelung: "china_control"
  })
});
const penResult = calculateFinalScore(penState, "taiwan");
const taipeiPen = penResult.components.find(c => c.label.includes("타이베이"));
const keelungPen = penResult.components.find(c => c.label.includes("지룽"));
if (!taipeiPen || taipeiPen.delta !== -12) {
  console.error(`FAIL: 타이베이 breach -12 아님, got ${taipeiPen?.delta}`); process.exit(1);
}
if (!keelungPen || keelungPen.delta !== -8) {
  console.error(`FAIL: 지룽 china_control -8 아님, got ${keelungPen?.delta}`); process.exit(1);
}
console.log(`  ✓ 타이베이 breach -12, 지룽 china_control -8`);

// 7. 사용자 실측 케이스: 점령 3 + 타이베이 breach + 지룽 contested → 자연 S지만 최종 B
console.log("\n7. 사용자 실측 케이스 재현");
const userCase = mkState({
  gauges: {
    taiwanGovernment: 69, taiwanMorale: 80, taiwanSupply: 60, taiwanCommand: 80,
    usIntervention: 100, japanIntervention: 92, koreaRearSupport: 22
  },
  provinces: mkProvs({
    taipei:   { stage: "contested", landing: "coastal_breach" },
    keelung:  { stage: "contested", landing: "beachhead" },
    taoyuan:  "stable_defense",
    taichung: "china_control",
    tainan:   "china_control",
    kaohsiung:"china_control"
  }),
  rewards: [
    { id:"tw_humanitarian", name:"인도주의 캠페인", applyTiming:"persistent", effects:{ perTurnGain:{ usIntervention:2 }}}
  ],
  triggered: ["global_us_carrier_movement", "global_japan_security_council"]
});
const userReport = buildFinalReport(userCase, { selectedSide: "taiwan" }, { gameRules: { totalTurns: 30 } });
if (userReport.taiwan.grade !== "B") {
  console.error(`FAIL: 사용자 실측 케이스 최종 등급 B이어야, got ${userReport.taiwan.grade}`);
  console.error(`  자연: ${userReport.taiwan.naturalGrade}, cap: ${userReport.taiwan.gradeCap}, score: ${userReport.taiwan.score}`);
  process.exit(1);
}
if (userReport.taiwan.naturalGrade !== "S") {
  console.error(`FAIL: 자연 등급은 S여야 (점수 94), got ${userReport.taiwan.naturalGrade}`); process.exit(1);
}
if (userReport.taiwan.gradeCap !== "B") {
  console.error(`FAIL: cap B여야, got ${userReport.taiwan.gradeCap}`); process.exit(1);
}
console.log(`  ✓ 사용자 케이스: 자연 ${userReport.taiwan.naturalGrade}(${userReport.taiwan.score}) → cap ${userReport.taiwan.gradeCap} → 최종 ${userReport.taiwan.grade}`);

// 8. 해설 조건: B 등급 + 영토 손실 3 → "흔들리지 않았다" 없어야
console.log("\n8. 해설 조건 강화 — 영토 손실 시 'B 등급 해설' 사용");
const interp = userReport.taiwan.interpretation;
if (interp.includes("흔들리지 않은")) {
  console.error(`FAIL: 영토 3 손실인데 '흔들리지 않은' 해설 사용됨: "${interp}"`); process.exit(1);
}
if (!interp.includes("영토를 상실") && !interp.includes("3곳")) {
  console.error(`FAIL: 영토 상실 사실이 해설에 없음: "${interp}"`); process.exit(1);
}
console.log(`  ✓ 해설: ${interp.slice(0, 60)}…`);

// 9. S 등급 해설은 정확한 조건에서만
console.log("\n9. S 등급은 무손실 시에만 '흔들리지 않은' 해설");
const sCase = mkState({
  gauges: { taiwanGovernment: 80, usIntervention: 100, japanIntervention: 70, taiwanSupply: 70, taiwanCommand: 90 },
  provinces: mkProvs({ taipei: "stable_defense" })
});
const sReport = buildFinalReport(sCase, { selectedSide: "taiwan" }, { gameRules: { totalTurns: 30 } });
if (sReport.taiwan.grade !== "S") {
  console.error(`FAIL: S 조건 충족인데 등급 ${sReport.taiwan.grade}`); process.exit(1);
}
if (!sReport.taiwan.interpretation.includes("흔들리지 않은")) {
  console.error(`FAIL: S 등급 해설에 '흔들리지 않은' 없음: "${sReport.taiwan.interpretation}"`); process.exit(1);
}
console.log(`  ✓ S 등급: ${sReport.taiwan.interpretation.slice(0, 60)}…`);

// 10. 중국 진영: taiwan 승리 → 중국 cap C
console.log("\n10. 중국 진영 cap");
const cnTaiwanWin = determineGradeCap(mkState({ outcome: "taiwan_survival_win" }), "china");
if (cnTaiwanWin !== "C") {
  console.error(`FAIL: 중국이 taiwan_survival_win → C cap, got ${cnTaiwanWin}`); process.exit(1);
}
console.log(`  ✓ 중국 + taiwan 승리 → C cap`);

console.log("\n✓ grade cap smoke test passed");

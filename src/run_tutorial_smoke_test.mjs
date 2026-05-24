// =====================================================================
// run_tutorial_smoke_test.mjs (v0.4.3)
// ---------------------------------------------------------------------
// DOM stub 만들어서 튜토리얼 로직 검증:
//
//   #1 TUTORIAL_STEPS 9개 정의, 각 step에 id/title/body/advanceOn
//   #2 advanceOn 종류 (manual / turn_run / day_end)
//   #3 localStorage 플래그 (isCompleted / mark / reset)
//   #4 startTutorial → active=true, currentStepIdx=0
//   #5 advanceTutorial "manual"이면 manual step만 advance
//   #6 advanceTutorial "turn_run"이면 first_turn step에서 advance
//   #7 advanceTutorial "day_end"이면 auto_progress step에서 advance
//   #8 마지막 step 다음 → endTutorial + markCompleted
//   #9 endTutorial: active=false, localStorage="completed"
// =====================================================================

// jsdom-like minimal stub
const elements = new Map();
globalThis.document = {
  createElement: (tag) => {
    const el = { tagName: tag, style: {}, dataset: {}, children: [], _events: {} };
    el.addEventListener = (ev, fn) => { el._events[ev] = fn; };
    el.querySelector = (sel) => {
      // 매우 단순 — class selector .tutorial-next-btn 정도만
      const cls = sel.startsWith(".") ? sel.slice(1) : null;
      if (cls) {
        for (const c of el.children) {
          if (c.className === cls) return c;
        }
      }
      return null;
    };
    el.querySelectorAll = () => [];
    el.appendChild = (c) => { el.children.push(c); };
    el.remove = () => {
      if (el.id) elements.delete(el.id);
    };
    return el;
  },
  body: {
    appendChild: (el) => {
      if (el.id) elements.set(el.id, el);
    }
  },
  getElementById: (id) => elements.get(id) || null,
  querySelectorAll: () => []
};

let stored = {};
globalThis.localStorage = {
  getItem: (k) => stored[k] || null,
  setItem: (k, v) => { stored[k] = v; },
  removeItem: (k) => { delete stored[k]; }
};

const {
  TUTORIAL_STEPS,
  isTutorialCompleted, markTutorialCompleted, resetTutorial,
  startTutorial, endTutorial, advanceTutorial, isTutorialActive,
  getCurrentStep, getStepCount
} = await import("./tutorial.js");

console.log("[tutorial smoke test v0.4.3]");

// =====================================================================
// #1: STEPS 9개 + schema
// =====================================================================
console.log("\n1. TUTORIAL_STEPS 9개 + schema");
if (TUTORIAL_STEPS.length !== 9) {
  console.error(`FAIL: 9개 아님, ${TUTORIAL_STEPS.length}`); process.exit(1);
}
const expectedIds = ["intro", "gauges", "cards", "map", "first_turn",
                     "after_first_turn", "auto_progress", "day_modal", "complete"];
for (let i = 0; i < expectedIds.length; i++) {
  if (TUTORIAL_STEPS[i].id !== expectedIds[i]) {
    console.error(`FAIL: step ${i} id ${TUTORIAL_STEPS[i].id} != ${expectedIds[i]}`); process.exit(1);
  }
}
for (const step of TUTORIAL_STEPS) {
  if (!step.id || !step.title || !step.body) {
    console.error(`FAIL: step ${step.id} 필수 필드 누락`); process.exit(1);
  }
  if (!["manual", "turn_run", "day_end", "card_played"].includes(step.advanceOn)) {
    console.error(`FAIL: step ${step.id} advanceOn 비표준: ${step.advanceOn}`); process.exit(1);
  }
}
console.log(`  ✓ 9개 step 모두 존재, ${expectedIds.join(" → ")}`);

// =====================================================================
// #2: advanceOn 종류
// =====================================================================
console.log("\n2. advanceOn 종류 검증");
const firstTurnStep = TUTORIAL_STEPS.find(s => s.id === "first_turn");
if (firstTurnStep.advanceOn !== "turn_run") {
  console.error(`FAIL: first_turn step advanceOn=turn_run 아님`); process.exit(1);
}
const autoStep = TUTORIAL_STEPS.find(s => s.id === "auto_progress");
if (autoStep.advanceOn !== "day_end") {
  console.error(`FAIL: auto_progress step advanceOn=day_end 아님`); process.exit(1);
}
console.log(`  ✓ first_turn=turn_run, auto_progress=day_end`);

// =====================================================================
// #3: localStorage 플래그
// =====================================================================
console.log("\n3. localStorage 플래그");
stored = {};
if (isTutorialCompleted()) {
  console.error(`FAIL: 초기에는 completed false이어야`); process.exit(1);
}
markTutorialCompleted();
if (!isTutorialCompleted()) {
  console.error(`FAIL: mark 후 completed true이어야`); process.exit(1);
}
resetTutorial();
if (isTutorialCompleted()) {
  console.error(`FAIL: reset 후 false이어야`); process.exit(1);
}
console.log(`  ✓ isCompleted → mark → reset 사이클 정상`);

// =====================================================================
// #4: startTutorial
// =====================================================================
console.log("\n4. startTutorial active=true, step=0");
stored = {};
elements.clear();
startTutorial();
if (!isTutorialActive()) {
  console.error(`FAIL: startTutorial 후 active false`); process.exit(1);
}
const s0 = getCurrentStep();
if (!s0 || s0.id !== "intro") {
  console.error(`FAIL: startTutorial 후 첫 step intro 아님`); process.exit(1);
}
console.log(`  ✓ active=true, currentStep=intro`);

// =====================================================================
// #5: advanceTutorial manual
// =====================================================================
console.log("\n5. advanceTutorial manual = manual step만 advance");
// intro (manual) → gauges (manual)
advanceTutorial("manual");
if (getCurrentStep()?.id !== "gauges") {
  console.error(`FAIL: manual advance 후 gauges 아님, ${getCurrentStep()?.id}`); process.exit(1);
}
// gauges (manual) → cards
advanceTutorial("manual");
if (getCurrentStep()?.id !== "cards") {
  console.error(`FAIL: cards 아님, ${getCurrentStep()?.id}`); process.exit(1);
}
// turn_run 보냈는데 현재 manual step이면 advance 안 됨
advanceTutorial("turn_run");
if (getCurrentStep()?.id !== "cards") {
  console.error(`FAIL: turn_run으로 manual step advance 됨`); process.exit(1);
}
console.log(`  ✓ manual advance 동작, 다른 reason 무시`);

// =====================================================================
// #6: turn_run advance
// =====================================================================
console.log("\n6. turn_run advance — first_turn step에서만 동작");
// cards (manual) → map → first_turn
advanceTutorial("manual");  // → map
advanceTutorial("manual");  // → first_turn
if (getCurrentStep()?.id !== "first_turn") {
  console.error(`FAIL: first_turn 아님, ${getCurrentStep()?.id}`); process.exit(1);
}
// first_turn은 turn_run에 advance
advanceTutorial("manual");
if (getCurrentStep()?.id !== "first_turn") {
  console.error(`FAIL: first_turn에서 manual로 advance됨`); process.exit(1);
}
advanceTutorial("turn_run");
if (getCurrentStep()?.id !== "after_first_turn") {
  console.error(`FAIL: turn_run 후 after_first_turn 아님, ${getCurrentStep()?.id}`); process.exit(1);
}
console.log(`  ✓ first_turn → turn_run → after_first_turn`);

// =====================================================================
// #7: day_end advance
// =====================================================================
console.log("\n7. day_end advance — auto_progress step에서만 동작");
advanceTutorial("manual");  // after_first_turn → auto_progress
if (getCurrentStep()?.id !== "auto_progress") {
  console.error(`FAIL: auto_progress 아님, ${getCurrentStep()?.id}`); process.exit(1);
}
advanceTutorial("turn_run");  // 무시되어야
if (getCurrentStep()?.id !== "auto_progress") {
  console.error(`FAIL: auto_progress에서 turn_run으로 advance됨`); process.exit(1);
}
advanceTutorial("day_end");
if (getCurrentStep()?.id !== "day_modal") {
  console.error(`FAIL: day_end 후 day_modal 아님, ${getCurrentStep()?.id}`); process.exit(1);
}
console.log(`  ✓ auto_progress → day_end → day_modal`);

// =====================================================================
// #8 + #9: 마지막 step → endTutorial + markCompleted
// =====================================================================
console.log("\n8+9. 마지막 step → endTutorial + localStorage='completed'");
advanceTutorial("manual");  // day_modal → complete
if (getCurrentStep()?.id !== "complete") {
  console.error(`FAIL: complete 아님, ${getCurrentStep()?.id}`); process.exit(1);
}
advanceTutorial("manual");  // complete → end
if (isTutorialActive()) {
  console.error(`FAIL: 마지막 step 후 active true`); process.exit(1);
}
if (!isTutorialCompleted()) {
  console.error(`FAIL: 마지막 step 후 completed false`); process.exit(1);
}
console.log(`  ✓ 마지막 step 후 active=false + localStorage=completed`);

// =====================================================================
// #10: skip 동작
// =====================================================================
console.log("\n10. skip 동작 (endTutorial)");
stored = {};
elements.clear();
startTutorial();
endTutorial();  // skip 버튼 효과
if (isTutorialActive()) {
  console.error(`FAIL: endTutorial 후 active true`); process.exit(1);
}
if (!isTutorialCompleted()) {
  console.error(`FAIL: endTutorial 후 completed false`); process.exit(1);
}
console.log(`  ✓ endTutorial = skip 동작 정상`);

// =====================================================================
// #11: playable_app.js 연결 확인
// =====================================================================
console.log("\n11. playable_app.js 연결 — import + 핸들러 후크");
const fs = await import("node:fs");
const source = fs.readFileSync(new URL("./playable_app.js", import.meta.url), "utf8");
for (const sym of ["startTutorial", "endTutorial", "advanceTutorial", "isTutorialActive", "isTutorialCompleted"]) {
  if (!source.includes(sym)) {
    console.error(`FAIL: ${sym} import/사용 없음`); process.exit(1);
  }
}
// 후크
if (!source.includes(`advanceTutorial("turn_run")`)) {
  console.error(`FAIL: runManualTurn에 turn_run 후크 없음`); process.exit(1);
}
if (!source.includes(`advanceTutorial("day_end")`)) {
  console.error(`FAIL: DAY 모달에 day_end 후크 없음`); process.exit(1);
}
// 튜토리얼 카드
if (!source.includes("__tutorial__")) {
  console.error(`FAIL: 튜토리얼 카드 mission id '__tutorial__' 없음`); process.exit(1);
}
if (!source.includes("tutorialMode")) {
  console.error(`FAIL: campaign.tutorialMode 핸들링 없음`); process.exit(1);
}
console.log(`  ✓ import + turn_run/day_end 후크 + 튜토리얼 카드 + tutorialMode 모두 연결`);

console.log("\n✓ tutorial smoke test passed");

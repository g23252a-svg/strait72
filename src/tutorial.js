// =====================================================================
// tutorial.js (v0.4.3)
// ---------------------------------------------------------------------
// 첫 플레이 안내 시스템.
//
// first_72h 미션을 베이스로 사용하고, 그 위에 인터랙티브 가이드 step을
// 얹어서 신규 플레이어가 게임 루프를 이해하도록 한다.
//
// 외부 API:
//   isTutorialCompleted() : bool
//   markTutorialCompleted() : void
//   resetTutorial() : void  (debug)
//   startTutorial(state, campaign) : void
//   advanceTutorial(reason) : void  ("manual" / "card_played" / "turn_run" / "day_end")
//   isTutorialActive() : bool
//   getCurrentStep() : step | null
//
// 사용 흐름:
//   1. 사용자가 진영 선택 모달에서 "튜토리얼" 카드 클릭
//   2. resetGame에서 first_72h 미션 적용 + tutorial active 플래그
//   3. startTutorial 호출 → 첫 step 오버레이 표시
//   4. 각 step의 advanceOn 조건에 맞으면 다음 step
//   5. 마지막 step → markTutorialCompleted + 일반 게임 진행
// =====================================================================

const STORAGE_KEY = "strait72.tutorial.v1";

let active = false;
let currentStepIdx = -1;
let stepOverlay = null;
let onAdvanceCallbacks = [];

const STEPS = [
  {
    id: "intro",
    title: "환영합니다",
    body: "해협의 72시간 — 대만 해협 위기를 다루는 비대칭 턴제 전략 게임입니다.<br><br>이 튜토리얼은 첫 72시간 미션을 통해 핵심 시스템 5가지를 안내합니다: <b>게이지 / 카드 / 지도 / 턴 진행 / DAY 보상</b>.",
    anchor: null,
    advanceOn: "manual",
    nextLabel: "시작"
  },
  {
    id: "gauges",
    title: "양 진영 게이지",
    body: "좌측 <b>중국</b>, 우측 <b>대만</b>의 핵심 자원이 표시됩니다.<br><br>- 작전 템포·보급력·정치 압박 (중국)<br>- 사기·정부·지휘·보급 (대만)<br><br>이 값들이 0이나 100에 도달하면 게임 결과에 직접 영향을 줍니다.",
    anchor: "chinaMeters",
    advanceOn: "manual",
    nextLabel: "다음"
  },
  {
    id: "cards",
    title: "작전 카드",
    body: "각 진영은 매 턴 카드를 뽑고, 일부를 사용할 수 있습니다.<br><br>카드에 마우스를 올리면 효과와 비용을 볼 수 있습니다. AI가 추천을 띄워주므로, 그대로 따라해도 됩니다.",
    anchor: "chinaAxisSelect",
    advanceOn: "manual",
    nextLabel: "다음"
  },
  {
    id: "map",
    title: "지도와 거점",
    body: "지도에서 거점을 클릭해 작전 대상을 지정합니다.<br><br>지룽·타이베이·가오슝 같은 항만/공항이 중요한 목표입니다. 중국이 1단계 상륙(<i>landing_attempt</i>)을 시도하면 위협 표시가 뜹니다.",
    anchor: "provinceSelect",
    advanceOn: "manual",
    nextLabel: "다음"
  },
  {
    id: "first_turn",
    title: "첫 턴 실행",
    body: "이제 첫 턴을 실행해봅시다.<br><br>화면 하단 <b>[턴 실행]</b> 버튼을 누르세요. 추천 작전이 자동 채워져 있으므로 그대로 진행하면 됩니다.",
    anchor: "runTurnBtn",
    advanceOn: "turn_run",
    nextLabel: null,  // 자동
    highlight: true
  },
  {
    id: "after_first_turn",
    title: "턴 결과",
    body: "턴이 끝나면 게이지가 변하고, 로그에 일어난 일이 기록됩니다. 점령 상황도 바뀌었을 수 있습니다.<br><br>이렇게 4턴(=1 DAY)마다 일일 보고서가 표시됩니다.",
    anchor: "logBox",
    advanceOn: "manual",
    nextLabel: "계속"
  },
  {
    id: "auto_progress",
    title: "자동 진행",
    body: "이제 직접 몇 턴 더 진행해보세요. <b>[턴 실행]</b>으로 한 턴씩, 또는 <b>[자동 진행]</b>으로 다음 DAY까지 진행할 수 있습니다.<br><br>DAY 1 종료 모달이 뜨면 다시 안내합니다.",
    anchor: "runTurnBtn",
    advanceOn: "day_end",
    nextLabel: null
  },
  {
    id: "day_modal",
    title: "DAY 보고서",
    body: "DAY 보고서에는 이번 24시간의 게이지 변화, 점령 변화, 발생한 국제 이벤트, 그리고 <b>오늘의 작전 목표</b>가 표시됩니다.<br><br>또한 매 DAY 끝에 보상 카드 3장 중 하나를 선택할 수 있습니다. 이를 잘 활용하면 후반에 유리합니다.",
    anchor: "dayEndOverlay",
    advanceOn: "manual",
    nextLabel: "이해했습니다"
  },
  {
    id: "complete",
    title: "튜토리얼 완료",
    body: "기본 시스템 안내를 마쳤습니다.<br><br>지금부터는 자유롭게 진행하세요. 미션을 끝까지 진행하면 결과 모달이 뜹니다.<br><br>다른 시나리오는 미션 모드에서 선택할 수 있습니다: <b>가오슝 방어</b>, <b>수도권 압박</b>, <b>봉쇄전</b>, <b>동맹 개입 후 반격</b>.",
    anchor: null,
    advanceOn: "manual",
    nextLabel: "닫기"
  }
];

// =====================================================================
// localStorage
// =====================================================================
export function isTutorialCompleted() {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "completed";
  } catch { return false; }
}

export function markTutorialCompleted() {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, "completed"); } catch {}
}

export function resetTutorial() {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// =====================================================================
// state
// =====================================================================
export function isTutorialActive() {
  return active;
}

export function getCurrentStep() {
  if (!active || currentStepIdx < 0 || currentStepIdx >= STEPS.length) return null;
  return STEPS[currentStepIdx];
}

export function getStepCount() {
  return STEPS.length;
}

// =====================================================================
// 시작 / 종료
// =====================================================================
export function startTutorial() {
  active = true;
  currentStepIdx = 0;
  renderStepOverlay();
}

export function endTutorial() {
  active = false;
  currentStepIdx = -1;
  removeStepOverlay();
  markTutorialCompleted();
}

// =====================================================================
// 진행
// =====================================================================
export function advanceTutorial(reason) {
  if (!active) return;
  const step = STEPS[currentStepIdx];
  if (!step) return;
  // step의 advanceOn 조건과 reason 일치 시 다음 step으로
  if (step.advanceOn !== reason) return;
  goToNextStep();
}

function goToNextStep() {
  removeStepOverlay();
  currentStepIdx++;
  if (currentStepIdx >= STEPS.length) {
    endTutorial();
    return;
  }
  renderStepOverlay();
}

export function onAdvance(cb) {
  onAdvanceCallbacks.push(cb);
}

// =====================================================================
// UI render
// =====================================================================
function renderStepOverlay() {
  removeStepOverlay();
  if (typeof document === "undefined") return;
  const step = STEPS[currentStepIdx];
  if (!step) return;

  const overlay = document.createElement("div");
  overlay.id = "tutorialStepOverlay";
  overlay.style.cssText = `
    position: fixed;
    bottom: 24px; right: 24px;
    max-width: 360px;
    background: rgba(13, 24, 42, 0.97);
    border: 2px solid #ffd66b;
    border-radius: 12px;
    padding: 16px 18px;
    color: #eaf3ff;
    box-shadow: 0 18px 50px rgba(0,0,0,.55);
    z-index: 6000;
    font-size: 13px;
    line-height: 1.5;
    animation: fadeIn .25s ease;
  `;

  const stepNum = currentStepIdx + 1;
  const total = STEPS.length;
  const nextBtn = step.nextLabel
    ? `<button class="tutorial-next-btn" style="
        background:#ffd66b;color:#1a1d2e;border:none;
        padding:7px 18px;border-radius:6px;
        font-weight:700;cursor:pointer;font-size:13px;
        margin-top:10px;
      ">${step.nextLabel}</button>`
    : `<div class="tutorial-waiting" style="
        font-size:11px;color:#ffd66b;margin-top:8px;font-style:italic;
      ">화면에서 조작을 완료해주세요…</div>`;

  const skipBtn = `<button class="tutorial-skip-btn" style="
    background:transparent;color:#93a8c2;border:1px solid #93a8c2;
    padding:5px 12px;border-radius:5px;
    font-size:11px;cursor:pointer;margin-top:8px;margin-left:8px;
  ">튜토리얼 건너뛰기</button>`;

  overlay.innerHTML = `
    <div style="font-size:11px;color:#ffd66b;margin-bottom:6px;letter-spacing:.5px;">
      튜토리얼 ${stepNum} / ${total}
    </div>
    <div style="font-size:15px;font-weight:700;color:#ffd66b;margin-bottom:8px;">
      ${step.title}
    </div>
    <div style="font-size:13px;color:#eaf3ff;">
      ${step.body}
    </div>
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:0;">
      ${nextBtn}
      ${skipBtn}
    </div>
  `;

  document.body.appendChild(overlay);
  stepOverlay = overlay;

  // 핸들러
  const nextEl = overlay.querySelector(".tutorial-next-btn");
  if (nextEl) {
    nextEl.addEventListener("click", () => goToNextStep());
  }
  const skipEl = overlay.querySelector(".tutorial-skip-btn");
  if (skipEl) {
    skipEl.addEventListener("click", () => endTutorial());
  }

  // anchor 강조 (있으면 외곽선 펄스)
  if (step.anchor && step.highlight) {
    const anchorEl = document.getElementById(step.anchor);
    if (anchorEl) {
      anchorEl.dataset.tutorialHighlight = "1";
      anchorEl.style.outline = "2px solid #ffd66b";
      anchorEl.style.outlineOffset = "3px";
      anchorEl.style.transition = "outline .2s";
    }
  }
}

function removeStepOverlay() {
  if (typeof document === "undefined") return;
  const ov = document.getElementById("tutorialStepOverlay");
  if (ov) ov.remove();
  // 강조 제거
  document.querySelectorAll("[data-tutorial-highlight]").forEach(el => {
    el.style.outline = "";
    el.style.outlineOffset = "";
    delete el.dataset.tutorialHighlight;
  });
  stepOverlay = null;
}

// 외부에서 step 정의 읽기 (smoke test 등)
export const TUTORIAL_STEPS = STEPS;

// =====================================================================
// playable_app.js
// ---------------------------------------------------------------------
// v0.3 HTML MVP 진입점.
// 기존 엔진(runTurn)을 그대로 사용하고, UI는 선택값을 decisions로 변환한다.
// =====================================================================

import { createInitialState, buildCardIndex, buildAxisIndex } from "./state.js";
import { runTurn } from "./turn_resolver.js";
import { suggestChinaAxis, suggestTaiwanFocus } from "./target_selector.js";
import { drawGameCanvas, hitTestProvince } from "./ui_canvas.js";
import { GAME_RULES, BUILD_TAG, BUILD_DATE, BUILD_FULL, TOTAL_GAME_HOURS, formatGameTime, formatTurnCounter, chinaHoursRemaining } from "./game_rules.js";
import { AXIS_DEFAULT_TARGETS, chooseBestTarget } from "./combat_resolver.js";
import { initializeDecks, DRAW_PER_TURN } from "./deck_state.js";
import { buildCardTooltipHTML } from "./card_tooltip.js";
import {
  chooseChinaCards as aiChooseChinaCards,
  chooseTaiwanCards as aiChooseTaiwanCards,
  pickSelectedProvince as aiPickSelectedProvince,
  decideChinaAxis,
  decideTaiwanFocus
} from "./ai_decisions.js";
import {
  SIDES, DIFFICULTIES,
  loadLastChoice, saveLastChoice,
  createCampaignState, isPlayerSide, isAISide
} from "./campaign_state.js";
import {
  TURNS_PER_DAY, dayNumberForTurn, isDayEndTurn,
  formatDayLabel, buildDayReport
} from "./day_cycle.js";
import {
  drawRewards, applyReward, describeRewardApplication
} from "./reward_system.js";
import {
  buildFinalReport, gradeFromScore, compressBreakdown
} from "./final_grade.js";

const DATA_PATHS = {
  axes: "./data/axes.json",
  provinces: "./data/provinces.json",
  cardsChina: "./data/cards_china.json",
  cardsTaiwan: "./data/cards_taiwan.json",
  events: "./data/events_global.json",
  rewards: "./data/rewards.json"
};

const dom = {};
let data = {};
let indices = {};
let state = null;
let campaign = null;  // v0.4.0-a: 진영/난이도
let selectedProvince = "keelung";
const recentUiPicks = { china: [], taiwan: [] };
let canvasLoopStarted = false;
// v0.4.0-b: DAY 진행
let dayAutoCloseEnabled = false;   // DAY 요약 자동 닫기 토글 (기본 OFF)
let pendingDayModal = false;       // DAY 모달이 떠 있는지
let autoToNextDayMode = false;     // "다음 DAY까지 자동 진행" 모드
let finalModalShown = false;       // v0.4.0-d2: 최종 결과 모달 1회 표시 guard

window.addEventListener("DOMContentLoaded", init);

// ---- 빌드 검증 ----
// 압축 해제 누락, 브라우저 캐시, 잘못된 폴더 등으로 옛 빌드가 조용히 로드되는 사고 방지.
const EXPECTED_BUILD = "v0.4.0-d4";
const EXPECTED_TOTAL_TURNS = 30;

function runBuildSelfCheck() {
  const errs = [];
  if (BUILD_TAG !== EXPECTED_BUILD) {
    errs.push(`BUILD_TAG mismatch: got "${BUILD_TAG}", expected "${EXPECTED_BUILD}"`);
  }
  if (GAME_RULES.totalTurns !== EXPECTED_TOTAL_TURNS) {
    errs.push(`totalTurns mismatch: got ${GAME_RULES.totalTurns}, expected ${EXPECTED_TOTAL_TURNS}`);
  }
  if (GAME_RULES.version !== EXPECTED_BUILD) {
    errs.push(`GAME_RULES.version mismatch: got "${GAME_RULES.version}", expected "${EXPECTED_BUILD}"`);
  }
  if (errs.length) {
    showBuildError(errs);
    throw new Error("WRONG BUILD LOADED\n" + errs.join("\n"));
  }
  console.log(`[Strait 72] build OK: ${BUILD_FULL} (${GAME_RULES.totalTurns} turns)`);
}

function showBuildError(errs) {
  const banner = document.createElement("div");
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #ff5964; color: #fff; padding: 18px 24px;
    font-family: monospace; font-size: 14px; font-weight: 700;
    box-shadow: 0 6px 30px rgba(0,0,0,.5);
  `;
  banner.innerHTML = `
    ⚠️ 잘못된 빌드가 로드되었습니다 (구버전 캐시 추정)<br>
    <small style="font-weight:400;">${errs.map(e => `• ${e}`).join("<br>")}</small><br>
    <small style="font-weight:400;">→ 압축 해제 위치 확인 후 브라우저에서 Ctrl+Shift+R로 하드 리프레시 하세요.</small>
  `;
  document.body.prepend(banner);
}

async function init() {
  try { runBuildSelfCheck(); } catch (e) {
    console.error(e);
    return;  // 잘못된 빌드면 더 진행 안 함
  }
  bindDom();
  renderBuildBadge();
  await loadData();

  // v0.4.0-a: 진영 선택 화면을 먼저 보여줌
  showSideSelectModal((selectedSide, difficulty) => {
    campaign = createCampaignState(selectedSide, difficulty);
    saveLastChoice(selectedSide, difficulty);
    resetGame();
    bindEvents();
    startCanvasLoop();
  });
}

function renderBuildBadge() {
  // 헤더 상단에 빌드 정보 표시 (사용자가 항상 어떤 빌드인지 알 수 있도록)
  const titleEl = document.querySelector(".title");
  if (!titleEl) return;
  const existing = titleEl.querySelector(".build-badge");
  if (existing) existing.remove();
  const badge = document.createElement("div");
  badge.className = "build-badge";
  badge.style.cssText = `
    margin-top: 4px; font-size: 11px; color: rgba(255,255,255,.55);
    letter-spacing: .3px; font-family: monospace;
  `;
  badge.textContent = `BUILD ${BUILD_FULL} · RULES ${GAME_RULES.totalTurns}턴 × ${GAME_RULES.hoursPerTurn}h`;
  titleEl.appendChild(badge);
}

// v0.4.0-a: 진영 선택 모달
function showSideSelectModal(onConfirm) {
  const last = loadLastChoice();
  const overlay = document.createElement("div");
  overlay.id = "sideSelectOverlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 5000;
    background: radial-gradient(ellipse at top, rgba(20,35,60,.96), rgba(3,8,18,.98));
    display: flex; align-items: center; justify-content: center;
    padding: 24px; overflow-y: auto;
  `;

  const sideButtons = Object.values(SIDES).map(s => `
    <button class="side-card" data-side="${s.id}">
      <div class="side-name">${s.name}</div>
      <div class="side-desc">${s.description}</div>
    </button>
  `).join("");

  const diffButtons = Object.values(DIFFICULTIES).map(d => `
    <button class="diff-pill" data-diff="${d.id}"${d.id === "normal" ? ' data-selected="true"' : ""}>
      ${d.name}
    </button>
  `).join("");

  const quickStartHtml = last ? `
    <div class="quick-start">
      <button id="quickStartBtn" class="primary">
        이전 설정으로 빠른 시작
        <span>${SIDES[last.side]?.name} · ${DIFFICULTIES[last.difficulty]?.name}</span>
      </button>
      <button id="newChoiceBtn" class="secondary">새로 선택하기</button>
    </div>
  ` : "";

  overlay.innerHTML = `
    <div class="side-modal">
      <h2>해협의 72시간</h2>
      <p class="subtitle">진영 선택</p>
      ${quickStartHtml}
      <div class="side-list" id="sideList">${sideButtons}</div>
      <div class="diff-group">
        <p class="diff-label">난이도 (v0.4.0-a에서는 UI만, 실 적용은 다음 패치)</p>
        <div class="diff-pills" id="diffPills">${diffButtons}</div>
      </div>
      <button id="startGameBtn" class="primary start-btn" disabled>시작</button>
    </div>

    <style>
      .side-modal {
        max-width: 580px; width: 100%;
        background: rgba(13, 24, 42, 0.96);
        border: 1px solid rgba(124, 171, 220, 0.32);
        border-radius: 18px;
        padding: 32px 28px;
        color: #eaf3ff;
        box-shadow: 0 30px 80px rgba(0,0,0,.6);
      }
      .side-modal h2 {
        margin: 0 0 4px;
        font-size: 26px;
        font-weight: 800;
        text-align: center;
        color: #ffd66b;
        letter-spacing: 1px;
      }
      .side-modal .subtitle {
        margin: 0 0 22px;
        text-align: center;
        color: rgba(234, 243, 255, .55);
        font-size: 12.5px;
        letter-spacing: 3px;
      }
      .side-modal .quick-start {
        display: grid; gap: 8px;
        margin-bottom: 22px;
        padding-bottom: 18px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      .side-modal .quick-start button.primary {
        display: flex; flex-direction: column; align-items: center;
        gap: 4px;
        background: linear-gradient(180deg, #5aa9ff, #3d83cf);
        color: #fff;
        border: 0;
        padding: 14px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
      }
      .side-modal .quick-start button.primary span {
        font-size: 11px;
        font-weight: 500;
        opacity: .85;
      }
      .side-modal .quick-start button.secondary {
        background: transparent;
        color: rgba(234,243,255,.55);
        border: 1px solid rgba(255,255,255,.12);
        padding: 8px;
        border-radius: 8px;
        font-size: 12px;
        cursor: pointer;
      }
      .side-modal .side-list {
        display: grid; gap: 10px;
        margin-bottom: 20px;
      }
      .side-modal .side-card {
        background: rgba(255,255,255,.04);
        border: 1.5px solid rgba(255,255,255,.10);
        border-radius: 12px;
        padding: 14px 16px;
        text-align: left;
        color: inherit;
        cursor: pointer;
        transition: all .15s;
      }
      .side-modal .side-card:hover {
        background: rgba(124, 171, 220, .12);
        border-color: rgba(124, 171, 220, .55);
      }
      .side-modal .side-card[data-selected="true"] {
        background: rgba(124, 171, 220, .20);
        border-color: #7cabdc;
        box-shadow: 0 0 0 1px #7cabdc inset;
      }
      .side-modal .side-name {
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 4px;
        color: #ffd66b;
      }
      .side-modal .side-desc {
        font-size: 11.5px;
        color: rgba(234,243,255,.72);
        line-height: 1.5;
      }
      .side-modal .diff-group { margin-bottom: 22px; }
      .side-modal .diff-label {
        font-size: 11px;
        color: rgba(234,243,255,.45);
        margin: 0 0 8px;
      }
      .side-modal .diff-pills {
        display: flex; gap: 8px;
      }
      .side-modal .diff-pill {
        flex: 1;
        background: rgba(255,255,255,.04);
        border: 1.5px solid rgba(255,255,255,.10);
        border-radius: 8px;
        padding: 9px;
        color: inherit;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all .15s;
      }
      .side-modal .diff-pill:hover { border-color: rgba(124, 171, 220, .55); }
      .side-modal .diff-pill[data-selected="true"] {
        background: rgba(124, 171, 220, .20);
        border-color: #7cabdc;
      }
      .side-modal .start-btn {
        width: 100%;
        background: linear-gradient(180deg, #ffd66b, #d9a939);
        color: #1a1408;
        border: 0;
        padding: 14px;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 800;
        cursor: pointer;
        letter-spacing: 1px;
        transition: opacity .15s;
      }
      .side-modal .start-btn:disabled {
        opacity: .4; cursor: not-allowed;
      }
    </style>
  `;
  document.body.appendChild(overlay);

  let selectedSide = null;
  let selectedDifficulty = "normal";
  const startBtn = overlay.querySelector("#startGameBtn");

  function updateStartBtnState() {
    startBtn.disabled = !selectedSide;
  }

  overlay.querySelector("#sideList").addEventListener("click", (e) => {
    const card = e.target.closest(".side-card");
    if (!card) return;
    overlay.querySelectorAll(".side-card").forEach(el => el.removeAttribute("data-selected"));
    card.setAttribute("data-selected", "true");
    selectedSide = card.dataset.side;
    updateStartBtnState();
  });

  overlay.querySelector("#diffPills").addEventListener("click", (e) => {
    const pill = e.target.closest(".diff-pill");
    if (!pill) return;
    overlay.querySelectorAll(".diff-pill").forEach(el => el.removeAttribute("data-selected"));
    pill.setAttribute("data-selected", "true");
    selectedDifficulty = pill.dataset.diff;
  });

  startBtn.addEventListener("click", () => {
    if (!selectedSide) return;
    overlay.remove();
    onConfirm(selectedSide, selectedDifficulty);
  });

  const quickBtn = overlay.querySelector("#quickStartBtn");
  if (quickBtn && last) {
    quickBtn.addEventListener("click", () => {
      overlay.remove();
      onConfirm(last.side, last.difficulty);
    });
  }
  const newBtn = overlay.querySelector("#newChoiceBtn");
  if (newBtn) {
    newBtn.addEventListener("click", () => {
      overlay.querySelector(".quick-start").style.display = "none";
    });
  }
}

function bindDom() {
  for (const id of [
    "turnCounter", "gameClock", "chinaClock", "outcomeChip",
    "chinaMeters", "taiwanMeters", "interventionMeters", "logBox",
    "chinaAxisSelect", "taiwanFocusSelect", "provinceSelect",
    "chinaCards", "taiwanCards", "runTurnBtn", "resetBtn",
    "suggestBtn", "autoTurnBtn", "mapCanvas"
  ]) {
    dom[id] = document.getElementById(id);
  }
}

async function loadData() {
  const entries = await Promise.all(
    Object.entries(DATA_PATHS).map(async ([key, path]) => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`failed to load ${path}`);
      return [key, await res.json()];
    })
  );
  data = Object.fromEntries(entries);
  indices = {
    cardIndex: buildCardIndex(data.cardsChina, data.cardsTaiwan),
    axisIndex: buildAxisIndex(data.axes),
    events: data.events
  };
}

function resetGame() {
  state = createInitialState({
    provinces: data.provinces,
    gameRules: GAME_RULES,
    axes: data.axes,
    cardsChina: data.cardsChina,
    cardsTaiwan: data.cardsTaiwan,
    events: data.events
  });
  initializeDecks(state, data.cardsChina, data.cardsTaiwan);
  // v0.4.0-d2: 재시작 시 final modal guard 리셋 + DAY pending 정리
  finalModalShown = false;
  pendingDayModal = false;
  autoToNextDayMode = false;
  // 혹시 남아있는 모달 제거
  const dayOv = document.getElementById("dayEndOverlay");
  if (dayOv) dayOv.remove();
  const finalOv = document.getElementById("finalResultOverlay");
  if (finalOv) finalOv.remove();
  selectedProvince = "keelung";
  fillSelectors();
  renderCampaignBadge();
  applySideLock();
  renderCards();
  applySuggestion(false);
  render();
}

// v0.4.0-a: 진영/난이도 배지를 헤더 빌드 배지 옆에 추가
function renderCampaignBadge() {
  const titleEl = document.querySelector(".title");
  if (!titleEl) return;
  let badge = titleEl.querySelector(".campaign-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "campaign-badge";
    badge.style.cssText = `
      margin-top: 4px; font-size: 11px;
      letter-spacing: .3px; font-family: monospace;
    `;
    titleEl.appendChild(badge);
  }
  if (!campaign) { badge.textContent = ""; return; }
  const sideName = SIDES[campaign.selectedSide]?.name || campaign.selectedSide;
  const diffName = DIFFICULTIES[campaign.difficulty]?.name || campaign.difficulty;
  let color = "#7cabdc";
  if (campaign.selectedSide === "taiwan") color = "#80efb1";
  else if (campaign.selectedSide === "china") color = "#ff8b94";
  else color = "rgba(255,255,255,.55)";
  badge.innerHTML = `<span style="color:${color};font-weight:700">▸ ${sideName}</span> <span style="color:rgba(255,255,255,.5)">· ${diffName}</span>`;
}

// v0.4.0-a: 진영별 UI 잠금 - 상대 진영의 카드/축/방어중점 숨김/비활성화
function applySideLock() {
  if (!campaign) return;
  const chinaIsAI = isAISide(campaign, "china");
  const taiwanIsAI = isAISide(campaign, "taiwan");

  // 중국 카드 패널
  const chinaCardsBox = dom.chinaCards?.closest(".pane") || dom.chinaCards?.parentElement;
  if (chinaIsAI) {
    setSideCovered("china", "비공개 작전 준비 중");
    dom.chinaAxisSelect?.setAttribute("disabled", "");
  } else {
    setSideCovered("china", null);
    dom.chinaAxisSelect?.removeAttribute("disabled");
  }

  // 대만 카드 패널
  if (taiwanIsAI) {
    setSideCovered("taiwan", "방어 태세 준비 중");
    dom.taiwanFocusSelect?.setAttribute("disabled", "");
  } else {
    setSideCovered("taiwan", null);
    dom.taiwanFocusSelect?.removeAttribute("disabled");
  }
}

function setSideCovered(side, message) {
  const cardsEl = side === "china" ? dom.chinaCards : dom.taiwanCards;
  if (!cardsEl) return;
  let cover = cardsEl.parentElement?.querySelector(`.side-cover[data-side="${side}"]`);
  if (!message) {
    if (cover) cover.remove();
    cardsEl.style.display = "";
    return;
  }
  cardsEl.style.display = "none";
  if (!cover) {
    cover = document.createElement("div");
    cover.className = "side-cover";
    cover.dataset.side = side;
    cover.style.cssText = `
      padding: 24px 16px; margin-top: 8px;
      background: linear-gradient(135deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
      border: 1px dashed rgba(255,255,255,.18);
      border-radius: 10px;
      text-align: center;
      color: rgba(234, 243, 255, .55);
      font-size: 13px;
      letter-spacing: .8px;
    `;
    cardsEl.parentElement?.appendChild(cover);
  }
  cover.innerHTML = `
    <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:6px;letter-spacing:2px;">${side === "china" ? "PLA" : "ROC"}</div>
    <div>${message}</div>
    <div style="font-size:10.5px;color:rgba(255,255,255,.32);margin-top:8px;">AI가 자동으로 작전을 결정합니다</div>
  `;
}

function bindEvents() {
  dom.runTurnBtn.addEventListener("click", () => runManualTurn());
  dom.autoTurnBtn.addEventListener("click", () => {
    applySuggestion(true);
    runManualTurn();
  });
  dom.resetBtn.addEventListener("click", () => {
    if (!confirm("현재 판을 버리고 새 게임을 시작할까요?")) return;
    // v0.4.0-a: 진영 선택 다시
    showSideSelectModal((selectedSide, difficulty) => {
      campaign = createCampaignState(selectedSide, difficulty);
      saveLastChoice(selectedSide, difficulty);
      resetGame();
      dom.runTurnBtn.disabled = false;
      dom.autoTurnBtn.disabled = false;
    });
  });
  dom.suggestBtn.addEventListener("click", () => {
    applySuggestion(true);
    render();
  });

  dom.provinceSelect.addEventListener("change", (e) => {
    selectedProvince = e.target.value;
    render();
  });

  dom.chinaAxisSelect.addEventListener("change", (e) => {
    const axisId = e.target.value;
    const candidates = AXIS_DEFAULT_TARGETS[axisId] || [];
    if (candidates.length === 0) {
      // 정보전/외교 축은 지역 무관 → selectedProvince는 그대로 유지
      render();
      return;
    }
    // 현재 선택 지역이 축 후보가 아니면 자동 추천 지역으로 변경
    if (!candidates.includes(selectedProvince)) {
      const axis = data.axes.find(a => a.id === axisId);
      const best = chooseBestTarget(state, candidates, axis) || candidates[0];
      if (best) {
        selectedProvince = best;
        dom.provinceSelect.value = best;
      }
    }
    render();
  });

  dom.mapCanvas.addEventListener("click", (event) => {
    const id = hitTestProvince(dom.mapCanvas, event);
    if (!id) return;
    selectedProvince = id;
    dom.provinceSelect.value = id;
    render();
  });

  // v0.3.9: 카드 hover 툴팁
  bindCardTooltipEvents();

  window.addEventListener("resize", render);
}

// v0.3.9: 카드 hover 시 툴팁 표시
function bindCardTooltipEvents() {
  // 단일 글로벌 tooltip 요소 생성
  let tt = document.getElementById("cardTooltip");
  if (!tt) {
    tt = document.createElement("div");
    tt.id = "cardTooltip";
    tt.className = "card-tooltip hidden";
    document.body.appendChild(tt);
  }

  let currentLabel = null;

  function show(label) {
    const cardId = label.dataset.cardId;
    if (!cardId || !indices?.cardIndex) return;
    const card = indices.cardIndex.get(cardId);
    if (!card) return;
    tt.innerHTML = buildCardTooltipHTML(card, state, card.side, data.provinces);
    tt.classList.remove("hidden");

    // 위치 계산: 카드 오른쪽 우선, 화면 밖이면 왼쪽
    const rect = label.getBoundingClientRect();
    const ttRect = tt.getBoundingClientRect();
    let left = rect.right + 8;
    if (left + ttRect.width > window.innerWidth - 8) {
      left = rect.left - ttRect.width - 8;
    }
    let top = rect.top;
    if (top + ttRect.height > window.innerHeight - 8) {
      top = window.innerHeight - ttRect.height - 8;
    }
    tt.style.left = Math.max(8, left) + "px";
    tt.style.top = Math.max(8, top) + "px";
  }

  function hide() {
    tt.classList.add("hidden");
  }

  document.addEventListener("mouseover", (e) => {
    const label = e.target.closest?.(".card-check");
    if (!label || label === currentLabel) return;
    currentLabel = label;
    show(label);
  });

  document.addEventListener("mouseout", (e) => {
    const label = e.target.closest?.(".card-check");
    if (!label) return;
    const movingTo = e.relatedTarget?.closest?.(".card-check");
    if (label !== movingTo) {
      if (currentLabel === label) currentLabel = null;
      if (!movingTo) hide();
    }
  });
}

function fillSelectors() {
  dom.chinaAxisSelect.innerHTML = data.axes.map(axis =>
    `<option value="${axis.id}">${axis.name}</option>`
  ).join("");

  dom.taiwanFocusSelect.innerHTML = data.provinces
    .filter(p => p.type !== "sea_zone")
    .map(p => `<option value="${p.id}">${p.name}</option>`)
    .join("");

  dom.provinceSelect.innerHTML = data.provinces.map(p =>
    `<option value="${p.id}">${p.name}</option>`
  ).join("");
  dom.provinceSelect.value = selectedProvince;
}

function renderCards() {
  const handCards = side => {
    const hand = state.decks?.[side]?.hand || [];
    return hand
      .map(id => indices.cardIndex.get(id))
      .filter(Boolean);
  };
  dom.chinaCards.innerHTML = renderCardsList("china", handCards("china"));
  dom.taiwanCards.innerHTML = renderCardsList("taiwan", handCards("taiwan"));
}

function renderCardsList(side, cards) {
  const d = state.decks?.[side];
  const status = d
    ? `<div class="hand-status">손패 ${d.hand.length}장 · 덱 ${d.deck.length}장 · 버림 ${d.discard.length}장</div>`
    : "";
  if (!cards.length) {
    return status + `<div class="empty-hand">손패가 비었습니다. 다음 턴 시작 시 ${DRAW_PER_TURN}장 드로우됩니다.</div>`;
  }
  return status + cards.map(cardCheckHtml).join("");
}

function cardCheckHtml(card) {
  const axis = card.preferredAxis ? ` · ${axisName(card.preferredAxis)}` : "";
  const type = card.type || "card";
  return `
    <label class="card-check" data-card-id="${card.id}">
      <input type="checkbox" value="${card.id}" data-side="${card.side}" />
      <span>
        <strong>${card.name}</strong>
        <span>${type}${axis}</span>
      </span>
    </label>
  `;
}

function syncSelectedProvinceToAxis(axisId) {
  const candidates = AXIS_DEFAULT_TARGETS[axisId] || [];
  if (!candidates.length) return;
  if (candidates.includes(selectedProvince)) return;
  const axis = data.axes.find(a => a.id === axisId);
  const best = chooseBestTarget(state, candidates, axis) || candidates[0];
  if (best) {
    selectedProvince = best;
    dom.provinceSelect.value = best;
  }
}


function applySuggestion(selectCards = true) {
  // suggestChinaAxis 반환: { axisId, scores }
  // suggestTaiwanFocus 반환: { focus, mode, scores } | null
  const axisRec = suggestChinaAxis(state, data.axes);
  const focusRec = suggestTaiwanFocus(state);
  const axisId = axisRec?.axisId || null;
  const focusId = focusRec?.focus || null;

  if (axisId) {
    dom.chinaAxisSelect.value = axisId;
    syncSelectedProvinceToAxis(axisId);
  }
  // focusId가 region 태그(north/south/...)일 수도 있어서 select option 존재 시에만 반영
  if (focusId && dom.taiwanFocusSelect.querySelector(`option[value="${focusId}"]`)) {
    dom.taiwanFocusSelect.value = focusId;
  }

  if (selectCards) {
    clearCardChecks();
    // v0.4.0-a: AI 측은 카드 보이지 않으니 자동 선택 의미 없음 (run시 덮어씀)
    const chinaPlayable = !campaign || !isAISide(campaign, "china");
    const taiwanPlayable = !campaign || !isAISide(campaign, "taiwan");
    if (chinaPlayable && axisId) autoPickCards("china", axisId);
    if (taiwanPlayable && focusId) autoPickCards("taiwan", focusId);
  }
}

function clearCardChecks() {
  document.querySelectorAll("input[type=checkbox][data-side]").forEach(el => { el.checked = false; });
}

function autoPickCards(side, context) {
  // v0.3.6: 전체 카드 풀이 아닌 현재 손패에서만 선택
  const handIds = state.decks?.[side]?.hand || [];
  const cards = handIds.map(id => indices.cardIndex.get(id)).filter(Boolean);
  const selector = side === "china" ? "#chinaCards input" : "#taiwanCards input";

  // v0.3.8c: 대만 수도권 위기 감지 - 카드 우선순위 조정 (focus는 변경 X)
  const stages = ["none", "sea_superiority", "landing_attempt", "beachhead", "inland_expansion"];
  const sIdx = (p) => p ? stages.indexOf(p.landingStage || "none") : 0;
  const capitalCrisis = side === "taiwan" && (
    sIdx(state.provinces?.taipei) >= 1 ||
    sIdx(state.provinces?.keelung) >= 3 ||
    sIdx(state.provinces?.taoyuan) >= 3 ||
    (state.persistent?.capitalPressureTurns || 0) >= 1
  );
  // 위기 시 카드별 가중치 (북부방어 최우선, 외교 후순위)
  const crisisBonus = {
    "taiwan_north_defense_buildup": 12,
    "taiwan_mobile_reserve_deploy": 10,
    "taiwan_backup_network": 8,
    "taiwan_emergency_restoration": 6,
    "taiwan_president_speech": 4,
    "taiwan_international_appeal": 3
  };

  const recent = recentUiPicks[side] || [];
  const scored = cards.map(card => {
    let score = 0;
    if (side === "china" && card.preferredAxis === context) score += 5;
    if (side === "china" && ["attack", "ranged", "standard"].includes(card.type)) score += 2;
    if (side === "taiwan" && Array.isArray(card.target) && card.target.includes(context)) score += 5;
    if (side === "taiwan" && ["defense_buff", "counterplay", "diplomacy", "rally"].includes(card.type)) score += 2;
    if (card.type === "bluff") score -= 1; // v0.3에서는 블러프 해석 미구현이라 우선순위 낮춤

    // v0.3.8c: 수도권 위기 시 카드별 가중치 적용
    if (capitalCrisis && crisisBonus[card.id]) score += crisisBonus[card.id];

    // 같은 카드 추천 반복 완화. 최근 2턴에 쓴 카드는 강하게 감점.
    const lastIdx = recent.lastIndexOf(card.id);
    if (lastIdx >= 0) score -= Math.max(1.5, 4 - (recent.length - 1 - lastIdx));

    // 완전 동점일 때 항상 앞 카드만 잡히는 문제 완화용 미세 회전값.
    score += ((hashString(card.id) + state.turn) % 7) * 0.03;
    return { card, score };
  }).sort((a, b) => b.score - a.score).slice(0, 2);

  const ids = new Set(scored.map(x => x.card.id));
  document.querySelectorAll(selector).forEach(el => { el.checked = ids.has(el.value); });
}

function runManualTurn() {
  if (state.outcome) return;

  const decisions = {
    chinaAxis: dom.chinaAxisSelect.value,
    taiwanFocus: dom.taiwanFocusSelect.value,
    selectedProvince,
    chinaCards: checkedCardIds("china"),
    taiwanCards: checkedCardIds("taiwan")
  };

  // v0.4.0-a: AI 측이면 결정을 자동으로 덮어씀
  if (campaign && isAISide(campaign, "china")) {
    const axisId = decideChinaAxis(state, data.axes);
    decisions.chinaAxis = axisId;
    decisions.chinaCards = aiChooseChinaCards(state, axisId, indices.cardIndex);
    // selectedProvince는 대만 focus 우선, 아니면 AI 추천 지역
    if (campaign.selectedSide === "china") {
      // 중국 플레이어 → selectedProvince는 플레이어가 고름, 유지
    } else {
      // 양쪽 AI 또는 대만 플레이어 → AI 추천 사용
      const focusObj = { focus: decisions.taiwanFocus, mode: "province" };
      decisions.selectedProvince = aiPickSelectedProvince(state, axisId, focusObj, indices.axisIndex) || decisions.selectedProvince;
    }
  }
  if (campaign && isAISide(campaign, "taiwan")) {
    const { focus, focusId } = decideTaiwanFocus(state);
    decisions.taiwanFocus = focusId;
    decisions.taiwanCards = aiChooseTaiwanCards(state, decisions.chinaAxis, focus, indices.cardIndex);
  }

  rememberPicks("china", decisions.chinaCards);
  rememberPicks("taiwan", decisions.taiwanCards);

  runTurn(state, decisions, indices);
  if (state.outcome) {
    dom.runTurnBtn.disabled = true;
    dom.autoTurnBtn.disabled = true;
  }
  clearCardChecks();
  renderCards();
  applySuggestion(false);
  render();

  // v0.4.0-d2: outcome 발생 시 final 우선. DAY 모달은 막고 자동 모드도 중단.
  if (state.outcome && !finalModalShown) {
    autoToNextDayMode = false;
    closeDayModalIfOpen();
    showFinalResultModal();
    return;
  }

  // v0.4.0-b: DAY 종료 체크. 마지막 진행 턴(turn 1 증가 전이므로 state.turn - 1 또는 outcome 후 state.turn)이 4의 배수면 모달.
  // runTurn 끝나면 state.turn이 +1 된 상태. 방금 끝난 턴 = state.turn - 1.
  const justFinishedTurn = state.turn - 1;
  if (!state.outcome && isDayEndTurn(justFinishedTurn)) {
    const dayN = dayNumberForTurn(justFinishedTurn);
    showDayEndModal(dayN);
  }
}

// v0.4.0-d2: DAY modal이 떠 있으면 강제로 닫음 (final이 우선일 때)
function closeDayModalIfOpen() {
  const overlay = document.getElementById("dayEndOverlay");
  if (overlay) {
    overlay.remove();
    pendingDayModal = false;
  }
}

function rememberPicks(side, ids) {
  recentUiPicks[side].push(...ids);
  if (recentUiPicks[side].length > 8) {
    recentUiPicks[side] = recentUiPicks[side].slice(-8);
  }
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function checkedCardIds(side) {
  return Array.from(document.querySelectorAll(`input[data-side="${side}"]:checked`))
    .map(el => el.value)
    .slice(0, 2);
}

function render() {
  if (!state) return;
  dom.turnCounter.textContent = formatTurnCounter(state.turn);
  dom.gameClock.textContent = formatGameTime(state.turn);
  dom.chinaClock.textContent = `${chinaHoursRemaining(state.turn)}h`;
  dom.outcomeChip.textContent = state.outcome
    ? outcomeLabel(state.outcome)
    : (state.persistent?.alliedIntervention?.active ? "동맹 개입 후 교전" : "진행 중");
  dom.outcomeChip.className = state.outcome?.startsWith("china")
    ? "chip danger"
    : state.outcome
      ? "chip ok"
      : (state.persistent?.alliedIntervention?.active ? "chip amber" : "chip");

  dom.chinaMeters.innerHTML = [
    meter("작전 템포", state.gauges.chinaTempo, "red"),
    meter("보급력", state.gauges.chinaSupply, "red"),
    meter("정치 압박", state.gauges.chinaPoliticalPressure, "amber"),
    smallResource("예비 병력", state.gauges.chinaReserveTroops)
  ].join("");

  dom.taiwanMeters.innerHTML = [
    meter("정부 기능", state.gauges.taiwanGovernment, "green"),
    meter("국민 사기", state.gauges.taiwanMorale, "green"),
    meter("지휘 체계", state.gauges.taiwanCommand, "green"),
    meter("보급 상태", state.gauges.taiwanSupply, "green"),
    smallResource("예비군", state.gauges.taiwanReserveTroops),
    smallResource("국제 요청", state.gauges.taiwanInternationalRequest)
  ].join("");

  dom.interventionMeters.innerHTML = [
    meter("미국 개입도", state.gauges.usIntervention, "red"),
    meter("일본 개입도", state.gauges.japanIntervention, "amber"),
    meter("한국 후방지원", state.gauges.koreaRearSupport, "blue"),
    meter("국제 여론", state.gauges.internationalOpinion, "green")
  ].join("");

  renderLog();

  drawCanvasOnly();
}

function drawCanvasOnly() {
  if (!state || !dom.mapCanvas) return;
  const axis = data.axes.find(a => a.id === dom.chinaAxisSelect.value);
  const focus = data.provinces.find(p => p.id === dom.taiwanFocusSelect.value);
  drawGameCanvas(dom.mapCanvas, state, {
    selectedProvince,
    turnText: formatTurnCounter(state.turn),
    axisName: axis?.name,
    focusName: focus?.name
  });
}

function startCanvasLoop() {
  if (canvasLoopStarted) return;
  canvasLoopStarted = true;
  let last = 0;
  const loop = (ts) => {
    if (ts - last > 120) {
      drawCanvasOnly();
      last = ts;
    }
    window.requestAnimationFrame(loop);
  };
  window.requestAnimationFrame(loop);
}

function meter(label, value, color = "blue") {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return `
    <div class="meter">
      <div class="meter-row"><span>${label}</span><strong>${safe.toFixed(0)}</strong></div>
      <div class="bar ${color}"><i style="width:${safe}%"></i></div>
    </div>
  `;
}

function smallResource(label, value) {
  return `<div class="meter-row" style="margin-top:7px;"><span>${label}</span><strong>${value ?? 0}</strong></div>`;
}

function renderLog() {
  if (!state) {
    dom.logBox.innerHTML = "<p>아직 로그가 없습니다.</p>";
    return;
  }

  const summaries = buildTurnSummaries(state);
  const turnNumbers = Object.keys(summaries).map(Number).sort((a, b) => b - a); // 최신 턴이 위

  if (!turnNumbers.length) {
    dom.logBox.innerHTML = "<p>아직 진행된 턴이 없습니다. '턴 실행' 또는 '자동 1턴 진행'을 눌러보세요.</p>";
    return;
  }

  const blocks = turnNumbers.map((turn, idx) => renderTurnBlock(turn, summaries, idx === 0));
  dom.logBox.innerHTML = blocks.join("");
}

function buildTurnSummaries(state) {
  const byTurn = {};
  for (const entry of state.log) {
    const t = entry.turn;
    if (!byTurn[t]) {
      byTurn[t] = {
        snapshotBefore: null,
        operations: [],
        events: [],
        outcome: null,
        chinaAxis: null,
        taiwanFocus: null,
        placed: null
      };
    }
    const slot = byTurn[t];
    if (entry.phase === 1 && entry.snapshot) slot.snapshotBefore = entry.snapshot;
    if (entry.phase === 2) {
      slot.chinaAxis = entry.chinaAxis;
      slot.taiwanFocus = entry.taiwanFocus;
    }
    if (entry.phase === 3 && entry.placed) slot.placed = entry.placed;
    if (entry.phase === 4 && entry.operations) slot.operations.push(...entry.operations);
    if (typeof entry.name === "string" && entry.name.startsWith("intervention_") && entry.triggeredEvents) {
      // 같은 턴 안에서 동일 이벤트가 두 번 표시되는 UI 중복 방지
      for (const eventId of entry.triggeredEvents) {
        if (!slot.events.includes(eventId)) slot.events.push(eventId);
      }
    }
    if (entry.phase === 7 && entry.outcome) slot.outcome = entry.outcome;
  }
  return byTurn;
}

function renderTurnBlock(turn, summaries, isCurrent) {
  const s = summaries[turn];
  const nextSnapshot = summaries[turn + 1]?.snapshotBefore || state.gauges;
  const deltas = computeGaugeDeltas(s.snapshotBefore || {}, nextSnapshot);

  const headerCls = isCurrent ? "log-turn-header current" : "log-turn-header";
  const blockCls = isCurrent ? "log-turn current" : "log-turn";
  const axisChip = s.chinaAxis ? `<span class="log-chip axis">${axisName(s.chinaAxis)}</span>` : "";
  const focusChip = s.taiwanFocus ? `<span class="log-chip focus">방어: ${focusLabel(s.taiwanFocus)}</span>` : "";

  const header = `
    <div class="${headerCls}">
      <span>T${turn} · ${formatGameTime(turn)}</span>
      ${axisChip}${focusChip}
    </div>
  `;

  // 작전 라인 분류: 핵심(성공/실패) vs 일반
  // v0.3.8d: "보류: 유효한 지역 타깃 없음" 다중 라인을 1줄 요약으로 묶음
  const transformedOps = transformOperationsForDisplay(s.operations || [], turn);
  const opsLines = transformedOps.map(line => {
    const klass = classifyOperationLine(line);
    return `<p class="log-op ${klass}">${escapeHtml(line)}</p>`;
  }).join("");

  const eventsHtml = s.events.length
    ? `<p class="log-event">📣 이벤트: ${s.events.map(eventName).map(escapeHtml).join(" · ")}</p>`
    : "";

  const deltaHtml = deltas.length
    ? `<p class="log-delta">📊 ${deltas.join(" ")}</p>`
    : "";

  const outcomeHtml = s.outcome
    ? `<p class="log-outcome">🏁 ${outcomeLabel(s.outcome)}</p>`
    : "";

  // 비핵심 턴은 접기: 현재 턴 외에는 operations 중 카드/축 행만 표시
  return `<div class="${blockCls}">${header}${opsLines}${eventsHtml}${deltaHtml}${outcomeHtml}</div>`;
}

function classifyOperationLine(line) {
  if (line.includes("작전 재조정")) return "warn";
  if (line.includes("덱 소진")) return "info";
  if (line.includes("성공:")) return "ok";
  if (line.includes("실패:")) return "danger";
  if (line.includes("카운터플레이")) return "warn";
  if (line.includes("이벤트 발동")) return "event";
  if (line.includes("상륙 진척")) return "danger";
  if (line.includes("상륙 후퇴")) return "ok";
  if (line.includes("주공축 발동")) return "axis";
  return "";
}

/**
 * v0.3.8d: 사용자 로그를 더 읽기 좋게 변환.
 * - "X 보류: 유효한 지역 타깃 없음" 다중 라인을 → "중국군, 작전 재조정 중 (X, Y)" 1줄로 묶음.
 * - 원본 라인 자체는 state.log에 그대로 남아 있어 디버그/시뮬에는 영향 없음.
 */
function transformOperationsForDisplay(ops, turn) {
  const out = [];
  const reserved = [];
  for (const line of ops) {
    if (line.includes("덱 소진") && line.includes("셔플 복귀")) {
      continue;
    }
    if (line.includes("보상 효과 (")) {
      continue;
    }
    if (line.includes("보류: 유효한 지역 타깃 없음")) {
      // "<작전명> 보류: ..." → 작전명만 추출
      const match = line.match(/^(.+?)\s+보류:/);
      if (match) reserved.push(match[1]);
      continue;
    }
    out.push(line);
  }
  if (reserved.length) {
    const uniq = [...new Set(reserved)]
      .filter(name => !wasOperationReplannedEarlierThisDay(name, turn));
    if (uniq.length) out.push(`중국군, 작전 재조정 중 (${uniq.join(", ")})`);
  }
  return out;
}

function wasOperationReplannedEarlierThisDay(operationName, turn) {
  if (!turn || !operationName) return false;
  const day = dayNumberForTurn(turn);
  const turnStart = (day - 1) * TURNS_PER_DAY + 1;
  for (const entry of state.log || []) {
    if (entry.turn < turnStart || entry.turn >= turn) continue;
    if (entry.phase !== 4 || !Array.isArray(entry.operations)) continue;
    if (entry.operations.some(line => line.startsWith(`${operationName} 보류:`))) {
      return true;
    }
  }
  return false;
}

function computeGaugeDeltas(before, after) {
  const watched = [
    ["chinaPoliticalPressure", "정치압박", "china"],
    ["usIntervention", "미국", "taiwan"],
    ["japanIntervention", "일본", "taiwan"],
    ["koreaRearSupport", "한국", "taiwan"],
    ["taiwanGovernment", "정부", "taiwan"],
    ["taiwanMorale", "사기", "taiwan"],
    ["taiwanCommand", "지휘", "taiwan"],
    ["taiwanSupply", "보급", "taiwan"]
  ];
  const out = [];
  for (const [key, label, beneficiary] of watched) {
    const a = Number(before[key] ?? 0);
    const b = Number(after[key] ?? 0);
    if (Math.abs(b - a) < 0.5) continue;
    const diff = b - a;
    const sign = diff > 0 ? "+" : "";
    // 색상: 중국에게 유리한 변화 = red 방향, 대만 = green
    const chinaGood = (beneficiary === "china" && diff > 0) || (beneficiary === "taiwan" && diff < 0);
    const cls = chinaGood ? "down" : "up";
    out.push(`<span class="delta ${cls}">${label} ${sign}${Math.round(diff)}</span>`);
  }
  return out;
}

function eventName(id) {
  return data.events?.find(e => e.id === id)?.name || id;
}

function focusLabel(focus) {
  if (!focus) return "-";
  const prov = data.provinces?.find(p => p.id === focus);
  if (prov) return prov.name;
  const regionMap = { north: "북부", central: "중부", south: "남부", east: "동부" };
  return regionMap[focus] || focus;
}

function axisName(id) {
  return data.axes.find(a => a.id === id)?.name || id;
}

function formatSurvivalDuration() {
  const days = TOTAL_GAME_HOURS / 24;
  const label = Number.isInteger(days) ? `${days}일` : `${days.toFixed(1)}일`;
  return `${GAME_RULES.totalTurns}턴 / ${label}`;
}

function outcomeLabel(id) {
  const labels = {
    china_surrender_win: "중국 승리: 정부 기능 붕괴",
    china_blockade_win: "중국 승리: 봉쇄 성공",
    china_capital_win: "중국 승리: 수도 장악",
    china_capital_pressure_win: "중국 승리: 수도권 압박",
        taiwan_political_collapse_win: "대만 승리: 중국 정치압박 붕괴",
    taiwan_survival_win: state?.persistent?.alliedIntervention?.active ? `대만 승리: 동맹 개입 후 ${formatSurvivalDuration()} 생존` : `대만 승리: ${formatSurvivalDuration()} 생존`
  };
  return labels[id] || id;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderDayProgressLines(progress = {}) {
  const lines = [];
  const deck = progress.deckReshuffles || { total: 0, bySide: [] };
  const deckDetail = (deck.bySide || [])
    .map(s => `${s.side} ${s.count}회${s.cards ? ` (${s.cards}장)` : ""}`)
    .join(" / ");
  lines.push(`<li>덱 셔플 복귀: <b>${deck.total || 0}회</b>${deckDetail ? ` <span class="muted">${escapeHtml(deckDetail)}</span>` : ""}</li>`);

  const replans = progress.operationReplans || { total: 0, byOperation: [] };
  const replanDetail = (replans.byOperation || [])
    .map(o => `${o.name} ${o.count}회`)
    .join(" / ");
  lines.push(`<li>작전 재조정: <b>${replans.total || 0}회</b>${replanDetail ? ` <span class="muted">${escapeHtml(replanDetail)}</span>` : ""}</li>`);

  const rewards = progress.persistentRewardTotals || [];
  if (!rewards.length) {
    lines.push(`<li>활성 영구 보상 누적: <span class="muted">없음</span></li>`);
  } else {
    for (const reward of rewards) {
      const totals = Object.entries(reward.totals || {})
        .filter(([, delta]) => Number(delta) !== 0)
        .map(([key, delta]) => `${gaugeLabel(key)} ${delta > 0 ? "+" : ""}${Math.round(delta)}`)
        .join(", ");
      if (totals) {
        lines.push(`<li>활성 영구 보상 누적 (${escapeHtml(reward.rewardName)}): <b>${escapeHtml(totals)}</b></li>`);
      }
    }
  }
  return lines.join("");
}

function gaugeLabel(key) {
  const labels = {
    chinaTempo: "중국 작전 템포",
    chinaSupply: "중국 보급",
    chinaPoliticalPressure: "중국 정치압박",
    taiwanGovernment: "대만 정부",
    taiwanMorale: "대만 사기",
    taiwanCommand: "대만 지휘",
    taiwanSupply: "대만 보급",
    usIntervention: "미국 개입",
    japanIntervention: "일본 개입",
    koreaRearSupport: "한국 후방지원",
    internationalOpinion: "국제 여론"
  };
  return labels[key] || key;
}

// =====================================================================
// v0.4.0-b: DAY 종료 모달
// =====================================================================

function showDayEndModal(dayNumber) {
  const report = buildDayReport(state, dayNumber, data.events || []);
  pendingDayModal = true;

  // v0.4.0-c1: 플레이어 진영의 보상 3개 추첨 (양쪽 보기 모드도 일단 대만 기준)
  const playerSide = (campaign?.selectedSide === "china") ? "china" : "taiwan";
  const rewardsAll = data.rewards?.rewards || [];
  const drawnRewards = drawRewards(rewardsAll, playerSide, state, report, 3);
  let selectedRewardId = null;

  const overlay = document.createElement("div");
  overlay.id = "dayEndOverlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 4000;
    background: rgba(3, 8, 18, .88);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 24px; overflow-y: auto;
    animation: fadeIn .2s ease;
  `;

  // 게이지 델타 라인
  const gaugeLines = Object.values(report.gaugeDeltas)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map(g => {
      const sign = g.delta > 0 ? "+" : "";
      const cls = g.delta > 0 ? "pos" : "neg";
      let sideColor = "var(--text)";
      if (g.side === "china") sideColor = "#ff8b94";
      else if (g.side === "taiwan") sideColor = "#80efb1";
      else if (g.side === "ally") sideColor = "#7cabdc";
      return `<li><span style="color:${sideColor}">${escapeHtml(g.label)}</span> <span class="${cls}">${sign}${g.delta}</span> <span class="muted">(${g.before}→${g.after})</span></li>`;
    }).join("");

  const occupationLines = report.occupationChanges.map(c => {
    const tagClass = c.isLoss ? "occu-loss" : c.isRecover ? "occu-recover" : "occu-neutral";
    return `<li class="${tagClass}">${escapeHtml(c.name)}: ${escapeHtml(c.before)} → <b>${escapeHtml(c.after)}</b></li>`;
  }).join("");

  const eventLines = report.events.map(e => `<li>📣 ${escapeHtml(e)}</li>`).join("");
  const battleLines = report.majorBattles.map(b => `<li>⚔ T${b.turn} ${escapeHtml(b.text)}</li>`).join("");
  const dayProgressLines = renderDayProgressLines(report.dayProgress);

  // 진영별 해석 (양쪽 모드면 both 우선, 아니면 선택 진영)
  let interpretationText = "";
  if (campaign?.selectedSide === "taiwan") interpretationText = report.interpretation.taiwan;
  else if (campaign?.selectedSide === "china") interpretationText = report.interpretation.china;
  else interpretationText = report.interpretation.both + " / 대만: " + report.interpretation.taiwan + " / 중국: " + report.interpretation.china;

  overlay.innerHTML = `
    <div class="day-modal">
      <div class="day-header">
        <h2>${escapeHtml(report.dayLabel)} 종료</h2>
        <p class="day-subtitle">T${report.turnRange[0]}-${report.turnRange[1]} 진행 완료</p>
      </div>

      ${occupationLines ? `<section><h3>점령 변화</h3><ul class="occu-list">${occupationLines}</ul></section>` : ""}
      <section class="day-progress-section"><h3>이번 DAY 진행</h3><ul class="day-progress-list">${dayProgressLines}</ul></section>
      ${battleLines ? `<section><h3>주요 전투</h3><ul>${battleLines}</ul></section>` : ""}
      ${eventLines ? `<section><h3>국제 이벤트</h3><ul class="event-list">${eventLines}</ul></section>` : ""}

      <section><h3>게이지 변화</h3><ul class="gauge-list">${gaugeLines || "<li class=\"muted\">변화 없음</li>"}</ul></section>

      <section class="interp-box">
        <h3>${campaign?.selectedSide === "both" ? "양측 분석" : SIDES[campaign?.selectedSide]?.name + " 관점"}</h3>
        <p>${escapeHtml(interpretationText)}</p>
      </section>

      ${drawnRewards.length ? `
      <section class="reward-section">
        <h3>보상 선택 (필수)</h3>
        <p class="reward-hint">${describeRewardCategorySummary(drawnRewards)}</p>
        <div class="reward-list" id="rewardList">
          ${drawnRewards.map(r => renderRewardCard(r)).join("")}
        </div>
      </section>
      ` : ""}

      <div class="day-controls">
        <button id="dayContinueBtn" class="primary" disabled>${drawnRewards.length ? "보상 선택 → 다음 날" : "다음 날 계속"}</button>
        <button id="dayAutoBtn" class="secondary" disabled>다음 DAY까지 자동 진행</button>
        <label class="auto-close-toggle">
          <input type="checkbox" id="dayAutoCloseToggle" ${dayAutoCloseEnabled ? "checked" : ""} />
          DAY 요약 자동 닫기
        </label>
      </div>
    </div>

    <style>
      @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      .day-modal {
        max-width: 620px; width: 100%;
        background: linear-gradient(180deg, rgba(13, 28, 50, .98), rgba(8, 18, 34, .98));
        border: 1px solid rgba(124, 171, 220, 0.35);
        border-radius: 18px;
        padding: 26px 28px 22px;
        color: #eaf3ff;
        box-shadow: 0 30px 80px rgba(0,0,0,.7);
        /* v0.4.0-c2-b3-3b: 화면 짤림 방지 — 모달 자체 max-height + overflow */
        max-height: calc(100vh - 48px);
        overflow-y: auto;
        margin: auto 0;
      }
      /* 모달 내부 스크롤바 디자인 (어두운 테마 일치) */
      .day-modal::-webkit-scrollbar { width: 8px; }
      .day-modal::-webkit-scrollbar-thumb {
        background: rgba(124, 171, 220, .25);
        border-radius: 4px;
      }
      .day-modal::-webkit-scrollbar-thumb:hover { background: rgba(124, 171, 220, .45); }
      .day-header { text-align: center; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 14px; margin-bottom: 16px; }
      .day-header h2 { margin: 0; font-size: 22px; font-weight: 800; color: #ffd66b; letter-spacing: 1px; }
      .day-subtitle { margin: 4px 0 0; font-size: 11.5px; color: rgba(234, 243, 255, .55); letter-spacing: 1.5px; }
      .day-modal section { margin-bottom: 14px; }
      .day-modal h3 { margin: 0 0 7px; font-size: 12px; color: #7cabdc; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; }
      .day-modal ul { list-style: none; padding: 0; margin: 0; font-size: 13px; line-height: 1.7; }
      .day-modal .pos { color: #80efb1; font-weight: 700; }
      .day-modal .neg { color: #ff8b94; font-weight: 700; }
      .day-modal .muted { color: rgba(234, 243, 255, .45); font-size: 11px; }
      .day-modal .gauge-list li { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .day-modal .day-progress-section {
        background: rgba(124, 171, 220, .08);
        border: 1px solid rgba(124, 171, 220, .18);
        border-radius: 8px;
        padding: 10px 12px;
      }
      .day-modal .day-progress-list li { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .day-modal .occu-list .occu-loss { color: #ff8b94; }
      .day-modal .occu-list .occu-recover { color: #80efb1; }
      .day-modal .interp-box {
        background: rgba(255, 214, 107, .07);
        border-left: 3px solid #ffd66b;
        padding: 10px 14px;
        border-radius: 6px;
      }
      .day-modal .interp-box p { margin: 0; font-size: 13px; line-height: 1.6; color: rgba(234, 243, 255, .9); }
      .day-controls { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; align-items: center; }
      .day-controls .primary {
        flex: 1; min-width: 140px;
        background: linear-gradient(180deg, #ffd66b, #d9a939);
        color: #1a1408; border: 0;
        padding: 12px; border-radius: 10px;
        font-size: 13px; font-weight: 800; cursor: pointer;
        letter-spacing: 1px;
      }
      .day-controls .secondary {
        flex: 1; min-width: 140px;
        background: rgba(124, 171, 220, .15);
        color: #eaf3ff; border: 1px solid #7cabdc;
        padding: 12px; border-radius: 10px;
        font-size: 12.5px; font-weight: 700; cursor: pointer;
      }
      .day-controls .auto-close-toggle {
        font-size: 11.5px; color: rgba(234, 243, 255, .65);
        cursor: pointer; user-select: none;
        flex: 0 0 100%; text-align: center;
        margin-top: 4px;
      }

      /* v0.4.0-c1: 보상 선택 */
      .reward-section { margin-top: 18px; padding-top: 14px; border-top: 1px dashed rgba(255,214,107,.3); }
      .reward-section h3 { color: #ffd66b !important; font-size: 13px !important; }
      .reward-hint { font-size: 11px; color: rgba(234, 243, 255, .55); margin: 0 0 8px; }
      .reward-list { display: grid; gap: 8px; }
      .reward-card {
        background: rgba(255,255,255,.04);
        border: 1.5px solid rgba(255,255,255,.10);
        border-radius: 10px;
        padding: 12px 14px;
        cursor: pointer;
        text-align: left;
        color: inherit;
        transition: all .15s;
      }
      .reward-card:hover {
        background: rgba(255, 214, 107, .08);
        border-color: rgba(255, 214, 107, .4);
      }
      .reward-card[data-selected="true"] {
        background: rgba(255, 214, 107, .15);
        border-color: #ffd66b;
        box-shadow: 0 0 0 1px #ffd66b inset;
      }
      .reward-name {
        font-size: 13.5px;
        font-weight: 700;
        color: #ffd66b;
        margin-bottom: 3px;
      }
      .reward-category {
        font-size: 10px;
        color: rgba(234, 243, 255, .45);
        text-transform: uppercase;
        letter-spacing: .8px;
        margin-bottom: 5px;
      }
      .reward-desc {
        font-size: 11.5px;
        color: rgba(234, 243, 255, .78);
        line-height: 1.5;
        margin-bottom: 4px;
      }
      .reward-effect {
        font-size: 11.5px;
        color: #80efb1;
        font-weight: 600;
      }

      /* v0.4.0-c2-a: 보상 타입 배지 */
      .reward-card-top {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 3px;
      }
      .reward-badge {
        font-size: 9px;
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: .8px;
      }
      .reward-badge-instant { background: rgba(128,239,177,.15); color: #80efb1; }
      .reward-badge-card { background: rgba(255,214,107,.18); color: #ffd66b; }
      .reward-badge-persistent { background: rgba(124,171,220,.18); color: #7cabdc; }
    </style>
  `;
  document.body.appendChild(overlay);

  const continueBtn = overlay.querySelector("#dayContinueBtn");
  const autoBtn = overlay.querySelector("#dayAutoBtn");

  function updateBtnState() {
    const valid = drawnRewards.length === 0 || selectedRewardId !== null;
    continueBtn.disabled = !valid;
    autoBtn.disabled = !valid;
  }
  updateBtnState();

  // 보상 카드 선택 핸들러
  const rewardListEl = overlay.querySelector("#rewardList");
  if (rewardListEl) {
    rewardListEl.addEventListener("click", (e) => {
      const card = e.target.closest(".reward-card");
      if (!card) return;
      rewardListEl.querySelectorAll(".reward-card").forEach(c => c.removeAttribute("data-selected"));
      card.setAttribute("data-selected", "true");
      selectedRewardId = card.dataset.rewardId;
      updateBtnState();
    });
  }

  function applySelectedReward() {
    if (!selectedRewardId) return;
    const reward = drawnRewards.find(r => r.id === selectedRewardId);
    if (!reward) return;
    const result = applyReward(state, reward);
    const logLine = describeRewardApplication(reward, result, state);
    // 다음 턴의 operationLog 또는 state.log에 보상 적용 기록
    if (state.thisTurn?.operationLog) {
      state.thisTurn.operationLog.push(logLine);
    }
    state.log.push({
      turn: state.turn,
      phase: 7,
      name: "day_end_reward",
      reward: { id: reward.id, name: reward.name, applyTiming: reward.applyTiming },
      result
    });
  }

  function close() {
    applySelectedReward();
    pendingDayModal = false;
    overlay.remove();
    // 보상 적용 후 화면 갱신 (게이지/덱 변동 반영)
    render();
    renderCards();
  }

  continueBtn.addEventListener("click", () => {
    if (continueBtn.disabled) return;
    close();
  });
  autoBtn.addEventListener("click", () => {
    if (autoBtn.disabled) return;
    autoToNextDayMode = true;
    close();
    runAutoToNextDay();
  });
  overlay.querySelector("#dayAutoCloseToggle").addEventListener("change", (e) => {
    dayAutoCloseEnabled = e.target.checked;
  });

  // 자동 닫기 토글 ON이면 보상 자동 선택 후 1.5초 후 진행
  if (dayAutoCloseEnabled && drawnRewards.length > 0) {
    // 자동 선택: 가중치 가장 높은 (drawRewards가 이미 가중치 추첨 결과니, 단순히 첫 번째 선택)
    selectedRewardId = drawnRewards[0].id;
    const firstCard = overlay.querySelector(`.reward-card[data-reward-id="${selectedRewardId}"]`);
    if (firstCard) firstCard.setAttribute("data-selected", "true");
    updateBtnState();
  }

  // DAY 자동 닫기 토글 ON이면 1.5초 후 자동 닫기 + 다음 DAY까지 자동 진행
  if (dayAutoCloseEnabled) {
    setTimeout(() => {
      if (pendingDayModal) {
        close();
        runAutoToNextDay();
      }
    }, 1500);
  }
}

// =====================================================================
// v0.4.0-d2: 최종 결과 모달
// ---------------------------------------------------------------------
// outcome 발생 시 1회만 호출 (finalModalShown guard).
// 구조:
//   - 결과 제목 + 종료 시점
//   - 플레이어 진영 큰 등급/점수
//   - 상대 진영 작은 등급
//   - 점수 breakdown (긍정 top 3 + 부정 top 2 + 기타 압축)
//   - 핵심 요약 (점령지, 주요 전투, 보유 보상)
//   - 해설 문구
//   - 다시 시작 / 같은 설정 재시작
// =====================================================================
function showFinalResultModal() {
  if (finalModalShown) return;
  finalModalShown = true;

  const report = buildFinalReport(state, campaign, { gameRules: GAME_RULES });
  const playerSide = campaign?.selectedSide === "both"
    ? (report.taiwan.score >= report.china.score ? "taiwan" : "china")
    : campaign?.selectedSide || "taiwan";
  const opponentSide = playerSide === "taiwan" ? "china" : "taiwan";

  const player = report[playerSide];
  const opponent = report[opponentSide];

  const overlay = document.createElement("div");
  overlay.id = "finalResultOverlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 5000;
    background: rgba(3, 8, 18, .92);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 24px; overflow-y: auto;
    animation: fadeIn .3s ease;
  `;

  // 점수 breakdown 압축 (사용자 명세: 긍정 top 3 + 부정 top 2 + 기타 압축)
  const compressedBreakdown = compressBreakdown(player.components);

  // 핵심 요약 (점령지/주요 전투/보유 보상)
  const playerRewards = (report.summary.ownedRewards || [])
    .filter(r => r.side === playerSide || campaign?.selectedSide === "both")
    .slice(0, 5);
  const playerRewardLines = playerRewards.length
    ? playerRewards.map(r => `<li>${escapeHtml(r.name)}</li>`).join("")
    : `<li class="muted">없음</li>`;

  const occupiedList = report.summary.occupiedProvinces.length
    ? report.summary.occupiedProvinces.slice(0, 6).map(p => escapeHtml(p)).join(", ")
    : "없음";
  const contestedList = report.summary.contestedProvinces.length
    ? report.summary.contestedProvinces.slice(0, 6).map(p => escapeHtml(p)).join(", ")
    : "없음";

  const majorBattleLines = report.summary.majorBattles.length
    ? report.summary.majorBattles.slice(-3).map(b => {
        const mark = b.success ? "✓" : "✗";
        const sign = b.margin >= 0 ? "+" : "";
        return `<li>T${b.turn ?? "?"} ${escapeHtml(b.sourceName)} ${mark} ${escapeHtml(b.targetName)} (차이 ${sign}${b.margin})</li>`;
      }).join("")
    : `<li class="muted">기록된 주요 전투 없음</li>`;

  const playerLabel = playerSide === "taiwan" ? "대만" : "중국";
  const oppLabel = opponentSide === "taiwan" ? "대만" : "중국";
  const playerColor = playerSide === "taiwan" ? "#80efb1" : "#ff8b94";
  const oppColor = opponentSide === "taiwan" ? "#80efb1" : "#ff8b94";

  // 등급별 색상 (S=골드, A=실버, B=청동, C=회색, D=다크)
  const gradeColor = {
    S: "#ffd66b", A: "#cfd8e6", B: "#d09a5e", C: "#8a9aab", D: "#5a6a7b"
  };
  const playerGradeColor = gradeColor[player.grade];

  overlay.innerHTML = `
    <div class="final-modal">
      <div class="final-header">
        <div class="final-subtitle">캠페인 종료 · T${report.finalTurn} / ${report.totalTurns} · ${formatGameTime(report.finalTurn)}</div>
        <h2 class="final-title">${escapeHtml(report.title)}</h2>
      </div>

      <div class="final-main">
        <div class="final-grade-box" style="border-color: ${playerGradeColor};">
          <div class="final-grade-label" style="color: ${playerColor};">${playerLabel} 캠페인 결과</div>
          <div class="final-grade-letter" style="color: ${playerGradeColor};">${player.grade}</div>
          <div class="final-grade-score">${player.score} / 100</div>
          ${player.naturalGrade && player.naturalGrade !== player.grade
            ? `<div class="final-grade-cap-note">점수상 ${player.naturalGrade}이지만 전황상 ${player.grade} 상한</div>`
            : ""}
        </div>
        <div class="final-opponent-box">
          <div class="final-opponent-label" style="color: ${oppColor};">${oppLabel} 측 평가</div>
          <div class="final-opponent-grade" style="color: ${gradeColor[opponent.grade]};">${opponent.grade} (${opponent.score})</div>
        </div>
      </div>

      <section class="final-interp">
        <p>${escapeHtml(player.interpretation)}</p>
      </section>

      <section class="final-debrief">
        <h3>이번 캠페인의 이야기</h3>
        <div class="debrief-block">
          <div class="debrief-label">결정적 순간</div>
          <div class="debrief-text">${escapeHtml(report.summary.debrief.decisiveMoment)}</div>
        </div>
        <div class="debrief-block">
          <div class="debrief-label">국제 전환점</div>
          <div class="debrief-text">${escapeHtml(report.summary.debrief.internationalTurning)}</div>
        </div>
        <div class="debrief-block">
          <div class="debrief-label">캠페인 평가</div>
          <div class="debrief-text">${escapeHtml(report.summary.debrief.campaignAssessment)}</div>
        </div>
      </section>

      <section class="final-breakdown">
        <h3>점수 요인</h3>
        <ul class="breakdown-list">
          <li class="breakdown-base"><span>기본 결과 점수</span><span class="pos">+${player.base}</span></li>
          ${compressedBreakdown.positives.map(c =>
            `<li><span>${escapeHtml(c.label)}</span><span class="pos">+${c.delta}</span></li>`
          ).join("")}
          ${compressedBreakdown.othersPositive.delta > 0
            ? `<li class="muted"><span>기타 (${compressedBreakdown.othersPositive.count}개)</span><span class="pos">+${compressedBreakdown.othersPositive.delta}</span></li>`
            : ""}
          ${compressedBreakdown.negatives.map(c =>
            `<li><span>${escapeHtml(c.label)}</span><span class="neg">${c.delta}</span></li>`
          ).join("")}
          ${compressedBreakdown.othersNegative.delta < 0
            ? `<li class="muted"><span>기타 (${compressedBreakdown.othersNegative.count}개)</span><span class="neg">${compressedBreakdown.othersNegative.delta}</span></li>`
            : ""}
        </ul>
      </section>

      <section class="final-summary">
        <h3>전황 요약</h3>
        <div class="summary-grid">
          <div><strong>점령된 지역:</strong> ${occupiedList}</div>
          <div><strong>전투 중 지역:</strong> ${contestedList}</div>
        </div>
        <h4>주요 전투 (최근 3)</h4>
        <ul class="battle-list">${majorBattleLines}</ul>
        <h4>활성 보상</h4>
        <ul class="rewards-list">${playerRewardLines}</ul>
      </section>

      <div class="final-controls">
        <button id="finalRestartSameBtn" class="primary">같은 설정으로 재시작</button>
        <button id="finalRestartNewBtn" class="secondary">진영 선택으로 돌아가기</button>
      </div>
    </div>

    <style>
      .final-modal {
        max-width: 720px; width: 100%;
        background: linear-gradient(180deg, rgba(13, 28, 50, .98), rgba(8, 18, 34, .98));
        border: 2px solid rgba(255, 214, 107, 0.5);
        border-radius: 18px;
        padding: 28px 32px 24px;
        color: #eaf3ff;
        box-shadow: 0 30px 100px rgba(0,0,0,.8), 0 0 60px rgba(255, 214, 107, 0.15);
        max-height: calc(100vh - 48px);
        overflow-y: auto;
        margin: auto 0;
      }
      .final-modal::-webkit-scrollbar { width: 8px; }
      .final-modal::-webkit-scrollbar-thumb {
        background: rgba(255, 214, 107, .3);
        border-radius: 4px;
      }
      .final-header { text-align: center; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 16px; margin-bottom: 20px; }
      .final-subtitle { font-size: 11px; color: rgba(234, 243, 255, .55); letter-spacing: 1.5px; }
      .final-title { margin: 6px 0 0; font-size: 26px; font-weight: 800; color: #ffd66b; letter-spacing: 1px; }
      .final-main { display: flex; gap: 16px; align-items: stretch; margin-bottom: 20px; }
      .final-grade-box {
        flex: 2;
        background: rgba(255, 214, 107, .04);
        border: 2px solid;
        border-radius: 14px;
        padding: 16px 20px;
        text-align: center;
      }
      .final-grade-label { font-size: 11px; letter-spacing: 1.5px; font-weight: 700; margin-bottom: 8px; }
      .final-grade-letter { font-size: 76px; font-weight: 900; line-height: 1; letter-spacing: 2px; text-shadow: 0 4px 16px rgba(0,0,0,.5); }
      .final-grade-score { margin-top: 8px; font-size: 18px; font-weight: 700; color: #eaf3ff; }
      .final-grade-cap-note {
        margin-top: 8px;
        font-size: 11px;
        color: rgba(255, 214, 107, .75);
        font-style: italic;
      }
      .final-opponent-box {
        flex: 1;
        background: rgba(124, 171, 220, .06);
        border: 1px solid rgba(124, 171, 220, .25);
        border-radius: 10px;
        padding: 14px;
        text-align: center;
        display: flex; flex-direction: column; justify-content: center;
      }
      .final-opponent-label { font-size: 11px; letter-spacing: 1px; font-weight: 700; margin-bottom: 6px; }
      .final-opponent-grade { font-size: 26px; font-weight: 800; }
      .final-interp {
        background: rgba(255, 214, 107, .07);
        border-left: 3px solid #ffd66b;
        padding: 12px 16px;
        border-radius: 6px;
        margin-bottom: 18px;
      }
      .final-interp p { margin: 0; font-size: 14px; line-height: 1.6; color: rgba(234, 243, 255, .92); }
      /* v0.4.0-d3: 디브리핑 섹션 */
      .final-debrief {
        background: rgba(124, 171, 220, .06);
        border: 1px solid rgba(124, 171, 220, .2);
        border-radius: 8px;
        padding: 14px 16px;
        margin-bottom: 18px;
      }
      .final-debrief h3 {
        margin: 0 0 10px;
        color: #ffd66b;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.8px;
        text-transform: uppercase;
      }
      .debrief-block { margin-bottom: 10px; }
      .debrief-block:last-child { margin-bottom: 0; }
      .debrief-label {
        font-size: 10px;
        color: #7cabdc;
        font-weight: 700;
        letter-spacing: 1px;
        margin-bottom: 2px;
        text-transform: uppercase;
      }
      .debrief-text {
        font-size: 13px;
        line-height: 1.55;
        color: rgba(234, 243, 255, .9);
      }
      .final-modal section { margin-bottom: 18px; }
      .final-modal h3 { margin: 0 0 8px; font-size: 12px; color: #7cabdc; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; }
      .final-modal h4 { margin: 10px 0 4px; font-size: 11px; color: rgba(124, 171, 220, .8); font-weight: 700; letter-spacing: .5px; }
      .breakdown-list, .battle-list, .rewards-list { list-style: none; padding: 0; margin: 0; font-size: 13px; line-height: 1.6; }
      .breakdown-list li { display: flex; justify-content: space-between; padding: 4px 8px; border-bottom: 1px dashed rgba(255,255,255,.06); }
      .breakdown-list li:last-child { border-bottom: none; }
      .breakdown-list .breakdown-base { font-weight: 700; background: rgba(124, 171, 220, .08); border-radius: 4px; }
      .breakdown-list .pos { color: #80efb1; font-weight: 700; }
      .breakdown-list .neg { color: #ff8b94; font-weight: 700; }
      .breakdown-list .muted { color: rgba(234, 243, 255, .5); font-style: italic; }
      .summary-grid { display: grid; gap: 6px; font-size: 13px; line-height: 1.6; }
      .summary-grid strong { color: #7cabdc; }
      .battle-list li, .rewards-list li { padding: 3px 0; }
      .rewards-list li { color: rgba(234, 243, 255, .85); }
      .final-controls { display: flex; gap: 10px; margin-top: 16px; }
      .final-controls .primary {
        flex: 1;
        background: linear-gradient(180deg, #ffd66b, #d9a939);
        color: #1a1408; border: 0;
        padding: 14px; border-radius: 10px;
        font-size: 14px; font-weight: 800; cursor: pointer;
        letter-spacing: .5px;
      }
      .final-controls .secondary {
        flex: 1;
        background: rgba(124, 171, 220, .15);
        color: #eaf3ff; border: 1px solid #7cabdc;
        padding: 14px; border-radius: 10px;
        font-size: 13px; font-weight: 700; cursor: pointer;
      }
      .final-modal .muted { color: rgba(234, 243, 255, .5); font-size: 12px; }
    </style>
  `;

  document.body.appendChild(overlay);

  // 같은 설정 재시작
  overlay.querySelector("#finalRestartSameBtn").addEventListener("click", () => {
    overlay.remove();
    resetGame();
    dom.runTurnBtn.disabled = false;
    dom.autoTurnBtn.disabled = false;
  });
  // 진영 선택으로
  overlay.querySelector("#finalRestartNewBtn").addEventListener("click", () => {
    overlay.remove();
    showSideSelectModal((selectedSide, difficulty) => {
      campaign = createCampaignState(selectedSide, difficulty);
      saveLastChoice(selectedSide, difficulty);
      resetGame();
      dom.runTurnBtn.disabled = false;
      dom.autoTurnBtn.disabled = false;
    });
  });
}


// 다음 DAY 종료까지 자동 진행 (모달이 다시 뜰 때까지)
function runAutoToNextDay() {
  let safety = 50;
  while (safety-- > 0) {
    if (state.outcome) break;
    if (pendingDayModal) break;
    applySuggestion(true);
    runManualTurn();
  }
  autoToNextDayMode = false;
}

// v0.4.0-c1: 보상 카드 HTML
function renderRewardCard(reward) {
  // effect 자연어 요약
  let effectText = "";
  let badgeHtml = "";

  if (reward.applyTiming === "add_card") {
    // v0.4.0-c2-a: 카드 추가 보상은 카드명 명시
    const cardId = reward.effects?.addCard;
    const card = indices?.cardIndex?.get?.(cardId);
    const cardName = card?.name || cardId || "카드";
    effectText = `🎴 다음 드로우 시 「${cardName}」 1장 손패에 들어옴 (덱 맨 위 삽입)`;
    badgeHtml = `<div class="reward-badge reward-badge-card">CARD</div>`;
  } else if (reward.applyTiming === "persistent") {
    // v0.4.0-c2-b2: persistent 보상별 자연어 표시
    const eff = reward.effects || {};
    if (eff.perTurnGain) {
      const parts = Object.entries(eff.perTurnGain)
        .map(([k, v]) => `${formatRewardEffectKey(k)} ${v > 0 ? "+" : ""}${v}/턴`);
      effectText = `🔁 매 턴: ${parts.join(", ")}`;
    } else if (eff.defenseValueBonus) {
      const regions = eff.defenseValueBonus.regions || [];
      const amount = Math.min(1, eff.defenseValueBonus.amount || 0);
      const provById = {};
      for (const p of (data?.provinces || [])) provById[p.id] = p.name;
      const regionNames = regions.map(id => provById[id] || id).join(", ");
      effectText = `🛡 ${regionNames} 방어력 +${amount} (영구, 같은 지역 누적 +2 캡)`;
    } else if (typeof eff.rangedAttackBonus === "number") {
      // v0.4.0-c2-b3-1: 원거리 공격 보상
      const amount = Math.min(1, Math.max(0, eff.rangedAttackBonus));
      effectText = `🎯 원거리 작전 (미사일 압박) 공격력 +${amount} (영구)`;
    } else if (typeof eff.nightOpDefenseDebuff === "number") {
      // v0.4.0-c2-b3-2: 야간 작전 효율
      const amount = Math.min(1, Math.max(0, eff.nightOpDefenseDebuff));
      effectText = `🌙 야간 작전 시 대만 방어 -${amount} 추가 (영구)`;
    } else if (typeof eff.taiwanSupplyDamageReduction === "number") {
      // v0.4.0-c2-b3-3a: 대만 보급 우회
      const reduction = Math.min(0.3, Math.max(0, eff.taiwanSupplyDamageReduction));
      effectText = `🚛 대만 보급 피해 ${Math.round(reduction * 100)}% 감소 (영구, 최대 30% 캡)`;
    } else if (typeof eff.usJapanInterventionGainReduction === "number") {
      // v0.4.0-c2-b3-3b: 정보 통제 — 미국/일본 개입 상승 감쇄
      const reduction = Math.min(0.25, Math.max(0, eff.usJapanInterventionGainReduction));
      effectText = `📡 미국/일본 개입 상승 ${Math.round(reduction * 100)}% 감소 (영구, 최대 25% 캡)`;
    } else {
      // c2-b3 예정 효과 (rangedAttackBonus, nightOpDefenseDebuff, supplyDamageReduction 등)
      effectText = "영구 효과 — 캠페인 동안 유지 (c2-b3에서 활성)";
    }
    badgeHtml = `<div class="reward-badge reward-badge-persistent">PERSIST</div>`;
  } else {
    // instant
    const lines = [];
    for (const [key, val] of Object.entries(reward.effects || {})) {
      if (typeof val === "number") {
        const sign = val > 0 ? "+" : "";
        lines.push(`${formatRewardEffectKey(key)} ${sign}${val}`);
      }
    }
    effectText = lines.length ? lines.join(", ") : "효과 없음";
    badgeHtml = `<div class="reward-badge reward-badge-instant">INSTANT</div>`;
  }

  return `
    <button class="reward-card" data-reward-id="${reward.id}">
      <div class="reward-card-top">
        <div class="reward-category">${reward.category}</div>
        ${badgeHtml}
      </div>
      <div class="reward-name">${escapeHtml(reward.name)}</div>
      <div class="reward-desc">${escapeHtml(reward.description || "")}</div>
      <div class="reward-effect">→ ${escapeHtml(effectText)}</div>
    </button>
  `;
}

function formatRewardEffectKey(key) {
  const map = {
    taiwanReserveTroops: "대만 예비군",
    taiwanSupply: "대만 보급",
    taiwanGovernment: "대만 정부 기능",
    taiwanCommand: "대만 지휘 체계",
    taiwanMorale: "대만 국민 사기",
    usIntervention: "미국 개입도",
    japanIntervention: "일본 개입도",
    internationalOpinion: "국제 여론",
    chinaTempo: "중국 작전 템포",
    chinaSupply: "중국 보급력",
    chinaReserveTroops: "중국 예비 병력",
    chinaPoliticalPressure: "중국 정치 압박"
  };
  return map[key] || key;
}

function describeRewardCategorySummary(rewards) {
  const cats = [...new Set(rewards.map(r => r.category))];
  return `${cats.length}개 카테고리 보상 후보. 전황에 맞는 카드일수록 자주 등장합니다.`;
}

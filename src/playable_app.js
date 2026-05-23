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

const DATA_PATHS = {
  axes: "./data/axes.json",
  provinces: "./data/provinces.json",
  cardsChina: "./data/cards_china.json",
  cardsTaiwan: "./data/cards_taiwan.json",
  events: "./data/events_global.json"
};

const dom = {};
let data = {};
let indices = {};
let state = null;
let selectedProvince = "keelung";
const recentUiPicks = { china: [], taiwan: [] };
let canvasLoopStarted = false;

window.addEventListener("DOMContentLoaded", init);

// ---- 빌드 검증 ----
// 압축 해제 누락, 브라우저 캐시, 잘못된 폴더 등으로 옛 빌드가 조용히 로드되는 사고 방지.
const EXPECTED_BUILD = "v0.3.8c";
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
  resetGame();
  bindEvents();
  startCanvasLoop();
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
  selectedProvince = "keelung";
  fillSelectors();
  renderCards();
  applySuggestion(false);
  render();
}

function bindEvents() {
  dom.runTurnBtn.addEventListener("click", () => runManualTurn());
  dom.autoTurnBtn.addEventListener("click", () => {
    applySuggestion(true);
    runManualTurn();
  });
  dom.resetBtn.addEventListener("click", () => {
    if (confirm("현재 판을 버리고 새 게임을 시작할까요?")) resetGame();
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

  window.addEventListener("resize", render);
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
    <label class="card-check">
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
    if (axisId) autoPickCards("china", axisId);
    if (focusId) autoPickCards("taiwan", focusId);
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
  const opsLines = (s.operations || []).map(line => {
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
  if (line.includes("성공:")) return "ok";
  if (line.includes("실패:")) return "danger";
  if (line.includes("카운터플레이")) return "warn";
  if (line.includes("이벤트 발동")) return "event";
  if (line.includes("상륙 진척")) return "danger";
  if (line.includes("상륙 후퇴")) return "ok";
  if (line.includes("주공축 발동")) return "axis";
  return "";
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

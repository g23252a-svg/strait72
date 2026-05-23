// =====================================================================
// day_cycle.js  (v0.4.0-b introduced)
// ---------------------------------------------------------------------
// 4턴 = 1 DAY 구조의 진행/요약 수집기.
// v0.4.0-b 범위: 요약 데이터 구조 + 진영별 해석 문구.
// v0.4.0-c에서 보상 추천이, v0.4.0-d에서 등급 계산이 이 위에 올라감.
// =====================================================================

export const TURNS_PER_DAY = 4;

// 시작 턴(1-indexed) → DAY 번호 (1-indexed)
export function dayNumberForTurn(turn) {
  return Math.ceil(turn / TURNS_PER_DAY);
}

// DAY가 끝나는 턴인지 (4, 8, 12, ...)
export function isDayEndTurn(turn) {
  return turn > 0 && turn % TURNS_PER_DAY === 0;
}

// DAY 번호 → 첫/마지막 턴
export function turnRangeForDay(dayNumber) {
  const start = (dayNumber - 1) * TURNS_PER_DAY + 1;
  const end = dayNumber * TURNS_PER_DAY;
  return [start, end];
}

export function formatDayLabel(dayNumber) {
  // DAY 1 = D+0, DAY 2 = D+1, ... 게임 시계와 자연스럽게 매칭
  return `DAY ${dayNumber} (D+${dayNumber - 1})`;
}

// 추적할 게이지 키 (라벨 + 진영 색)
const WATCHED_GAUGES = [
  { key: "chinaTempo",             label: "중국 작전 템포",   side: "china",  format: "delta" },
  { key: "chinaSupply",            label: "중국 보급력",       side: "china",  format: "delta" },
  { key: "chinaPoliticalPressure", label: "중국 정치압박",     side: "china",  format: "delta" },
  { key: "taiwanGovernment",       label: "대만 정부 기능",    side: "taiwan", format: "delta" },
  { key: "taiwanMorale",           label: "대만 국민 사기",    side: "taiwan", format: "delta" },
  { key: "taiwanCommand",          label: "대만 지휘 체계",    side: "taiwan", format: "delta" },
  { key: "taiwanSupply",           label: "대만 보급 상태",    side: "taiwan", format: "delta" },
  { key: "usIntervention",         label: "미국 개입도",       side: "ally",   format: "delta" },
  { key: "japanIntervention",      label: "일본 개입도",       side: "ally",   format: "delta" },
  { key: "koreaRearSupport",       label: "한국 후방지원",     side: "ally",   format: "delta" },
  { key: "internationalOpinion",   label: "국제 여론",         side: "neutral", format: "delta" }
];

const CONTROL_LABELS = {
  stable_defense: "안정 방어",
  contested: "교전 중",
  coastal_breach: "해안 돌파",
  beachhead_established: "교두보 형성",
  china_control: "중국 통제"
};

const STAGE_LABELS = {
  none: "없음",
  sea_superiority: "해상 우세",
  landing_attempt: "상륙 시도",
  beachhead: "교두보",
  inland_expansion: "내륙 확장"
};

// 핵심 — DAY 요약 데이터 빌드
// state.log을 훑어 해당 DAY의 사건을 집계.
export function buildDayReport(state, dayNumber, eventsData = []) {
  const [turnStart, turnEnd] = turnRangeForDay(dayNumber);
  const dayLabel = formatDayLabel(dayNumber);

  // 1. DAY 시작 직전과 DAY 끝나는 시점의 스냅샷 추출
  //    phase 1 (information) 의 snapshot이 그 턴 시작 직전.
  //    snapshot은 state.gauges 직접 복사본 (구버전 호환), provincesSnapshot은 별도.
  const startEntry = state.log.find(e => e.turn === turnStart && e.phase === 1 && e.snapshot);
  const afterEntry = state.log.find(e => e.turn === turnEnd + 1 && e.phase === 1 && e.snapshot);

  const startGauges = startEntry?.snapshot || {};
  const endGauges = afterEntry?.snapshot || state.gauges || {};
  const startProvinces = startEntry?.provincesSnapshot || {};

  // 2. 게이지 델타 - 0이 아닌 것만
  const gaugeDeltas = {};
  for (const g of WATCHED_GAUGES) {
    const before = Math.round(startGauges[g.key] ?? 0);
    const after = Math.round(endGauges[g.key] ?? 0);
    const delta = after - before;
    if (delta !== 0) gaugeDeltas[g.key] = { label: g.label, side: g.side, delta, before, after };
  }

  // 3. 점령 변화 (start 스냅샷의 provinces vs 현재 state)
  const currentProvinces = state.provinces || {};
  const occupationChanges = [];
  for (const [id, prov] of Object.entries(currentProvinces)) {
    if (id === "strait") continue;
    const before = startProvinces[id];
    if (!before) continue;
    const beforeStage = before.controlStage || before.controlStatus || "stable_defense";
    const afterStage = prov.controlStage || "stable_defense";
    if (beforeStage !== afterStage) {
      occupationChanges.push({
        provinceId: id,
        name: prov.name || id,
        before: CONTROL_LABELS[beforeStage] || beforeStage,
        after: CONTROL_LABELS[afterStage] || afterStage,
        isLoss: afterStage === "china_control" || afterStage === "beachhead_established" || afterStage === "contested",
        isRecover: (beforeStage === "china_control" || beforeStage === "beachhead_established") &&
                   (afterStage === "stable_defense" || afterStage === "contested")
      });
    }
    // landingStage 변화도 (방어 측 시점에서 중요)
    const beforeLanding = before.landingStage || "none";
    const afterLanding = prov.landingStage || "none";
    if (beforeLanding !== afterLanding && afterLanding !== "none" && !occupationChanges.some(c => c.provinceId === id)) {
      occupationChanges.push({
        provinceId: id,
        name: prov.name || id,
        before: STAGE_LABELS[beforeLanding] || beforeLanding,
        after: STAGE_LABELS[afterLanding] || afterLanding,
        isLoss: ["landing_attempt", "beachhead", "inland_expansion"].includes(afterLanding),
        isRecover: false
      });
    }
  }

  // 4. 발동된 이벤트 — 이 DAY 안의 phase 4 entry에서 추출
  const events = [];
  const eventNameMap = {};
  for (const ev of eventsData) eventNameMap[ev.id] = ev.name || ev.id;
  for (const entry of state.log) {
    if (entry.turn < turnStart || entry.turn > turnEnd) continue;
    if (entry.triggeredEvents && Array.isArray(entry.triggeredEvents)) {
      for (const id of entry.triggeredEvents) {
        const name = eventNameMap[id] || id;
        if (!events.includes(name)) events.push(name);
      }
    }
  }

  // 5. 대형 전투 (margin >= 5)
  const majorBattles = [];
  for (const entry of state.log) {
    if (entry.turn < turnStart || entry.turn > turnEnd) continue;
    if (entry.phase !== 4 || !entry.combatResults) continue;
    for (const r of entry.combatResults) {
      if (Math.abs(r.margin || 0) >= 5) {
        const verb = r.success ? "우세" : "실패";
        majorBattles.push({
          turn: entry.turn,
          source: r.sourceName,
          target: r.targetName,
          margin: r.margin,
          success: r.success,
          text: `${r.sourceName}: ${r.targetName} ${verb} (차이 ${r.margin > 0 ? "+" : ""}${r.margin})`
        });
      }
    }
  }

  // 6. DAY 진행 통계: 턴 로그에서는 줄이고 DAY 요약에서 누적 표시
  const dayProgress = collectDayProgress(state.log, turnStart, turnEnd);

  // 7. 진영별 해석 문구 자동 생성
  const interpretation = generateInterpretation(gaugeDeltas, occupationChanges, events);

  return {
    dayNumber,
    dayLabel,
    turnRange: [turnStart, turnEnd],
    gaugeDeltas,
    occupationChanges,
    events,
    majorBattles,
    dayProgress,
    interpretation
  };
}

function collectDayProgress(log, turnStart, turnEnd) {
  const deckBySide = {};
  const replanByOperation = {};
  const rewardMap = new Map();
  let deckTotal = 0;

  for (const entry of log || []) {
    if (entry.turn < turnStart || entry.turn > turnEnd) continue;

    if (entry.phase === 4 && Array.isArray(entry.operations)) {
      for (const line of entry.operations) {
        if (line.includes("덱 소진") && line.includes("셔플 복귀")) {
          const sideMatch = line.match(/^(.+?)\s+덱 소진:/);
          const cardMatch = line.match(/(\d+)장\s+셔플 복귀/);
          const side = sideMatch?.[1]?.trim() || "알 수 없음";
          const cards = cardMatch ? Number(cardMatch[1]) : 0;
          deckBySide[side] = deckBySide[side] || { side, count: 0, cards: 0 };
          deckBySide[side].count += 1;
          deckBySide[side].cards += cards;
          deckTotal += 1;
        }

        if (line.includes("보류: 유효한 지역 타깃 없음")) {
          const match = line.match(/^(.+?)\s+보류:/);
          const operation = match?.[1]?.trim() || "작전";
          replanByOperation[operation] = (replanByOperation[operation] || 0) + 1;
        }
      }
    }

    if (entry.phase === 1 && Array.isArray(entry.perTurnApplied)) {
      for (const applied of entry.perTurnApplied) {
        const key = applied.rewardId || applied.rewardName || "reward";
        if (!rewardMap.has(key)) {
          rewardMap.set(key, {
            rewardId: applied.rewardId || key,
            rewardName: applied.rewardName || key,
            turns: 0,
            totals: {}
          });
        }
        const item = rewardMap.get(key);
        let changed = false;
        for (const [gaugeKey, detail] of Object.entries(applied.details || {})) {
          const delta = Number(detail?.delta || 0);
          if (delta === 0) continue;
          item.totals[gaugeKey] = (item.totals[gaugeKey] || 0) + delta;
          changed = true;
        }
        if (changed) item.turns += 1;
      }
    }
  }

  return {
    deckReshuffles: {
      total: deckTotal,
      bySide: Object.values(deckBySide)
    },
    operationReplans: {
      total: Object.values(replanByOperation).reduce((sum, n) => sum + n, 0),
      byOperation: Object.entries(replanByOperation).map(([name, count]) => ({ name, count }))
    },
    persistentRewardTotals: [...rewardMap.values()].filter(r => Object.keys(r.totals).length > 0)
  };
}

// 진영별 해석 문구 — 데이터 기반 자동 생성
function generateInterpretation(gaugeDeltas, occupationChanges, events) {
  // 대만 관점 메시지
  const taiwanMsgs = [];
  const chinaMsgs = [];
  const bothMsgs = [];

  // 1) 점령 변화 해석
  const losses = occupationChanges.filter(c => c.isLoss);
  const recovers = occupationChanges.filter(c => c.isRecover);
  if (losses.length) {
    taiwanMsgs.push(`${losses.map(c => c.name).join(", ")}에 중국 진척이 발생했습니다.`);
    chinaMsgs.push(`${losses.map(c => c.name).join(", ")}에서 작전 진척을 만들었습니다.`);
  }
  if (recovers.length) {
    taiwanMsgs.push(`${recovers.map(c => c.name).join(", ")}에서 방어선을 회복했습니다.`);
    chinaMsgs.push(`${recovers.map(c => c.name).join(", ")}에서 후퇴를 강요받았습니다.`);
  }

  // 2) 동맹 게이지 흐름
  const usDelta = gaugeDeltas.usIntervention?.delta || 0;
  const japanDelta = gaugeDeltas.japanIntervention?.delta || 0;
  const koreaDelta = gaugeDeltas.koreaRearSupport?.delta || 0;
  const allyTotal = usDelta + japanDelta + koreaDelta;
  if (allyTotal >= 15) {
    taiwanMsgs.push("동맹 개입 속도가 빨라지고 있습니다.");
    chinaMsgs.push("동맹 개입 위험이 빠르게 누적되고 있습니다.");
  } else if (allyTotal <= -10) {
    taiwanMsgs.push("동맹 신호가 약해졌습니다. 외교 카드가 필요합니다.");
    chinaMsgs.push("동맹 진입을 늦추는 데 성공했습니다.");
  }

  // 3) 대만 내부 약화
  const govDelta = gaugeDeltas.taiwanGovernment?.delta || 0;
  const cmdDelta = gaugeDeltas.taiwanCommand?.delta || 0;
  const supplyDelta = gaugeDeltas.taiwanSupply?.delta || 0;
  if (govDelta + cmdDelta <= -10) {
    taiwanMsgs.push("정부/지휘망이 흔들리고 있습니다. 복구가 필요합니다.");
    chinaMsgs.push("대만 통치 기반에 균열을 만들었습니다.");
  }
  if (supplyDelta <= -10) {
    taiwanMsgs.push("보급선 압박이 커지고 있습니다.");
  }

  // 4) 중국 정치압박
  const polDelta = gaugeDeltas.chinaPoliticalPressure?.delta || 0;
  if (polDelta >= 10) {
    chinaMsgs.push("정치 압박이 위험 수위에 다가가고 있습니다.");
    taiwanMsgs.push("중국 내부 정치 부담이 커지고 있습니다.");
  }

  // 5) 이벤트 강조
  if (events.length >= 2) {
    bothMsgs.push(`이번 날 ${events.length}개의 국제 이벤트가 발동했습니다.`);
  }

  // 기본 메시지 (아무것도 안 잡혔을 때)
  if (taiwanMsgs.length === 0) taiwanMsgs.push("큰 변화 없이 하루가 지나갔습니다. 다음 날은 능동적 행동이 필요합니다.");
  if (chinaMsgs.length === 0) chinaMsgs.push("결정적 진척을 만들지 못했습니다. 작전 템포 회복이 필요합니다.");

  return {
    taiwan: taiwanMsgs.join(" "),
    china: chinaMsgs.join(" "),
    both: bothMsgs.length ? bothMsgs.join(" ") : "양측 모두 다음 날 결정을 준비하고 있습니다."
  };
}

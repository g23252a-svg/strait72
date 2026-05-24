// =====================================================================
// save_system.js (v0.4.4)
// ---------------------------------------------------------------------
// localStorage 단일 슬롯 저장/이어하기.
//
// 저장 키: strait72.save.v1
//
// 저장 데이터 형식:
//   {
//     schemaVersion: 1,           // 저장 스키마 버전 (v1)
//     buildTag: "v0.4.4",          // 저장 시 BUILD_TAG
//     savedAt: 1716548000000,      // Date.now()
//     reason: "auto" | "manual",   // 저장 트리거
//     campaign: { ... },           // selectedSide, difficulty, scenarioId,
//                                  //   missionId, tutorialMode, totalTurns 등
//     state: { ... }               // 전체 게임 state (turn, gauges, provinces,
//                                  //   decks, persistent, log)
//   }
//
// BUILD_TAG 불일치 시 invalidate (다음 패치에서 schema 변경되면 자동 무효화).
// =====================================================================

const STORAGE_KEY = "strait72.save.v1";
const SCHEMA_VERSION = 1;

// =====================================================================
// 저장
// =====================================================================
export function saveGame(state, campaign, buildTag, reason = "auto") {
  if (typeof localStorage === "undefined") return { ok: false, error: "no localStorage" };
  if (!state || !campaign) return { ok: false, error: "missing state/campaign" };
  // outcome 있는 (종료된) 게임은 저장하지 않음
  if (state.outcome) return { ok: false, error: "game already finished" };

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    buildTag,
    savedAt: Date.now(),
    reason,
    campaign: {
      selectedSide: campaign.selectedSide,
      difficulty: campaign.difficulty,
      scenarioId: campaign.scenarioId,
      totalTurns: campaign.totalTurns,
      missionId: campaign.missionId || null,
      tutorialMode: !!campaign.tutorialMode,
      developerMode: !!campaign.developerMode
    },
    state
  };

  try {
    const json = JSON.stringify(payload);
    localStorage.setItem(STORAGE_KEY, json);
    return { ok: true, size: json.length };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// =====================================================================
// 불러오기 — BUILD_TAG / schemaVersion 체크
// =====================================================================
export function loadGame(currentBuildTag) {
  if (typeof localStorage === "undefined") return null;
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return null; }
  if (!raw) return null;

  let data;
  try { data = JSON.parse(raw); } catch { return null; }

  // schema 체크
  if (!data || data.schemaVersion !== SCHEMA_VERSION) {
    return { invalid: true, reason: "schema_mismatch", saved: data?.schemaVersion, expected: SCHEMA_VERSION };
  }
  // BUILD 체크 (소수점까지 정확 일치 — 후속 패치 보호)
  if (data.buildTag !== currentBuildTag) {
    return { invalid: true, reason: "build_mismatch", saved: data.buildTag, expected: currentBuildTag };
  }
  // 필수 필드
  if (!data.state || !data.campaign) {
    return { invalid: true, reason: "missing_fields" };
  }
  // 끝난 게임은 무효
  if (data.state.outcome) {
    return { invalid: true, reason: "already_finished" };
  }

  return {
    invalid: false,
    schemaVersion: data.schemaVersion,
    buildTag: data.buildTag,
    savedAt: data.savedAt,
    reason: data.reason,
    campaign: data.campaign,
    state: data.state
  };
}

// 메타데이터만 (저장 존재 여부 + 표시용)
export function getSaveMetadata(currentBuildTag) {
  const r = loadGame(currentBuildTag);
  if (!r || r.invalid) return null;
  return {
    savedAt: r.savedAt,
    reason: r.reason,
    side: r.campaign.selectedSide,
    scenarioId: r.campaign.scenarioId,
    missionId: r.campaign.missionId,
    turn: r.state.turn,
    totalTurns: r.state.totalTurns
  };
}

export function hasSavedGame(currentBuildTag) {
  return getSaveMetadata(currentBuildTag) !== null;
}

// =====================================================================
// 삭제
// =====================================================================
export function clearSavedGame() {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// =====================================================================
// 진단용 (smoke 등)
// =====================================================================
export function getRawSaveData() {
  if (typeof localStorage === "undefined") return null;
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export const SAVE_CONSTANTS = {
  STORAGE_KEY,
  SCHEMA_VERSION
};

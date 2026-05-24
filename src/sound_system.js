// =====================================================================
// sound_system.js (v0.5-c.3)
// ---------------------------------------------------------------------
// 게임 SFX 관리 모듈. Web Audio API 기반.
//
// 핵심 원칙:
//   1. autoplay policy 대응 — 첫 사용자 인터랙션 후에만 AudioContext 활성화
//   2. lazy loading — 카테고리 첫 재생 시 fetch + decode
//   3. variant 랜덤 — 같은 이벤트 반복 시 다른 variant로 피로 감소
//   4. localStorage 보존 — 음소거/볼륨 설정
//   5. 게임 로직 영향 0 — play() 호출은 fire-and-forget
//
// 외부 API:
//   initOnUserGesture()  // body 클릭 한 번에 1회 호출
//   play(key)            // 카테고리 키. 자동으로 variant 랜덤
//   setEnabled(bool)
//   setVolume(0-1)
//   isEnabled() / getVolume()
//   getCategories()       // 디버그/UI용
//
// 카테고리 → 파일 매핑은 SOUND_MAP에 선언.
// =====================================================================

const STORAGE_KEY_ENABLED = "strait72.sound.enabled";
const STORAGE_KEY_VOLUME  = "strait72.sound.volume";

// 카테고리 → variant 파일 목록
// v0.5-c.3b: 전투 핵심 6종만. UI/카드/경고는 c.3c에서 추가.
const SOUND_MAP = Object.freeze({
  landing_craft_move: [
    "./assets/audio/sfx/landing_craft_move_1.mp3",
    "./assets/audio/sfx/landing_craft_move_2.mp3"
  ],
  naval_blockade: [
    "./assets/audio/sfx/naval_blockade.mp3"
  ],
  missile_launch: [
    "./assets/audio/sfx/missile_launch_1.mp3",
    "./assets/audio/sfx/missile_launch_2.mp3",
    "./assets/audio/sfx/missile_launch_3.mp3",
    "./assets/audio/sfx/missile_launch_4.mp3"
  ],
  missile_flyby: [
    "./assets/audio/sfx/missile_flyby_1.mp3",
    "./assets/audio/sfx/missile_flyby_2.mp3",
    "./assets/audio/sfx/missile_flyby_3.mp3"
  ],
  strike_impact: [
    "./assets/audio/sfx/strike_impact_1.mp3",
    "./assets/audio/sfx/strike_impact_2.mp3"
  ],
  defense_success: [
    "./assets/audio/sfx/defense_success_1.mp3",
    "./assets/audio/sfx/defense_success_2.mp3",
    "./assets/audio/sfx/defense_success_3.mp3",
    "./assets/audio/sfx/defense_success_4.mp3"
  ]
});

// 카테고리별 볼륨 보정 (소스 자체 lvl 차이 보정)
// 1.0 = 마스터 볼륨 그대로, 0.5 = 절반, 1.5 = 1.5배
const CATEGORY_GAIN = Object.freeze({
  landing_craft_move: 0.8,  // 배경 분위기, 작게
  naval_blockade: 1.0,
  missile_launch: 0.9,       // 큰 자산이라 약간 누름
  missile_flyby: 1.1,        // 짧고 약함, 약간 부스트
  strike_impact: 1.2,        // 강조
  defense_success: 1.0
});

// 카테고리별 중복 재생 쿨다운 (ms)
// 같은 사운드가 너무 자주 겹쳐 재생되는 것 방지
const CATEGORY_COOLDOWN_MS = Object.freeze({
  landing_craft_move: 800,
  naval_blockade: 5000,      // 같은 봉쇄 함대 등장은 한 번만
  missile_launch: 200,
  missile_flyby: 150,
  strike_impact: 300,
  defense_success: 400
});

// ---- 모듈 state ----
let _enabled = null;       // null = 아직 안 읽음
let _volume = null;
let _context = null;       // AudioContext
let _masterGain = null;    // GainNode
let _buffers = {};         // key → AudioBuffer[]
let _loadingPromises = {}; // key → Promise<AudioBuffer[]>
let _lastPlayAt = {};      // key → timestamp ms (쿨다운용)
let _initialized = false;

// =====================================================================
// localStorage
// =====================================================================
function loadEnabled() {
  if (typeof localStorage === "undefined") return false;  // 기본 OFF
  try {
    const v = localStorage.getItem(STORAGE_KEY_ENABLED);
    if (v === null) return false;  // 첫 방문 시 OFF (공공장소 배려)
    return v === "true";
  } catch { return false; }
}

function loadVolume() {
  if (typeof localStorage === "undefined") return 0.3;  // 기본 30%
  try {
    const v = localStorage.getItem(STORAGE_KEY_VOLUME);
    if (v === null) return 0.3;
    const f = parseFloat(v);
    return isFinite(f) ? Math.max(0, Math.min(1, f)) : 0.3;
  } catch { return 0.3; }
}

function saveEnabled(b) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY_ENABLED, b ? "true" : "false"); } catch {}
}

function saveVolume(v) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY_VOLUME, String(v)); } catch {}
}

// =====================================================================
// 초기화 — 사용자 첫 인터랙션에 호출 (autoplay policy 대응)
// =====================================================================
export function initOnUserGesture() {
  if (_initialized) return;
  if (typeof window === "undefined" || typeof AudioContext === "undefined") {
    // window.webkitAudioContext fallback도 시도
    if (typeof window !== "undefined" && window.webkitAudioContext) {
      _context = new window.webkitAudioContext();
    } else {
      console.warn("[sound] AudioContext 없음 — 사운드 비활성");
      _initialized = true;
      return;
    }
  } else {
    _context = new AudioContext();
  }
  _enabled = loadEnabled();
  _volume = loadVolume();
  _masterGain = _context.createGain();
  _masterGain.gain.value = _volume;
  _masterGain.connect(_context.destination);
  _initialized = true;
  console.log(`[sound] 초기화 완료 (enabled=${_enabled}, volume=${_volume})`);
}

// =====================================================================
// 사운드 로드 (lazy, key 첫 호출 시)
// =====================================================================
async function loadCategory(key) {
  if (_buffers[key]) return _buffers[key];
  if (_loadingPromises[key]) return _loadingPromises[key];
  const paths = SOUND_MAP[key];
  if (!paths) return null;

  _loadingPromises[key] = (async () => {
    const results = [];
    for (const p of paths) {
      try {
        const res = await fetch(p);
        if (!res.ok) {
          console.warn(`[sound] ${p} fetch 실패: ${res.status}`);
          continue;
        }
        const arrBuf = await res.arrayBuffer();
        const audioBuf = await _context.decodeAudioData(arrBuf);
        results.push(audioBuf);
      } catch (e) {
        console.warn(`[sound] ${p} 로드 실패:`, e.message);
      }
    }
    _buffers[key] = results;
    delete _loadingPromises[key];
    return results;
  })();
  return _loadingPromises[key];
}

// =====================================================================
// 재생
// =====================================================================
export function play(key) {
  if (!_initialized || !_enabled || !_context || !_masterGain) return;
  if (!SOUND_MAP[key]) {
    console.warn(`[sound] 알 수 없는 카테고리: ${key}`);
    return;
  }

  // 쿨다운 체크
  const now = Date.now();
  const last = _lastPlayAt[key] || 0;
  const cooldown = CATEGORY_COOLDOWN_MS[key] || 100;
  if (now - last < cooldown) return;
  _lastPlayAt[key] = now;

  // 이미 로드된 buffer 있으면 즉시 재생, 없으면 백그라운드 로드 후 재생
  if (_buffers[key]?.length) {
    _playBuffer(key);
  } else {
    loadCategory(key).then((bufs) => {
      if (bufs?.length && _enabled) _playBuffer(key);
    }).catch(() => {});
  }
}

function _playBuffer(key) {
  const bufs = _buffers[key];
  if (!bufs?.length) return;
  const buf = bufs[Math.floor(Math.random() * bufs.length)];
  try {
    const src = _context.createBufferSource();
    src.buffer = buf;
    // 카테고리별 gain
    const catGain = _context.createGain();
    catGain.gain.value = CATEGORY_GAIN[key] ?? 1.0;
    src.connect(catGain);
    catGain.connect(_masterGain);
    src.start(0);
  } catch (e) {
    console.warn(`[sound] play ${key} 실패:`, e.message);
  }
}

// =====================================================================
// 설정 변경
// =====================================================================
export function setEnabled(b) {
  _enabled = !!b;
  saveEnabled(_enabled);
  if (!_initialized) return;
  // 켤 때 핵심 카테고리 prefetch (사용자가 게임 시작하면서 켰을 가능성 높음)
  if (_enabled) {
    for (const key of ["missile_launch", "strike_impact", "defense_success"]) {
      loadCategory(key).catch(() => {});
    }
  }
}

export function setVolume(v) {
  _volume = Math.max(0, Math.min(1, v));
  saveVolume(_volume);
  if (_masterGain) {
    _masterGain.gain.value = _volume;
  }
}

export function isEnabled() {
  return _enabled === null ? loadEnabled() : _enabled;
}

export function getVolume() {
  return _volume === null ? loadVolume() : _volume;
}

export function isInitialized() {
  return _initialized;
}

export function getCategories() {
  return Object.keys(SOUND_MAP);
}

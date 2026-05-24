#!/usr/bin/env node
// =====================================================================
// scripts/sync_build.mjs (v0.4.5)
// ---------------------------------------------------------------------
// 한 줄로 BUILD_TAG 동기화. 다음 6곳을 한 번에 갱신:
//
//   1. src/game_rules.js  →  BUILD_TAG = "vX.Y.Z"
//   2. src/game_rules.js  →  GAME_RULES.version = "vX.Y.Z"
//   3. src/playable_app.js → EXPECTED_BUILD = "vX.Y.Z"
//   4. index.html         →  <title>해협의 72시간 - vX.Y.Z {LABEL}</title>
//   5. index.html         →  <span class="build-label">vX.Y.Z {LABEL}</span>
//   6. index.html         →  ?v={tag}-{date}  (cache buster)
//
// 사용:
//   node scripts/sync_build.mjs v0.4.5 "Polish"
//   node scripts/sync_build.mjs v0.5.0 "Visual a"
//
// run_build_self_check.mjs로 검증.
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const [, , newTag, ...labelParts] = process.argv;
const label = labelParts.join(" ") || "Polish";

if (!newTag || !/^v\d+\.\d+\.\d+/.test(newTag)) {
  console.error("Usage: node scripts/sync_build.mjs vX.Y.Z[-suffix] \"Label\"");
  console.error("Example: node scripts/sync_build.mjs v0.4.5 \"Polish\"");
  process.exit(1);
}

// cache buster prefix: "042d1" / "043" / "044" / "045" / "050a1"
function bareTag(tag) {
  // v0.4.5      → 045
  // v0.4.5-a    → 045a
  // v0.4.2-d1   → 042d1
  // v0.5.0      → 050
  // v0.5.0-a.1  → 050a1  (점은 빼서 합침)
  const m = tag.match(/^v(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9.]+))?/i);
  if (!m) return tag.replace(/[.-]/g, "");
  const [, major, minor, patch, suffix] = m;
  // suffix에서 점은 제거 (a.1 → a1)
  const cleanSuffix = suffix ? suffix.replace(/\./g, "") : "";
  return `${major}${minor}${patch}${cleanSuffix}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}

const cacheBuster = `${bareTag(newTag)}-${todayStr()}`;

const edits = [];

// 1+2. src/game_rules.js
{
  const p = path.join(ROOT, "src/game_rules.js");
  let src = fs.readFileSync(p, "utf8");
  const beforeTag = src.match(/BUILD_TAG = "([^"]+)"/)?.[1];
  src = src.replace(/BUILD_TAG = "[^"]+"/, `BUILD_TAG = "${newTag}"`);
  src = src.replace(/version: "[^"]+"/, `version: "${newTag}"`);
  fs.writeFileSync(p, src);
  edits.push({ file: "src/game_rules.js", from: beforeTag, to: newTag, count: 2 });
}

// 3. src/playable_app.js
{
  const p = path.join(ROOT, "src/playable_app.js");
  let src = fs.readFileSync(p, "utf8");
  const beforeExp = src.match(/EXPECTED_BUILD = "([^"]+)"/)?.[1];
  src = src.replace(/EXPECTED_BUILD = "[^"]+"/, `EXPECTED_BUILD = "${newTag}"`);
  fs.writeFileSync(p, src);
  edits.push({ file: "src/playable_app.js", from: beforeExp, to: newTag, count: 1 });
}

// 4+5+6. index.html
{
  const p = path.join(ROOT, "index.html");
  let src = fs.readFileSync(p, "utf8");
  let count = 0;

  // <title>
  const titleM = src.match(/<title>(해협의 72시간[^<]*)<\/title>/);
  if (titleM) {
    src = src.replace(/<title>해협의 72시간[^<]*<\/title>/, `<title>해협의 72시간 - ${newTag} ${label}</title>`);
    count++;
  }

  // header build-label span (있으면)
  if (src.includes('class="build-label"')) {
    src = src.replace(/(<span class="build-label">)[^<]*(<\/span>)/, `$1${newTag} ${label}$2`);
    count++;
  }

  // cache buster ?v=
  src = src.replace(/playable_app\.js\?v=[a-z0-9-]+/g, `playable_app.js?v=${cacheBuster}`);
  count++;

  fs.writeFileSync(p, src);
  edits.push({ file: "index.html", from: "various", to: newTag, count });
}

console.log(`\n📦 빌드 동기화 v??? → ${newTag} "${label}"`);
console.log(`   cache buster: ${cacheBuster}\n`);
for (const e of edits) {
  console.log(`  ✓ ${e.file}: ${e.from} → ${e.to} (${e.count}곳)`);
}
console.log(`\n다음 단계: node src/run_build_self_check.mjs 로 검증`);

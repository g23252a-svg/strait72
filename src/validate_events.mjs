import fs from "node:fs";

const events = JSON.parse(fs.readFileSync(new URL("../data/events_global.json", import.meta.url), "utf8"));

const errors = [];
const eventIds = new Set();

const ALLOWED_TYPES = new Set([
  "threshold_once",
  "conditional_once",
  "random_conditional",
  "random_recurring"
]);

const ALLOWED_TIMINGS = new Set([
  "start_of_turn",
  "after_operation_resolution",
  "end_of_turn"
]);

const ALLOWED_METRICS = new Set([
  "usIntervention",
  "japanIntervention",
  "koreaRearSupport",
  "internationalOpinion",
  "chinaPoliticalPressure",
  "chinaTempo",
  "chinaSupply",
  "taiwanMorale",
  "taiwanSupply",
  "taiwanGovernment",
  "taiwanCommand"
]);

const ALLOWED_EFFECT_KEYS = new Set([
  "usInterventionGain",
  "japanInterventionGain",
  "koreaRearSupportGain",
  "usInterventionGainReduction",
  "japanInterventionGainReduction",
  "internationalOpinion",
  "chinaPoliticalPressure",
  "chinaTempo",
  "chinaSupply",
  "taiwanMorale",
  "taiwanSupply",
  "taiwanGovernment",
  "taiwanCommand",
  "weatherPenalty",
  "landingProgressModifier",
  "diplomaticPressureModifier"
]);

function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function validateCondition(event, condition, path) {
  if (condition.once !== undefined && condition.once !== true) {
    errors.push(`${event.id}.${path}.once must be true when present`);
  }

  if (condition.metric) {
    if (!ALLOWED_METRICS.has(condition.metric)) {
      errors.push(`${event.id}.${path}.metric unknown: ${condition.metric}`);
    }

    const comparators = ["gte", "lte", "gt", "lt", "eq"];
    const used = comparators.filter((key) => condition[key] !== undefined);
    if (used.length !== 1) {
      errors.push(`${event.id}.${path}.metric requires exactly one comparator: ${used.join(",")}`);
    } else if (typeof condition[used[0]] !== "number") {
      errors.push(`${event.id}.${path}.${used[0]} must be number`);
    }
  }

  if (condition.turnGte !== undefined && typeof condition.turnGte !== "number") {
    errors.push(`${event.id}.${path}.turnGte must be number`);
  }

  if (condition.probability !== undefined) {
    if (typeof condition.probability !== "number" || condition.probability < 0 || condition.probability > 1) {
      errors.push(`${event.id}.${path}.probability must be 0..1`);
    }
  }
}

for (const event of events) {
  if (!event.id) errors.push("event missing id");
  else if (eventIds.has(event.id)) errors.push(`duplicate event id: ${event.id}`);
  else eventIds.add(event.id);

  if (!event.name) errors.push(`${event.id} missing name`);
  if (!event.description) errors.push(`${event.id} missing description`);

  if (!ALLOWED_TYPES.has(event.type)) errors.push(`${event.id} invalid type: ${event.type}`);
  if (!ALLOWED_TIMINGS.has(event.timing)) errors.push(`${event.id} invalid timing: ${event.timing}`);

  if (!event.triggerWhen) errors.push(`${event.id} missing triggerWhen`);
  else {
    const hasAll = event.triggerWhen.all !== undefined;
    const hasAny = event.triggerWhen.any !== undefined;

    if (hasAll && hasAny) errors.push(`${event.id} triggerWhen cannot have both all and any`);

    for (const [groupName, conditions] of [["all", event.triggerWhen.all], ["any", event.triggerWhen.any]]) {
      for (const [index, condition] of asArray(conditions).entries()) {
        validateCondition(event, condition, `triggerWhen.${groupName}[${index}]`);
      }
    }

    if (event.triggerWhen.once !== undefined && event.triggerWhen.once !== true) {
      errors.push(`${event.id}.triggerWhen.once must be true when present`);
    }

    if (event.triggerWhen.maxOccurrences !== undefined) {
      if (!Number.isInteger(event.triggerWhen.maxOccurrences) || event.triggerWhen.maxOccurrences < 1) {
        errors.push(`${event.id}.triggerWhen.maxOccurrences must be positive integer`);
      }
    }

    if (event.triggerWhen.cooldownTurns !== undefined) {
      if (!Number.isInteger(event.triggerWhen.cooldownTurns) || event.triggerWhen.cooldownTurns < 1) {
        errors.push(`${event.id}.triggerWhen.cooldownTurns must be positive integer`);
      }
    }
  }

  if (!event.effects || typeof event.effects !== "object") {
    errors.push(`${event.id} missing effects`);
  } else {
    for (const key of Object.keys(event.effects)) {
      if (!ALLOWED_EFFECT_KEYS.has(key)) errors.push(`${event.id} unknown effect key: ${key}`);
      if (typeof event.effects[key] !== "number") errors.push(`${event.id}.effects.${key} must be number`);
    }
  }

  if (event.duration !== undefined) {
    if (!Number.isInteger(event.duration) || event.duration < 1) {
      errors.push(`${event.id}.duration must be positive integer`);
    }
  }

  if (event.ui) {
    if (!event.ui.severity) errors.push(`${event.id}.ui missing severity`);
    if (!event.ui.icon) errors.push(`${event.id}.ui missing icon`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

function countByType(items) {
  const acc = {};
  for (const item of items) acc[item.type] = (acc[item.type] || 0) + 1;
  return acc;
}

function countByTiming(items) {
  const acc = {};
  for (const item of items) acc[item.timing] = (acc[item.timing] || 0) + 1;
  return acc;
}

console.log("global events validation passed");
console.log(`events=${events.length}`);
console.log(`types=${JSON.stringify(countByType(events))}`);
console.log(`timings=${JSON.stringify(countByTiming(events))}`);
console.log(`random=${events.filter((event) => event.type.startsWith("random")).length}`);
console.log(`once=${events.filter((event) => event.type.includes("once") || event.triggerWhen?.once === true || event.triggerWhen?.maxOccurrences === 1).length}`);

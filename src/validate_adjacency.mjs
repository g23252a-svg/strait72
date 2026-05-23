import fs from "node:fs";

const provinces = JSON.parse(fs.readFileSync(new URL("../data/provinces.json", import.meta.url), "utf8"));
const axes = JSON.parse(fs.readFileSync(new URL("../data/axes.json", import.meta.url), "utf8"));
const adjacency = JSON.parse(fs.readFileSync(new URL("../data/province_adjacency.json", import.meta.url), "utf8"));

const provinceIds = new Set(provinces.map((p) => p.id));
const axisIds = new Set(axes.map((a) => a.id));
const controlStages = new Set(adjacency.controlOrder);
const routeIds = new Set();
const errors = [];

for (const route of adjacency.routes) {
  if (routeIds.has(route.id)) errors.push(`duplicate route id: ${route.id}`);
  routeIds.add(route.id);

  if (!provinceIds.has(route.from)) errors.push(`unknown from province: ${route.id} -> ${route.from}`);
  if (!provinceIds.has(route.to)) errors.push(`unknown to province: ${route.id} -> ${route.to}`);
  if (route.preferredAxis && !axisIds.has(route.preferredAxis)) {
    errors.push(`unknown preferredAxis: ${route.id} -> ${route.preferredAxis}`);
  }
  if (route.requiresSourceControlAtLeast && !controlStages.has(route.requiresSourceControlAtLeast)) {
    errors.push(`unknown requiresSourceControlAtLeast: ${route.id} -> ${route.requiresSourceControlAtLeast}`);
  }
  if (typeof route.movementCost !== "number" || route.movementCost < 1) {
    errors.push(`invalid movementCost: ${route.id}`);
  }
  if (typeof route.attackCost !== "number" || route.attackCost < 1) {
    errors.push(`invalid attackCost: ${route.id}`);
  }
}

const landableProvinceIds = provinces
  .filter((p) => p.type !== "sea_zone" && Array.isArray(p.tags) && p.tags.includes("coastal"))
  .map((p) => p.id)
  .sort();

const landingTargets = adjacency.routes
  .filter((r) => r.type === "sea_landing" && r.landingAllowed)
  .map((r) => r.to)
  .sort();

for (const id of landableProvinceIds) {
  if (!landingTargets.includes(id)) errors.push(`landable province has no sea_landing route: ${id}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("province_adjacency.json validation passed");
console.log(`routes=${adjacency.routes.length}`);
console.log(`landingTargets=${landingTargets.join(",")}`);

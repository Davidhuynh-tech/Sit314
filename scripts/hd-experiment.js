const fs = require("fs");
const path = require("path");
const { createEdgeFilter } = require("../shared/edgeFilter");
const { createAdmissionControl } = require("../shared/admission");
const { createPipeline } = require("../microservices/event-pipeline");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildBurst(storeCount, skuCount) {
  const shelf = [];
  const pos = [];
  for (let store = 1; store <= storeCount; store += 1) {
    for (let sku = 1; sku <= skuCount; sku += 1) {
      let quantity = 40;
      for (let step = 0; step < 20; step += 1) {
        quantity = Math.max(0, quantity - 1);
        shelf.push({ store_id: `store_${store}`, sku_id: `sku_${sku}`, quantity, source: "shelf_sensor" });
      }
      for (let step = 0; step < 6; step += 1) {
        pos.push({
          store_id: `store_${store}`,
          sku_id: `sku_${sku}`,
          quantity_sold: 12 + step * 3,
          source: "pos",
        });
      }
    }
  }
  return { shelf, pos };
}

async function runScenario(label, { storeCount, useEdge, useAdmission }) {
  const { shelf, pos } = buildBurst(storeCount, 10);
  const filter = createEdgeFilter({ deadband: useEdge ? 5 : 0, reorderThreshold: 15 });
  const admission = createAdmissionControl({ softLimit: useAdmission ? 500 : Number.MAX_SAFE_INTEGER, hardLimit: Number.MAX_SAFE_INTEGER });
  const pipeline = createPipeline();
  let cloudMessages = 0;
  let ingressDepth = 0;
  const started = Date.now();

  for (const reading of shelf) {
    if (!filter.shouldRelayShelf(reading)) continue;
    if (!admission.admit(ingressDepth, "shelf")) continue;
    ingressDepth += 1;
    cloudMessages += 1;
  }
  for (const sale of pos) {
    if (!admission.admit(ingressDepth, "pos")) continue;
    pipeline.enqueueSale(sale);
    ingressDepth += 1;
    cloudMessages += 1;
  }

  const drained = await pipeline.drain();
  return {
    label,
    stores: storeCount,
    offered: shelf.length + pos.length,
    shelfOffered: shelf.length,
    posOffered: pos.length,
    cloudMessages,
    shelfRelayed: filter.stats().relayed,
    shelfSuppressed: filter.stats().suppressed,
    shelfShed: admission.stats().shelfRejected,
    posRejected: admission.stats().posRejected,
    orders: drained.orders.length,
    forecasts: drained.forecasts.length,
    drainMs: drained.elapsedMs,
    elapsedMs: Date.now() - started,
    peakIngress: ingressDepth,
    peakQueue: pipeline.bus.peak("sales-events"),
  };
}

async function main() {
  const runs = [];
  for (const stores of [5, 20, 50]) {
    const baseline = await runScenario("baseline", { storeCount: stores, useEdge: false, useAdmission: false });
    const treatment = await runScenario("edge-admission", { storeCount: stores, useEdge: true, useAdmission: true });
    assert(treatment.orders === baseline.orders, `${stores} stores: orders changed (${baseline.orders} -> ${treatment.orders})`);
    assert(treatment.posRejected === 0, `${stores} stores: POS events were shed`);
    assert(treatment.cloudMessages < baseline.cloudMessages, `${stores} stores: treatment did not reduce cloud messages`);
    runs.push({ baseline, treatment, messageReductionPct: Math.round((1 - treatment.cloudMessages / baseline.cloudMessages) * 1000) / 10 });
    console.log(JSON.stringify({ stores, baselineOrders: baseline.orders, treatmentOrders: treatment.orders, baselineMessages: baseline.cloudMessages, treatmentMessages: treatment.cloudMessages, reductionPct: runs[runs.length - 1].messageReductionPct }));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    policy: {
      edgeDeadband: 5,
      reorderThreshold: 15,
      admissionSoftLimit: 500,
      protectedClass: "pos",
    },
    runs,
  };
  const out = path.join(__dirname, "..", "docs", "hd_experiment_results.json");
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

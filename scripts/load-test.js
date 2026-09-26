const fs = require("fs");
const path = require("path");
const forecasting = require("../microservices/forecasting-service/handler");
const { createPipeline } = require("../microservices/event-pipeline");

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function directBurst(events) {
  const started = Date.now();
  await forecasting.handler({ Records: events });
  return Date.now() - started;
}

async function queuedBurst(events) {
  const pipeline = createPipeline();
  const enqueueStarted = Date.now();
  for (const event of events) {
    const body = JSON.parse(event.body);
    pipeline.enqueueSale(body);
  }
  const queuedMs = Date.now() - enqueueStarted;
  const peak = pipeline.bus.peak("sales-events");
  const drained = await pipeline.drain();
  return {
    queuedMs,
    drainMs: drained.elapsedMs,
    peak,
    orders: drained.orders.length,
    forecasts: drained.forecasts.length,
    dlq: drained.queues.salesDlq + drained.queues.forecastDlq + drained.queues.approvedDlq,
  };
}

function buildEvents(storeCount, skuCount, observations) {
  const events = [];
  for (let store = 1; store <= storeCount; store += 1) {
    for (let sku = 1; sku <= skuCount; sku += 1) {
      for (let step = 0; step < observations; step += 1) {
        events.push({
          body: JSON.stringify({
            store_id: `store_${store}`,
            sku_id: `sku_${sku}`,
            quantity_sold: 12 + step * 3,
            source: "pos",
          }),
        });
      }
    }
  }
  return events;
}

async function main() {
  const steps = [
    { stores: 5, skus: 10 },
    { stores: 20, skus: 10 },
    { stores: 50, skus: 10 },
  ];
  const observations = 6;
  const runs = [];

  for (const step of steps) {
    const events = buildEvents(step.stores, step.skus, observations);
    const directMs = await directBurst(events);
    const queued = await queuedBurst(events);
    const row = {
      stores: step.stores,
      skus: step.skus,
      events: events.length,
      directForecastMs: directMs,
      queueAcceptMs: queued.queuedMs,
      pipelineDrainMs: queued.drainMs,
      peakSalesQueue: queued.peak,
      forecasts: queued.forecasts,
      orders: queued.orders,
      dlq: queued.dlq,
    };
    runs.push(row);
    console.log(JSON.stringify(row));
  }

  const drainTimes = runs.map((row) => row.pipelineDrainMs).sort((a, b) => a - b);
  const summary = {
    generatedAt: new Date().toISOString(),
    note: "Local burst against the in-process SQS stand-in. CloudWatch alarms and reserved concurrency are defined in infra/template.yaml and docs/auto_scaling_plan.md.",
    runs,
    pipelineDrainMs: {
      p50: percentile(drainTimes, 50),
      max: drainTimes[drainTimes.length - 1],
    },
  };

  const out = path.join(__dirname, "..", "docs", "load_test_results.json");
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

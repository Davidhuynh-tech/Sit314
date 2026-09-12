const { createShelfState, nextShelfReading } = require("../../shared/shelfReadingGenerator");
const { connectMqtt, getMqttTarget } = require("../../shared/mqttClient");

const DRY_RUN = process.argv.includes("--dry-run");
const STORE_COUNT = parseInt(process.env.STORE_COUNT || "5", 10);
const SKU_COUNT = parseInt(process.env.SKU_COUNT || "10", 10);
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || "3000", 10);

const state = createShelfState(STORE_COUNT, SKU_COUNT);

function localTopicFor(storeId) {
  // Local, in-store topic namespace - this never leaves the store network
  // directly; the Controller is the only thing that bridges it upward.
  return `local/${storeId}/raw/shelf`;
}

function startDryRun() {
  console.log(`[micro-sensor] DRY RUN — ${STORE_COUNT} stores x ${SKU_COUNT} SKUs, every ${INTERVAL_MS}ms`);
  Object.keys(state).forEach((key) => {
    setInterval(() => {
      const reading = nextShelfReading(state, key);
      console.log(`[${localTopicFor(reading.store_id)}]`, JSON.stringify(reading));
    }, INTERVAL_MS + Math.floor(Math.random() * 500));
  });
}

function startMqtt() {
  console.log(`[micro-sensor] Connecting to ${getMqttTarget()} ...`);
  const client = connectMqtt("sit314-micro-sensor");

  client.on("connect", () => {
    console.log(`[micro-sensor] Connected. Publishing ${STORE_COUNT} stores x ${SKU_COUNT} SKUs to local topics.`);
    Object.keys(state).forEach((key) => {
      setInterval(() => {
        const reading = nextShelfReading(state, key);
        client.publish(localTopicFor(reading.store_id), JSON.stringify(reading));
      }, INTERVAL_MS + Math.floor(Math.random() * 500));
    });
  });

  client.on("error", (err) => {
    console.error("[micro-sensor] MQTT connection error:", err.message);
    console.error("[micro-sensor] Tip: run with --dry-run if you don't have a broker running yet.");
    process.exit(1);
  });
}

if (DRY_RUN) startDryRun();
else startMqtt();

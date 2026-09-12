/**
 * Card-reader device
 * -------------------
 * Simulates a POS card-reader/terminal at a checkout. Like the
 * micro-sensor, this only talks to the in-store network - it publishes
 * raw transaction events to a local topic that the store Controller
 * picks up and relays to the cloud-facing topics.
 *
 * Usage:
 *   node devices/card-reader/card_reader.js
 *   node devices/card-reader/card_reader.js --dry-run
 *
 * Env vars: MQTT_BROKER_URL, AWS_IOT_ENDPOINT, STORE_COUNT, SKU_COUNT, INTERVAL_MS (base tick)
 */

const { pickPromoStores, timeOfDayMultiplier, buildCardSwipe } = require("../../shared/posEventGenerator");
const { connectMqtt, getMqttTarget } = require("../../shared/mqttClient");

const DRY_RUN = process.argv.includes("--dry-run");
const STORE_COUNT = parseInt(process.env.STORE_COUNT || "5", 10);
const SKU_COUNT = parseInt(process.env.SKU_COUNT || "10", 10);
const BASE_INTERVAL_MS = parseInt(process.env.INTERVAL_MS || "1500", 10);

const promoStores = pickPromoStores(STORE_COUNT);
if (promoStores.size > 0) {
  console.log(`[card-reader] Promo active this session for: ${[...promoStores].join(", ")}`);
}

function localTopicFor(storeId) {
  return `local/${storeId}/raw/pos`;
}

function scheduleStore(storeId, publish) {
  const tick = () => {
    const multiplier = timeOfDayMultiplier() * (promoStores.has(storeId) ? 3 : 1);
    const swipe = buildCardSwipe(storeId, SKU_COUNT, promoStores);
    publish(storeId, swipe);
    const nextDelay = Math.max(150, BASE_INTERVAL_MS / multiplier + Math.random() * 300);
    setTimeout(tick, nextDelay);
  };
  setTimeout(tick, Math.random() * 1000);
}

function startDryRun() {
  console.log(`[card-reader] DRY RUN — ${STORE_COUNT} stores x ${SKU_COUNT} SKUs`);
  for (let s = 1; s <= STORE_COUNT; s++) {
    scheduleStore(`store_${s}`, (storeId, swipe) => {
      console.log(`[${localTopicFor(storeId)}]`, JSON.stringify(swipe));
    });
  }
}

function startMqtt() {
  console.log(`[card-reader] Connecting to ${getMqttTarget()} ...`);
  const client = connectMqtt("sit314-card-reader");

  client.on("connect", () => {
    console.log(`[card-reader] Connected. Publishing ${STORE_COUNT} stores x ${SKU_COUNT} SKUs to local topics.`);
    for (let s = 1; s <= STORE_COUNT; s++) {
      scheduleStore(`store_${s}`, (storeId, swipe) => {
        client.publish(localTopicFor(storeId), JSON.stringify(swipe));
      });
    }
  });

  client.on("error", (err) => {
    console.error("[card-reader] MQTT connection error:", err.message);
    console.error("[card-reader] Tip: run with --dry-run if you don't have a broker running yet.");
    process.exit(1);
  });
}

if (DRY_RUN) startDryRun();
else startMqtt();

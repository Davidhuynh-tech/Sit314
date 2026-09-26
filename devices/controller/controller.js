const fs = require("fs");
const { createEdgeFilter } = require("../../shared/edgeFilter");
require("dotenv").config(); // loads AWS_IOT_ENDPOINT etc. from a .env file in the project root, if present

const edgeFilter = createEdgeFilter({
  deadband: Number(process.env.EDGE_DEADBAND ?? 5),
  reorderThreshold: Number(process.env.REORDER_THRESHOLD ?? 15),
});

const DEMO_MODE = process.argv.includes("--demo") || process.argv.includes("--dry-run");
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const STORE_ID = process.env.STORE_ID || "store_1"; // a controller belongs to one store

// AWS IoT Core connection settings - only used if AWS_IOT_ENDPOINT is set.
const AWS_IOT_ENDPOINT = process.env.AWS_IOT_ENDPOINT;
const AWS_IOT_CERT_PATH = process.env.AWS_IOT_CERT_PATH;
const AWS_IOT_KEY_PATH = process.env.AWS_IOT_KEY_PATH;
const AWS_IOT_CA_PATH = process.env.AWS_IOT_CA_PATH;

function buildConnectOptions() {
  if (!AWS_IOT_ENDPOINT) {
    // Local broker, plain connection (dev/testing).
    return { url: MQTT_BROKER_URL, options: { connectTimeout: 5000, clientId: `controller-${STORE_ID}-${Date.now()}` } };
  }

  // AWS IoT Core, X.509 mutual TLS on port 8883.
  if (!AWS_IOT_CERT_PATH || !AWS_IOT_KEY_PATH || !AWS_IOT_CA_PATH) {
    throw new Error("AWS_IOT_ENDPOINT is set but AWS_IOT_CERT_PATH / AWS_IOT_KEY_PATH / AWS_IOT_CA_PATH are missing.");
  }
  return {
    url: `mqtts://${AWS_IOT_ENDPOINT}:8883`,
    options: {
      cert: fs.readFileSync(AWS_IOT_CERT_PATH),
      key: fs.readFileSync(AWS_IOT_KEY_PATH),
      ca: fs.readFileSync(AWS_IOT_CA_PATH),
      family: 4,
      clientId: `controller-${STORE_ID}-${Date.now()}`, // must be unique per connection - AWS IoT disconnects duplicates
      protocol: "mqtts",
      connectTimeout: 8000,
    },
  };
}

// Very light edge-side validation, shared by both modes - this is what
// the controller actually contributes beyond just being a pass-through:
// it can reject malformed device data before it ever reaches the cloud.
function validateShelfReading(p) {
  return p && p.store_id && p.sku_id && typeof p.quantity === "number" && p.quantity >= 0;
}
function validatePosSwipe(p) {
  return p && p.store_id && p.sku_id && typeof p.quantity_sold === "number";
}

function relay(kind, payload) {
  const cloudTopic = kind === "shelf"
    ? `stores/${payload.store_id}/sensors/shelf`
    : `stores/${payload.store_id}/pos/transactions`;
  return { cloudTopic, payload: { ...payload, relayed_by: `controller-${STORE_ID}`, relayed_at: new Date().toISOString() } };
}

function runDemo() {
  console.log(`[controller:${STORE_ID}] DEMO MODE — simulating local devices internally, relaying to cloud topics`);
  const { createShelfState, nextShelfReading } = require("../../shared/shelfReadingGenerator");
  const { pickPromoStores, buildCardSwipe } = require("../../shared/posEventGenerator");

  const shelfState = createShelfState(1, 5); // this controller's store only: 5 SKUs
  // Re-key shelfState to this controller's actual store id for realism
  Object.values(shelfState).forEach((item) => { item.storeId = STORE_ID; });
  const promoStores = pickPromoStores(1);

  // Simulated micro-sensor traffic arriving at the controller
  Object.keys(shelfState).forEach((key) => {
    setInterval(() => {
      const reading = nextShelfReading(shelfState, key);
      if (!validateShelfReading(reading)) {
        console.warn(`[controller:${STORE_ID}] Rejected malformed shelf reading`);
        return;
      }
      if (!edgeFilter.shouldRelayShelf(reading)) return;
      const { cloudTopic, payload } = relay("shelf", reading);
      console.log(`[${cloudTopic}]`, JSON.stringify(payload));
    }, 3000 + Math.random() * 500);
  });

  // Simulated card-reader traffic arriving at the controller
  setInterval(() => {
    const swipe = buildCardSwipe(STORE_ID, 5, promoStores);
    if (!validatePosSwipe(swipe)) {
      console.warn(`[controller:${STORE_ID}] Rejected malformed POS swipe`);
      return;
    }
    const { cloudTopic, payload } = relay("pos", swipe);
    console.log(`[${cloudTopic}]`, JSON.stringify(payload));
  }, 1500 + Math.random() * 500);
}

function runMqttRelay() {
  const mqtt = require("mqtt");
  const { url, options } = buildConnectOptions();
  const mode = AWS_IOT_ENDPOINT ? "AWS IoT Core (TLS)" : "local broker";
  console.log(`[controller:${STORE_ID}] Connecting to ${url} via ${mode} ...`);
  const client = mqtt.connect(url, options);

  client.on("connect", () => {
    console.log(`[controller:${STORE_ID}] Connected via ${mode}. Subscribing to local device topics for this store.`);
    client.subscribe(`local/${STORE_ID}/raw/shelf`);
    client.subscribe(`local/${STORE_ID}/raw/pos`);
  });

  client.on("message", (topic, messageBuf) => {
    let payload;
    try {
      payload = JSON.parse(messageBuf.toString());
    } catch (e) {
      console.warn(`[controller:${STORE_ID}] Dropped unparseable message on ${topic}`);
      return;
    }

    if (topic.endsWith("/raw/shelf")) {
      if (!validateShelfReading(payload)) return console.warn(`[controller:${STORE_ID}] Rejected malformed shelf reading`);
      if (!edgeFilter.shouldRelayShelf(payload)) return;
      const { cloudTopic, payload: out } = relay("shelf", payload);
      client.publish(cloudTopic, JSON.stringify(out));
    } else if (topic.endsWith("/raw/pos")) {
      if (!validatePosSwipe(payload)) return console.warn(`[controller:${STORE_ID}] Rejected malformed POS swipe`);
      const { cloudTopic, payload: out } = relay("pos", payload);
      client.publish(cloudTopic, JSON.stringify(out));
    }
  });

  client.on("error", (err) => {
    console.error(`[controller:${STORE_ID}] MQTT connection error.`);
    console.error(`  message: ${err && err.message ? err.message : "(empty)"}`);
    console.error(`  code:    ${err && err.code ? err.code : "(none)"}`);
    console.error(`  reason:  ${err && err.reason ? err.reason : "(none)"}`);
    console.error(`  full error object:`, err);
    console.error(`[controller:${STORE_ID}] Tip: run with --demo if you don't have a broker or other devices running yet.`);
    process.exit(1);
  });

  client.on("close", () => {
    console.error(`[controller:${STORE_ID}] Connection closed by the broker (this often fires alongside/instead of a detailed error for TLS/auth failures).`);
  });
}

if (DEMO_MODE) runDemo();
else runMqttRelay();

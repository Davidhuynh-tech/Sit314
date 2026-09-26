# SIT314 Distinction Project — Demand Forecasting & Auto-Replenishment

Student: Gia Kiet Huynh (David) — 223482424
Unit: SIT314 — Cloud Enabling Technologies

An automatic stock management and delivery system for supermarkets, focused on the
**demand forecasting and auto-replenishment** module. Full architecture, scalability
approach and breaking-point analysis are documented in `docs/distinction_plan.pdf`
(Task 1, signed off).

## Current status (final submission — see project_report.pdf)

- [x] Requirements, architecture, and scalability/breaking-point analysis (Task 1)
- [x] Development environment set up (AWS account, IAM, Node.js, Node-RED, this repo)
- [x] Device simulation layer (Node.js) — micro-sensor, controller, card-reader — see `devices/`
- [x] Node-RED flow: MQTT ingestion, normalisation, noise filtering, threshold-based
      low-stock alerting, partitioned by store, then HTTP handoff to the event buffer
- [x] Forecasting, Replenishment Decision, and Order Dispatch microservices
- [x] Event-driven wiring: `sales-events` → `forecast-ready` → `replenishment-approved`, with DLQs
- [x] Storage adapters: in-memory, file-backed (local stand-in), and DynamoDB
- [x] Auto-scaling plan and CloudFormation (`docs/auto_scaling_plan.md`, `infra/template.yaml`)
- [x] Local scalability burst (5 / 20 / 50 stores) — `docs/load_test_results.json`
- [x] Secure deployment controls: TLS to AWS IoT, encrypted queues/tables, least-privilege IAM, input validation

```bash
npm test          # service tests, direct pipeline, queue pipeline, file store
npm run test:load # 5, 20 and 50 store burst
npm run pipeline:serve   # http://127.0.0.1:1881  (Node-RED posts here)
```

## Simulated device architecture

Rather than one flat "simulator" script, the device layer mirrors a real in-store IoT
deployment: physical devices don't talk to the cloud directly — they talk to a local
store controller (edge gateway), which validates and relays their data upward.

```
  micro-sensor (shelf-weight/RFID)  ---.
                                        +-->  controller  -->  stores/{id}/sensors/shelf
  card-reader (POS terminal)        ---'     (edge gateway)   stores/{id}/pos/transactions
                                                                       |
                                                                       v
                                                           Node-RED flow (cloud-facing)
```

- **`devices/micro-sensor/sensor.js`** — simulates a shelf-weight/RFID sensor. Publishes
  raw readings to a *local* topic (`local/{store_id}/raw/shelf`) — it never talks to the
  cloud directly, matching how a real embedded sensor would behave.
- **`devices/card-reader/card_reader.js`** — simulates a POS terminal/card reader.
  Publishes raw swipe events to `local/{store_id}/raw/pos`.
- **`devices/controller/controller.js`** — simulates the in-store gateway. Subscribes to
  both local topics for its store, does light edge-side validation (drops malformed
  events before they reach the cloud), and relays valid events to the cloud-facing
  topics — `stores/{store_id}/sensors/shelf` and `stores/{store_id}/pos/transactions` —
  which is exactly what the Node-RED flow already subscribes to, so no flow changes
  were needed when this was introduced.
- **`shared/`** — reading/transaction generator logic shared between the micro-sensor,
  card-reader, and the controller's self-contained demo mode.

## Repository structure

```
devices/
  micro-sensor/        Shelf-weight/RFID sensor device simulator
  controller/           In-store edge gateway (aggregates + relays to the cloud)
  card-reader/          POS terminal device simulator
shared/                 Reading/transaction generators shared across devices
node-red-flows/         Exported Node-RED flow (import via Node-RED's menu > Import)
microservices/          Forecasting, Replenishment Decision, Order Dispatch services
                        (see microservices/README.md) - built, tested, and chainable
                        end-to-end via microservices/run-pipeline-demo.js
docs/                   Task 1/2 status PDFs and docs/auto_scaling_plan.md
```

## Running the devices locally

Each device can run in two modes: a **real MQTT mode** (needs a broker, e.g. Mosquitto
locally or AWS IoT Core once deployed) or a **standalone mode** with no broker required.

```bash
npm install

# Standalone (no broker needed) - good for quickly checking each device works
npm run device:sensor:dry
npm run device:card-reader:dry
npm run device:controller:demo   # simulates its own local devices internally

# Real MQTT relay mode (requires a broker + the sensor/card-reader devices running too)
MQTT_BROKER_URL=mqtt://localhost:1883 STORE_ID=store_1 npm run device:controller
MQTT_BROKER_URL=mqtt://localhost:1883 npm run device:sensor
MQTT_BROKER_URL=mqtt://localhost:1883 npm run device:card-reader

# AWS IoT Core — copy .env.example to .env, set AWS_IOT_ENDPOINT, then:
npm run device:controller
npm run device:sensor
npm run device:card-reader
```

The AWS IoT connection uses mqtts on port 8883 with the device certificate, private
key, and Amazon Root CA from `.env` (`AWS_IOT_CERT_PATH`, `AWS_IOT_KEY_PATH`,
`AWS_IOT_CA_PATH`). Get the endpoint from the AWS IoT console (Settings, or Connect).

In real mode, run one controller per store (set `STORE_ID` accordingly) alongside the
sensor/card-reader devices publishing to that store's local topics.

## Running the Node-RED flow locally

```bash
npm install -g --unsafe-perm node-red   # if not already installed
node-red
# Then in the editor (http://localhost:1880): Menu > Import > select node-red-flows/flows.json
```

The flow subscribes to the same `stores/+/sensors/shelf` and `stores/+/pos/transactions`
topics that the controller relays to. Normalised POS events are posted to
`http://127.0.0.1:1881/ingest/pos` and shelf readings to `/ingest/shelf`. Start that
buffer with `npm run pipeline:serve` before the flow is deployed.

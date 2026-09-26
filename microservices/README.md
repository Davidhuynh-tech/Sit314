# Microservices

Three event-driven Node.js services implementing the Week 4-5 pipeline from the Task 1
plan: **Forecasting → Replenishment Decision → Order Dispatch & Notification**.

```
forecasting-service/
  lib/forecast.js     Moving average + exponential smoothing (Task 1 baseline method)
  lib/store.js         Pluggable storage: in-memory (default, tested) / DynamoDB (stub, Week 6)
  handler.js            Lambda handler
  test/run-local.js     Standalone test - run: node microservices/forecasting-service/test/run-local.js

replenishment-decision-service/
  lib/decision.js      Order-quantity/timing decision logic
  lib/store.js          Pluggable storage for stock levels + supplier lead time
  handler.js             Lambda handler
  test/run-local.js      Standalone test covering 3 scenarios (healthy / low stock / high-demand)

order-dispatch-service/
  lib/dispatch.js       Creates the supplier order record
  lib/notify.js          Notification stub (SNS/SES in production)
  lib/store.js            Pluggable storage for order records
  handler.js               Lambda handler
  test/run-local.js        Standalone test

run-pipeline-demo.js    Chains all three handlers together end-to-end with no
                        infrastructure required - the fastest way to demo the
                        whole pipeline (raw POS events -> forecast -> decision -> order)
```

## Design notes

- **Pluggable storage adapters:** every service's `lib/store.js` exports both an
  in-memory implementation (used for local testing, fully working) and a DynamoDB
  implementation (written but not yet exercised - targeted for Week 6, "Initial AWS
  deployment"). The handler logic doesn't change when swapping between them.
- **Independently deployable:** each service has its own `handler.js` entry point,
  matching NFR6 (maintainability/extensibility) from the Task 1 requirements - each
  can be deployed as a separate Lambda function without touching the others.
- **Local-first testing:** every service can be exercised with zero AWS account/cost,
  which is what let these be built and verified before any cloud deployment work began.

## Running everything

```bash
# Each service individually:
node microservices/forecasting-service/test/run-local.js
node microservices/replenishment-decision-service/test/run-local.js
node microservices/order-dispatch-service/test/run-local.js

# Full end-to-end pipeline in one command:
node microservices/run-pipeline-demo.js
```

## Event-driven wiring

`event-pipeline.js` replaces the direct calls in `run-pipeline-demo.js` with three
queues (`sales-events`, `forecast-ready`, `replenishment-approved`). Each queue has a
dead-letter path after 3 failed receives. `ingest-server.js` is what Node-RED posts to.

```bash
node microservices/test/run-queue-pipeline.js
node microservices/test/run-file-store.js
npm run pipeline:serve
```

Set `STORAGE_BACKEND=memory` (default), `file`, or `dynamodb`. The DynamoDB tables,
SQS queues, DLQs, and least-privilege role are in `infra/template.yaml`. AWS IoT
device connections stay on mutual TLS (`shared/mqttClient.js`).

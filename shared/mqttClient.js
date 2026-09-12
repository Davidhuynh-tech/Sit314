/**
 * MQTT connection helper
 * ----------------------
 * Local broker (default): MQTT_BROKER_URL, e.g. mqtt://localhost:1883
 * AWS IoT Core: set AWS_IOT_ENDPOINT and the device cert/key/CA are attached
 * automatically (mqtts on port 8883).
 */

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");

const ROOT = path.join(__dirname, "..");

const DEFAULT_CERT =
  "959bb785b945f64da38b860a30fd85b61821b4961ad06c3d79abb308b872075a-certificate.pem.crt";
const DEFAULT_KEY =
  "959bb785b945f64da38b860a30fd85b61821b4961ad06c3d79abb308b872075a-private.pem.key";
const DEFAULT_CA = "AmazonRootCA1.pem";

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function resolveCred(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function awsIotHost() {
  return (process.env.AWS_IOT_ENDPOINT || "")
    .trim()
    .replace(/^mqtts?:\/\//i, "")
    .replace(/:8883$/, "");
}

function getMqttTarget() {
  const host = awsIotHost();
  if (host) return `mqtts://${host}:8883`;
  return process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
}

function readRequired(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

function connectMqtt(clientId, extraOptions = {}) {
  const host = awsIotHost();
  if (host) {
    const keyPath = resolveCred(process.env.AWS_IOT_KEY_PATH || DEFAULT_KEY);
    const certPath = resolveCred(process.env.AWS_IOT_CERT_PATH || DEFAULT_CERT);
    const caPath = resolveCred(process.env.AWS_IOT_CA_PATH || DEFAULT_CA);
    return mqtt.connect({
      connectTimeout: 15000,
      ...extraOptions,
      host,
      port: 8883,
      protocol: "mqtts",
      protocolVersion: 4,
      clientId,
      key: readRequired(keyPath, "AWS IoT private key"),
      cert: readRequired(certPath, "AWS IoT device certificate"),
      ca: readRequired(caPath, "AWS IoT CA certificate"),
      rejectUnauthorized: true,
      keepalive: 60,
      reconnectPeriod: 2000,
    });
  }

  return mqtt.connect(process.env.MQTT_BROKER_URL || "mqtt://localhost:1883", {
    connectTimeout: 5000,
    clientId,
    ...extraOptions,
  });
}

module.exports = { connectMqtt, getMqttTarget };

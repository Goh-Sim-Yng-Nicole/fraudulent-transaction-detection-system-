import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function bool01(v) {
  return v ? 1 : 0;
}

function seededShuffle(array, seed = 1337) {
  // Fisher–Yates with a small LCG for determinism
  let s = seed >>> 0;
  function rnd() {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 2 ** 32;
  }
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export const FEATURE_SETS = {
  v1: [
    "bias",
    "amount_log1p",
    "hour_utc_norm",
    "velocity_txn_hour_norm",
    "geo_high_risk",
    "currency_usd",
    "currency_eur",
    "currency_gbp",
    "card_visa",
    "card_mastercard",
    "card_amex",
    "card_prepaid",
  ],
  v2: [
    "bias",
    "amount_log1p",
    "hour_utc_norm",
    "velocity_txn_hour_norm",
    "geo_high_risk",
    "currency_usd",
    "currency_eur",
    "currency_gbp",
    "card_visa",
    "card_mastercard",
    "card_amex",
    "card_prepaid",
    "country_not_us_sg",
    "is_night",
    "amount_is_round",
  ],
};

function featureVectorFromInput(input, version) {
  const amount = Number(input.amount ?? 0);
  const hourUtc = Number(input.hour_utc ?? 0);
  const velocity = Number(input.velocity_txn_hour_raw ?? 0);
  const geoHighRisk = Boolean(input.geo_country_high_risk);

  const currency = String(input.currency ?? "").toUpperCase();
  const cardType = String(input.card_type ?? "").toUpperCase();
  const country = String(input.country ?? "").toUpperCase();

  const xAmountLog = Math.log1p(Math.max(0, amount));
  const xHour = clamp01(hourUtc / 23);
  const xVelocity = clamp01(velocity / 20);
  const xGeo = bool01(geoHighRisk);

  const xCurUsd = bool01(currency === "USD");
  const xCurEur = bool01(currency === "EUR");
  const xCurGbp = bool01(currency === "GBP");

  const xVisa = bool01(cardType === "VISA");
  const xMc = bool01(cardType === "MASTERCARD");
  const xAmex = bool01(cardType === "AMEX");
  const xPrepaid = bool01(cardType === "PREPAID");

  if (version === "v2") {
    const xCountryNotUsSg = bool01(country && country !== "US" && country !== "SG");
    const xIsNight = bool01(hourUtc <= 5 || hourUtc >= 23);
    const xAmountIsRound = bool01(Math.abs(amount - Math.round(amount)) < 1e-9);
    return [
      1,
      xAmountLog,
      xHour,
      xVelocity,
      xGeo,
      xCurUsd,
      xCurEur,
      xCurGbp,
      xVisa,
      xMc,
      xAmex,
      xPrepaid,
      xCountryNotUsSg,
      xIsNight,
      xAmountIsRound,
    ];
  }

  // v1 bias + 11 features
  return [1, xAmountLog, xHour, xVelocity, xGeo, xCurUsd, xCurEur, xCurGbp, xVisa, xMc, xAmex, xPrepaid];
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function trainLogReg(samples, labels, { lr = 0.1, epochs = 80, l2 = 0.0 } = {}) {
  const dim = samples[0]?.length ?? 0;
  let w = new Array(dim).fill(0);

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Array(dim).fill(0);
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = labels[i];
      const p = sigmoid(dot(w, x));
      const err = p - y;
      for (let j = 0; j < dim; j++) grad[j] += err * x[j];
    }
    for (let j = 0; j < dim; j++) {
      const reg = j === 0 ? 0 : l2 * w[j];
      w[j] -= (lr * (grad[j] / samples.length + reg));
    }
  }

  return w;
}

function computeAuc(labels, probs) {
  // AUC via rank statistics
  const pairs = labels.map((y, i) => ({ y, p: probs[i] }));
  pairs.sort((a, b) => a.p - b.p);
  let nPos = 0;
  let nNeg = 0;
  for (const it of pairs) {
    if (it.y === 1) nPos++;
    else nNeg++;
  }
  if (nPos === 0 || nNeg === 0) return null;

  let rank = 1;
  let sumRanksPos = 0;
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j].p === pairs[i].p) j++;
    const avgRank = (rank + (rank + (j - i) - 1)) / 2;
    for (let k = i; k < j; k++) {
      if (pairs[k].y === 1) sumRanksPos += avgRank;
    }
    rank += j - i;
    i = j;
  }
  const u = sumRanksPos - (nPos * (nPos + 1)) / 2;
  return u / (nPos * nNeg);
}

function computeMetrics(labels, probs, threshold = 0.5) {
  let correct = 0;
  let ll = 0;
  let brier = 0;
  const eps = 1e-15;
  for (let i = 0; i < labels.length; i++) {
    const y = labels[i];
    const p = clamp01(probs[i]);
    const pred = p >= threshold ? 1 : 0;
    if (pred === y) correct++;
    ll += -(y * Math.log(p + eps) + (1 - y) * Math.log(1 - p + eps));
    brier += (p - y) * (p - y);
  }
  return {
    n: labels.length,
    accuracy: labels.length ? correct / labels.length : null,
    logloss: labels.length ? ll / labels.length : null,
    brier: labels.length ? brier / labels.length : null,
    auc: computeAuc(labels, probs),
  };
}

export class FraudModel {
  constructor({ version, weights, featureNames, metrics }) {
    this.version = version;
    this.weights = weights;
    this.featureNames = featureNames;
    this.metrics = metrics;
  }

  predictProbability(input) {
    const x = featureVectorFromInput(input, this.version);
    return clamp01(sigmoid(dot(this.weights, x)));
  }

  explain(input) {
    const x = featureVectorFromInput(input, this.version);
    const contributions = this.featureNames.map((name, i) => ({
      feature: name,
      value: x[i],
      weight: this.weights[i],
      contribution: x[i] * this.weights[i],
    }));
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const logit = dot(this.weights, x);
    return {
      logit,
      top: contributions.slice(0, 6),
    };
  }
}

export function artifactPathForVersion(version, artifactDir = "models") {
  const safe = String(version || "v1").trim();
  return path.join(process.cwd(), artifactDir, `model-${safe}.json`);
}

export async function loadModelArtifact({ version, artifactDir = "models" } = {}) {
  const p = artifactPathForVersion(version, artifactDir);
  const raw = await fs.readFile(p, "utf-8");
  const obj = JSON.parse(raw);
  if (!obj || typeof obj !== "object") throw new Error("invalid model artifact");
  if (!Array.isArray(obj.weights)) throw new Error("invalid model artifact: weights");
  const featureNames = obj.feature_names ?? obj.featureNames ?? FEATURE_SETS[version] ?? FEATURE_SETS.v1;
  const metrics = obj.metrics ?? null;
  return new FraudModel({
    version: obj.model_version ?? obj.version ?? version,
    weights: obj.weights,
    featureNames,
    metrics,
  });
}

export async function saveModelArtifact(
  model,
  { artifactDir = "models", extra = {} } = {},
) {
  const dir = path.join(process.cwd(), artifactDir);
  await fs.mkdir(dir, { recursive: true });
  const payload = {
    model_version: model.version,
    created_at: new Date().toISOString(),
    feature_names: model.featureNames,
    weights: model.weights,
    metrics: model.metrics,
    ...extra,
  };
  const p = artifactPathForVersion(model.version, artifactDir);
  await fs.writeFile(p, JSON.stringify(payload, null, 2), "utf-8");
  return p;
}

export async function loadOrTrainModel({
  dataPath,
  version = "v1",
  maxRows = 25000,
  artifactDir = "models",
  preferArtifact = true,
} = {}) {
  const csvPath = dataPath ?? path.join(process.cwd(), "data", "synthetic_training_full.csv");

  if (preferArtifact) {
    const p = artifactPathForVersion(version, artifactDir);
    if (fsSync.existsSync(p)) {
      const loaded = await loadModelArtifact({ version, artifactDir });
      return loaded;
    }
  }

  const file = await fs.readFile(csvPath, "utf-8");
  const records = parse(file, { columns: true, skip_empty_lines: true });

  const idx = seededShuffle([...Array(Math.min(records.length, maxRows)).keys()], 20260317);
  const cutoff = Math.floor(idx.length * 0.8);
  const trainIdx = idx.slice(0, cutoff);
  const testIdx = idx.slice(cutoff);

  const trainX = [];
  const trainY = [];
  const testX = [];
  const testY = [];

  function rowToInput(r) {
    return {
      amount: r.amount,
      currency: r.currency,
      card_type: r.card_type,
      country: r.country,
      hour_utc: r.hour_utc,
      velocity_txn_hour_raw: r.velocity_txn_hour_raw,
      geo_country_high_risk: r.geo_country_high_risk === "1" || r.geo_country_high_risk === "true",
    };
  }

  for (const i of trainIdx) {
    const r = records[i];
    const y = Number(r.label_is_fraud ?? 0) ? 1 : 0;
    trainX.push(featureVectorFromInput(rowToInput(r), version));
    trainY.push(y);
  }
  for (const i of testIdx) {
    const r = records[i];
    const y = Number(r.label_is_fraud ?? 0) ? 1 : 0;
    testX.push(featureVectorFromInput(rowToInput(r), version));
    testY.push(y);
  }

  if (trainX.length < 100 || testX.length < 50) {
    throw new Error(`not enough training rows: train=${trainX.length} test=${testX.length}`);
  }

  const featureNames = FEATURE_SETS[version] ?? FEATURE_SETS.v1;
  const weights = trainLogReg(trainX, trainY, { lr: 0.25, epochs: 70, l2: version === "v2" ? 0.001 : 0.0 });

  const probs = testX.map((x) => clamp01(sigmoid(dot(weights, x))));
  const metrics = computeMetrics(testY, probs, 0.5);

  return new FraudModel({ version, weights, featureNames, metrics });
}

export function fallbackProbability(input) {
  const amount = Number(input.amount ?? 0);
  const hourUtc = Number(input.hour_utc ?? 0);
  const velocity = Number(input.velocity_txn_hour_raw ?? 0);
  const geoHighRisk = Boolean(input.geo_country_high_risk);
  const cardType = String(input.card_type ?? "").toUpperCase();

  let p = 0.02;
  if (amount >= 1000) p += 0.25;
  if (amount >= 5000) p += 0.25;
  if (hourUtc <= 5 || hourUtc >= 23) p += 0.08;
  if (velocity >= 5) p += 0.1;
  if (geoHighRisk) p += 0.15;
  if (cardType === "PREPAID") p += 0.12;

  return clamp01(p);
}

export function listSupportedVersions() {
  return Object.keys(FEATURE_SETS);
}

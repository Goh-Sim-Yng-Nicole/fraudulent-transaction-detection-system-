import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

import { config } from "./config.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(moduleDir, "..");

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function seededShuffle(array, seed = 20260317) {
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

function roundObj(obj, digits = 6) {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      typeof value === "number" ? Number(value.toFixed(digits)) : value,
    ]),
  );
}

function aucRoc(yTrue, yScore) {
  const pairs = yTrue.map((y, i) => ({ y, s: yScore[i] }));
  pairs.sort((a, b) => a.s - b.s);

  let rankSumPos = 0;
  let nPos = 0;
  let nNeg = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].y === 1) {
      rankSumPos += i + 1;
      nPos += 1;
    } else {
      nNeg += 1;
    }
  }
  if (nPos === 0 || nNeg === 0) return 0.5;
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

function classificationMetrics(yTrue, probs, threshold) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const pred = probs[i] >= threshold ? 1 : 0;
    const y = yTrue[i];
    if (pred === 1 && y === 1) tp++;
    else if (pred === 0 && y === 0) tn++;
    else if (pred === 1 && y === 0) fp++;
    else if (pred === 0 && y === 1) fn++;
  }

  const accuracy = (tp + tn) / Math.max(1, yTrue.length);
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-12, precision + recall);
  return { tp, tn, fp, fn, accuracy, precision, recall, f1 };
}

function bestThreshold(yTrue, probs) {
  let best = { threshold: 0.5, f1: -1 };
  for (let t = 0.05; t <= 0.95; t += 0.01) {
    const threshold = Number(t.toFixed(2));
    const metrics = classificationMetrics(yTrue, probs, threshold);
    if (metrics.f1 > best.f1) {
      best = { threshold, f1: metrics.f1, metrics };
    }
  }
  return best;
}

function standardize(X) {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  const mean = Array(p).fill(0);
  const std = Array(p).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) mean[j] += X[i][j];
  }
  for (let j = 0; j < p; j++) mean[j] /= Math.max(1, n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      const delta = X[i][j] - mean[j];
      std[j] += delta * delta;
    }
  }
  for (let j = 0; j < p; j++) {
    std[j] = Math.sqrt(std[j] / Math.max(1, n - 1));
    if (std[j] < 1e-9) std[j] = 1;
  }

  const Z = X.map((row) => row.map((value, idx) => (value - mean[idx]) / std[idx]));
  return { Z, mean, std };
}

function applyStandardize(X, mean, std) {
  return X.map((row) => row.map((value, idx) => (value - mean[idx]) / std[idx]));
}

function trainLogReg(X, y, opts = {}) {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  const epochs = opts.epochs ?? 300;
  const learningRate = opts.learningRate ?? 0.05;
  const l2 = opts.l2 ?? 0.0008;

  const weights = Array(p).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradient = Array(p).fill(0);
    let biasGradient = 0;

    for (let i = 0; i < n; i++) {
      const prediction = sigmoid(dot(weights, X[i]) + bias);
      const error = prediction - y[i];
      for (let j = 0; j < p; j++) gradient[j] += error * X[i][j];
      biasGradient += error;
    }

    for (let j = 0; j < p; j++) {
      gradient[j] = gradient[j] / n + l2 * weights[j];
      weights[j] -= learningRate * gradient[j];
    }
    bias -= learningRate * (biasGradient / n);
  }

  return { weights, bias, epochs, learningRate, l2 };
}

function predictProbs(X, weights, bias) {
  return X.map((row) => sigmoid(dot(weights, row) + bias));
}

function toDataset(rows, featureNames) {
  return {
    X: rows.map((row) => featureNames.map((feature) => Number(row[feature] || 0))),
    y: rows.map((row) => Number(row.label_is_fraud || 0)),
  };
}

export class FraudModel {
  constructor(artifact) {
    this.version = artifact.modelVersion;
    this.modelType = artifact.modelType || "logistic_regression";
    this.featureNames = artifact.featureNames || [];
    this.weights = artifact.weights || {};
    this.intercept = artifact.intercept || 0;
    this.normalizer = artifact.normalizer || { mean: {}, std: {} };
    this.threshold = artifact.threshold || 0.5;
    this.metrics = artifact.metrics || null;
    this.featureVersion = artifact.featureVersion || "2.1.0";
    this.loadedAt = new Date().toISOString();
  }

  _normalize(feature, value) {
    const mean = this.normalizer.mean?.[feature] ?? 0;
    const std = this.normalizer.std?.[feature] ?? 1;
    const safeStd = Math.abs(std) < 1e-9 ? 1 : std;
    return (value - mean) / safeStd;
  }

  predict(features) {
    let logit = this.intercept;
    let matchedFeatures = 0;

    for (const featureName of this.featureNames) {
      const weight = this.weights[featureName];
      if (weight === undefined) continue;
      const raw = Number(features[featureName] ?? 0);
      const value = Number.isFinite(raw) ? raw : 0;
      const normalized = this._normalize(featureName, value);
      logit += weight * normalized;
      if (features[featureName] !== undefined) matchedFeatures++;
    }

    const probability = sigmoid(logit);
    const score = Math.round(probability * 100);
    const confidence = Math.min(1, Math.abs(probability - 0.5) * 2);

    return {
      score,
      probability,
      confidence,
      logit,
      matchedFeatures,
    };
  }

  explain(features, prediction) {
    const contributions = [];
    for (const featureName of this.featureNames) {
      const weight = this.weights[featureName];
      if (weight === undefined) continue;

      const raw = Number(features[featureName] ?? 0);
      const value = Number.isFinite(raw) ? raw : 0;
      const normalized = this._normalize(featureName, value);
      const contribution = weight * normalized;
      if (Math.abs(contribution) < 1e-6) continue;

      contributions.push({
        feature: featureName,
        value,
        normalized,
        weight,
        contribution,
        impact: contribution > 0 ? "increases_risk" : "decreases_risk",
      });
    }

    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    return {
      topContributors: contributions.slice(0, 10),
      totalContributions: contributions.length,
      explanation: this._generateExplanation(contributions.slice(0, 5), prediction),
    };
  }

  _generateExplanation(topContributions, prediction) {
    const reasons = [];
    for (const contribution of topContributions) {
      if (contribution.contribution <= 0) continue;
      if (contribution.feature.includes("velocity")) reasons.push("High transaction velocity detected");
      else if (contribution.feature.includes("rules")) reasons.push("Rule-based risk indicators are strong");
      else if (contribution.feature.includes("amount")) reasons.push("Amount pattern increases fraud risk");
      else if (contribution.feature.includes("country") || contribution.feature.includes("geo")) {
        reasons.push("Geographic risk factors present");
      } else if (
        contribution.feature.includes("time") ||
        contribution.feature.includes("night") ||
        contribution.feature.includes("hour")
      ) {
        reasons.push("Transaction timing is unusual");
      }
    }

    if (!reasons.length) {
      reasons.push(prediction.score >= 50 ? "Moderate fraud signals detected" : "Low fraud signals detected");
    }

    return reasons;
  }
}

function artifactPathForVersion(version, artifactDir = config.model.artifactDir) {
  const rootDir = resolveServicePath(artifactDir);
  return path.join(rootDir, `model-${String(version || config.defaultModelVersion).trim()}.json`);
}

function resolveServicePath(relativeOrAbsolutePath) {
  if (path.isAbsolute(relativeOrAbsolutePath)) return relativeOrAbsolutePath;

  const cwdPath = path.resolve(process.cwd(), relativeOrAbsolutePath);
  if (fsSync.existsSync(cwdPath)) return cwdPath;

  return path.resolve(serviceRoot, relativeOrAbsolutePath);
}

export async function loadModelArtifact({ version = config.defaultModelVersion, artifactDir = config.model.artifactDir } = {}) {
  const artifactPath = artifactPathForVersion(version, artifactDir);
  const raw = await fs.readFile(artifactPath, "utf-8");
  return new FraudModel(JSON.parse(raw));
}

export async function saveModelArtifact(model, { version = config.defaultModelVersion, artifactDir = config.model.artifactDir } = {}) {
  const artifactPath = artifactPathForVersion(version, artifactDir);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  const payload = {
    modelVersion: model.version,
    modelType: model.modelType,
    trainedAt: new Date().toISOString(),
    featureVersion: model.featureVersion,
    featureNames: model.featureNames,
    normalizer: model.normalizer,
    weights: model.weights,
    intercept: model.intercept,
    threshold: model.threshold,
    metrics: model.metrics,
  };
  await fs.writeFile(artifactPath, JSON.stringify(payload, null, 2), "utf-8");
  return artifactPath;
}

export async function loadOrTrainModel({
  version = config.defaultModelVersion,
  artifactDir = config.model.artifactDir,
  dataPath = config.model.datasetPath,
  preferArtifact = true,
} = {}) {
  const artifactPath = artifactPathForVersion(version, artifactDir);
  if (preferArtifact && fsSync.existsSync(artifactPath)) {
    return loadModelArtifact({ version, artifactDir });
  }

  const csvPath = resolveServicePath(dataPath);
  const raw = await fs.readFile(csvPath, "utf-8");
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  if (!records.length) throw new Error("training dataset is empty");

  const featureNames = Object.keys(records[0])
    .filter((key) => key.startsWith("f_"))
    .sort()
    .map((key) => key.replace(/^f_/, ""));
  if (!featureNames.length) throw new Error("no engineered feature columns found");

  const shuffled = seededShuffle([...records]);
  const trainEnd = Math.floor(shuffled.length * 0.8);
  const valEnd = Math.floor(shuffled.length * 0.9);
  const trainRows = shuffled.slice(0, trainEnd);
  const valRows = shuffled.slice(trainEnd, valEnd);
  const testRows = shuffled.slice(valEnd);

  const trainDataset = toDataset(trainRows, featureNames.map((name) => `f_${name}`));
  const valDataset = toDataset(valRows, featureNames.map((name) => `f_${name}`));
  const testDataset = toDataset(testRows, featureNames.map((name) => `f_${name}`));

  const { Z: XTrain, mean, std } = standardize(trainDataset.X);
  const XVal = applyStandardize(valDataset.X, mean, std);
  const XTest = applyStandardize(testDataset.X, mean, std);

  const fitted = trainLogReg(XTrain, trainDataset.y);
  const trainProb = predictProbs(XTrain, fitted.weights, fitted.bias);
  const valProb = predictProbs(XVal, fitted.weights, fitted.bias);
  const testProb = predictProbs(XTest, fitted.weights, fitted.bias);

  const best = bestThreshold(valDataset.y, valProb);
  const weightsByFeature = Object.fromEntries(
    featureNames.map((name, idx) => [name, Number(fitted.weights[idx].toFixed(6))]),
  );
  const normalizer = {
    mean: roundObj(Object.fromEntries(featureNames.map((name, idx) => [name, mean[idx]]))),
    std: roundObj(Object.fromEntries(featureNames.map((name, idx) => [name, std[idx]]))),
  };

  const model = new FraudModel({
    modelVersion: version,
    modelType: "logistic_regression",
    featureVersion: "2.1.0",
    featureNames,
    normalizer,
    weights: weightsByFeature,
    intercept: Number(fitted.bias.toFixed(6)),
    threshold: best.threshold,
    metrics: {
      train: {
        ...roundObj(classificationMetrics(trainDataset.y, trainProb, best.threshold)),
        auc: Number(aucRoc(trainDataset.y, trainProb).toFixed(6)),
      },
      val: {
        ...roundObj(classificationMetrics(valDataset.y, valProb, best.threshold)),
        auc: Number(aucRoc(valDataset.y, valProb).toFixed(6)),
      },
      test: {
        ...roundObj(classificationMetrics(testDataset.y, testProb, best.threshold)),
        auc: Number(aucRoc(testDataset.y, testProb).toFixed(6)),
      },
    },
  });
  await saveModelArtifact(model, { version, artifactDir });
  return model;
}

export function fallbackProbability(input) {
  const amountHigh = Number(input.amount_high ?? input.f_amount_high ?? 0) || 0;
  const rulesFlagged = Number(input.rules_flagged ?? input.f_rules_flagged ?? 0) || 0;
  const rulesReasonCount = Number(input.rules_reason_count ?? input.f_rules_reason_count ?? 0) || 0;

  let score = 30;
  if (rulesFlagged) score += 40;
  score += Math.min(Math.round(rulesReasonCount * 10) * 5, 20);
  if (amountHigh) score += 5;
  return Math.max(0, Math.min(1, score / 100));
}

export function listSupportedVersions() {
  return [config.defaultModelVersion];
}

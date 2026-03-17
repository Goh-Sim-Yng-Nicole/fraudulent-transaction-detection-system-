import path from "node:path";

import {
  listSupportedVersions,
  loadOrTrainModel,
  saveModelArtifact,
} from "../src/model.js";

function envInt(name, fallback) {
  const v = (process.env[name] ?? "").toString().trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const artifactDir = (process.env.MODEL_ARTIFACT_DIR ?? "models").toString().trim() || "models";
const maxRows = envInt("MAX_TRAIN_ROWS", 25000);
const versions = listSupportedVersions();

for (const version of versions) {
  const model = await loadOrTrainModel({
    version,
    maxRows,
    artifactDir,
    preferArtifact: false,
  });
  const out = await saveModelArtifact(model, {
    artifactDir,
    extra: {
      training: {
        maxRows,
        data: path.join("data", "synthetic_training_full.csv"),
      },
    },
  });
  console.log(`[train:model] wrote ${out} metrics=${JSON.stringify(model.metrics)}`);
}


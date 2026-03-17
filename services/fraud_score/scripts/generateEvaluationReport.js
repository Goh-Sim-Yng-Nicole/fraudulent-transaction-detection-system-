import fs from "node:fs/promises";

import { listSupportedVersions, loadModelArtifact } from "../src/model.js";

const artifactDir = (process.env.MODEL_ARTIFACT_DIR ?? "models").toString().trim() || "models";
const versions = listSupportedVersions();

const report = {
  generated_at: new Date().toISOString(),
  artifact_dir: artifactDir,
  models: [],
};

for (const version of versions) {
  try {
    const model = await loadModelArtifact({ version, artifactDir });
    report.models.push({
      model_version: model.version,
      feature_names: model.featureNames,
      metrics: model.metrics,
    });
  } catch (err) {
    report.models.push({
      model_version: version,
      error: String(err?.message ?? err),
    });
  }
}

await fs.mkdir("reports", { recursive: true });
const outPath = `reports/evaluation-report.json`;
await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");
console.log(`[evaluate:model] wrote ${outPath}`);


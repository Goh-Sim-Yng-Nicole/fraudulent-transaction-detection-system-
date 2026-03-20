import { healthChecks, logStep, waitForUrl } from './helpers.mjs';

const startedAt = Date.now();

for (const check of healthChecks) {
  await waitForUrl(check.name, check.url);
  logStep(`Smoke check passed: ${check.name}`);
}

logStep(`Smoke health completed in ${Date.now() - startedAt}ms across ${healthChecks.length} surfaces`);

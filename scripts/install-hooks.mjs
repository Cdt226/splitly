// Installs a lightweight git pre-commit hook that runs the i18n audit.
// Runs automatically via `npm install` (prepare script).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GIT_HOOKS_DIR = path.join(ROOT, ".git", "hooks");
const HOOK_PATH = path.join(GIT_HOOKS_DIR, "pre-commit");

const HOOK_CONTENT = `#!/bin/sh
# SplitLy i18n pre-commit check
# Runs npm run i18n:ci and blocks the commit if critical i18n issues are found.

echo "🌍 Running i18n audit..."
node scripts/i18n-check.js --ci
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo ""
  echo "❌ Commit blocked: i18n issues detected."
  echo "   Run: npm run i18n:fix   (auto-translate via Claude)"
  echo "   Or:  npm run i18n       (audit only)"
  exit 1
fi

echo "✅ i18n OK"
exit 0
`;

if (!fs.existsSync(GIT_HOOKS_DIR)) {
  console.log("No .git/hooks directory found — skipping hook installation.");
  process.exit(0);
}

fs.writeFileSync(HOOK_PATH, HOOK_CONTENT, { mode: 0o755, encoding: "utf-8" });
console.log("✅ pre-commit hook installed at .git/hooks/pre-commit");

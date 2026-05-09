#!/usr/bin/env node
/**
 * SplitLy — Script d'audit i18n + traduction automatique
 * Usage : node scripts/i18n-check.js [--fix] [--ci]
 *
 * Sans --fix : affiche les strings non traduites détectées
 * Avec --fix  : traduit automatiquement via Claude API et met à jour les fichiers JSON
 * Avec --ci   : exit 1 si des problèmes sont détectés (pour CI/pre-commit)
 *
 * Nécessite : ANTHROPIC_API_KEY dans l'environnement (pour --fix)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "locales");
const PAGES_DIR = path.join(ROOT, "src");
const LANGS = ["fr", "en", "es", "pt", "ar"];
const REFERENCE_LANG = "fr";
const FIX_MODE = process.argv.includes("--fix");
const CI_MODE  = process.argv.includes("--ci");

// ─── Couleurs terminal ──────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m", gray: "\x1b[90m",
};
const log = {
  info:  (m) => console.log(`${C.blue}ℹ${C.reset}  ${m}`),
  ok:    (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
  warn:  (m) => console.log(`${C.yellow}⚠${C.reset}  ${m}`),
  error: (m) => console.log(`${C.red}✗${C.reset}  ${m}`),
  title: (m) => console.log(`\n${C.bold}${C.cyan}${m}${C.reset}`),
  sub:   (m) => console.log(`  ${C.gray}${m}${C.reset}`),
};

// ─── Charger les fichiers de traduction ─────────────────────────
function loadLocales() {
  const locales = {};
  for (const lang of LANGS) {
    const filePath = path.join(LOCALES_DIR, `${lang}.json`);
    if (!fs.existsSync(filePath)) { log.warn(`Fichier manquant: ${lang}.json`); locales[lang] = {}; continue; }
    locales[lang] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }
  return locales;
}

// ─── Scanner les fichiers source ────────────────────────────────
function scanSourceFiles(dir, extensions = [".jsx", ".js", ".tsx"]) {
  const files = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory() && !["node_modules", ".git", "dist", "api", "scripts"].includes(entry.name)) {
        walk(path.join(d, entry.name));
      } else if (entry.isFile() && extensions.some(e => entry.name.endsWith(e))) {
        files.push(path.join(d, entry.name));
      }
    }
  }
  walk(dir);
  return files;
}

function extractTKeys(content) {
  const keys = new Set();
  // t("key"), t('key'), t(`key`), t("key", {...})
  const regex = /\bt\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  let match;
  while ((match = regex.exec(content)) !== null) keys.add(match[1]);
  return keys;
}

// ─── Détecter les strings françaises non traduites ───────────────
const FRENCH_WORDS = [
  "Ajouter", "Annuler", "Supprimer", "Modifier", "Fermer", "Enregistrer",
  "Créer", "Chargement", "Confirmer", "Retour", "Connexion", "Bonjour",
  "Événement", "Participants", "Dépenses", "Remboursement", "Solde",
  "Bienvenue", "Erreur", "Succès", "Attention", "Aucun", "Aucune",
  "Toutes", "Tous", "Voir", "Charger", "Exporter", "Télécharger",
];
const FRENCH_RE = new RegExp(`(${FRENCH_WORDS.join("|")})`, "i");

function extractHardcodedStrings(content, filePath) {
  const hardcoded = [];
  const relPath = path.relative(ROOT, filePath);

  // Skip locale JSON files and the i18n config itself
  if (relPath.includes("locales") || relPath.includes("i18n.jsx")) return hardcoded;

  const patterns = [
    // addToast("french string")
    /addToast\(\s*["'`]([^"'`{}\n]{8,})["'`]/g,
    // JSX text content between tags (long enough to be a real label)
    />([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][^<>{}\n]{12,})</g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const str = match[1].trim();
      if (
        str.length > 8 &&
        FRENCH_RE.test(str) &&
        !str.includes("{") &&
        !str.startsWith("http") &&
        !str.startsWith("//") &&
        !/^[a-z_\s]+$/.test(str) &&
        !str.includes("=>")
      ) {
        hardcoded.push({ string: str.slice(0, 80), file: relPath });
      }
    }
  }
  return hardcoded;
}

// ─── Vérifier que useTranslation est importé dans les pages JSX ──
function auditMissingImports(files) {
  const missing = [];
  const EXCLUDED = ["ErrorBoundary", "supabase", "constants", "styles", "utils", "main", "storage", "useTheme", "useGuestSession", "exportExcel"];
  for (const file of files) {
    if (!file.endsWith(".jsx")) continue;
    const rel = path.relative(ROOT, file);
    if (EXCLUDED.some(e => rel.includes(e))) continue;
    const content = fs.readFileSync(file, "utf-8");
    // Only flag if the file uses t() but doesn't import useTranslation
    if (/\bt\(["'`]/.test(content) && !content.includes("useTranslation")) {
      missing.push(rel);
    }
  }
  return missing;
}

// ─── Audit : clés manquantes entre langues ───────────────────────
function auditMissingKeys(locales) {
  const refKeys = new Set(Object.keys(locales[REFERENCE_LANG]));
  const report = {};
  for (const lang of LANGS) {
    if (lang === REFERENCE_LANG) continue;
    const missing = [...refKeys].filter(k => !(k in locales[lang]));
    if (missing.length) report[lang] = missing;
  }
  return report;
}

// ─── Audit : clés inutilisées ────────────────────────────────────
function auditUnusedKeys(locales, usedKeys) {
  return Object.keys(locales[REFERENCE_LANG]).filter(k => !usedKeys.has(k));
}

// ─── Audit : clés dans le code mais absentes du JSON ─────────────
function auditMissingFromCode(locales, usedKeys) {
  const refKeys = new Set(Object.keys(locales[REFERENCE_LANG]));
  return [...usedKeys].filter(k => !refKeys.has(k));
}

// ─── Traduction automatique via Claude API ───────────────────────
async function translateKeys(keysToTranslate, locales) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.error("ANTHROPIC_API_KEY non définie.");
    log.sub("export ANTHROPIC_API_KEY=sk-ant-...");
    process.exit(1);
  }

  const frValues = {};
  for (const key of keysToTranslate) frValues[key] = locales[REFERENCE_LANG][key] || key;

  log.info(`Traduction de ${keysToTranslate.length} clé(s) via Claude...`);

  const prompt = `Tu es un traducteur expert pour une application de gestion de dépenses partagées appelée SplitLy.

Voici des clés de traduction en français à traduire vers EN, ES, PT et AR.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni backticks.
Format attendu:
{
  "cle1": { "en": "...", "es": "...", "pt": "...", "ar": "..." },
  "cle2": { "en": "...", "es": "...", "pt": "...", "ar": "..." }
}

Clés à traduire (format clé: valeur_française):
${JSON.stringify(frValues, null, 2)}

Règles:
- Garde le ton de l'app: simple, moderne, friendly
- Pour l'arabe: utilise l'arabe standard moderne (MSA), texte RTL naturel
- Respecte les emojis, symboles (✓, ✕, →, ↩) et variables comme {name}, {query}
- Ne traduis PAS: SplitLy, Admin, PDF, CSV, email, dashboard`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
  });

  if (!response.ok) { log.error(`Erreur API: ${response.status}`); process.exit(1); }

  const data = await response.json();
  const raw = data.content[0].text.trim();
  try {
    const clean = raw.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    log.error(`Parse error: ${e.message}\nRéponse: ${raw.slice(0, 200)}`);
    process.exit(1);
  }
}

function applyTranslations(locales, translations) {
  for (const [key, langValues] of Object.entries(translations)) {
    for (const [lang, value] of Object.entries(langValues)) {
      if (LANGS.includes(lang) && lang !== REFERENCE_LANG) locales[lang][key] = value;
    }
  }
}

function saveLocales(locales) {
  for (const lang of LANGS) {
    const filePath = path.join(LOCALES_DIR, `${lang}.json`);
    const sorted = Object.fromEntries(Object.entries(locales[lang]).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
    log.ok(`${lang}.json sauvegardé (${Object.keys(sorted).length} clés)`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────
async function main() {
  log.title("═══ SplitLy i18n Audit ═══");
  console.log(`Mode: ${FIX_MODE ? `${C.green}--fix${C.reset}` : `${C.yellow}audit${C.reset}`}${CI_MODE ? ` ${C.cyan}--ci${C.reset}` : ""}\n`);

  const locales = loadLocales();
  const refCount = Object.keys(locales[REFERENCE_LANG]).length;
  log.info(`Référence (${REFERENCE_LANG}): ${refCount} clés`);

  log.title("1. Scan du code source");
  const sourceFiles = scanSourceFiles(PAGES_DIR);
  log.info(`${sourceFiles.length} fichiers scannés`);

  const usedKeys = new Set();
  const allHardcoded = [];

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, "utf-8");
    for (const key of extractTKeys(content)) usedKeys.add(key);
    allHardcoded.push(...extractHardcodedStrings(content, file));
  }
  log.info(`${usedKeys.size} clés t() utilisées dans le code`);

  // Audit: imports manquants
  log.title("2. Fichiers JSX sans useTranslation mais utilisant t()");
  const missingImports = auditMissingImports(sourceFiles);
  if (missingImports.length === 0) {
    log.ok("Tous les fichiers qui utilisent t() importent useTranslation");
  } else {
    missingImports.forEach(f => log.warn(f));
  }

  // Audit: clés manquantes entre langues
  log.title("3. Clés manquantes entre langues");
  const missingByLang = auditMissingKeys(locales);
  const allMissingKeys = new Set();
  if (Object.keys(missingByLang).length === 0) {
    log.ok("Toutes les langues sont synchronisées !");
  } else {
    for (const [lang, keys] of Object.entries(missingByLang)) {
      log.warn(`${lang.toUpperCase()} manque ${keys.length} clé(s):`);
      keys.forEach(k => { log.sub(k); allMissingKeys.add(k); });
    }
  }

  // Audit: clés dans le code mais absentes du JSON
  log.title("4. Clés t() absentes des fichiers JSON");
  const missingFromJson = auditMissingFromCode(locales, usedKeys);
  if (missingFromJson.length === 0) {
    log.ok("Toutes les clés t() sont définies dans les JSON");
  } else {
    log.warn(`${missingFromJson.length} clé(s) manquante(s):`);
    missingFromJson.forEach(k => log.sub(`${C.red}${k}${C.reset}`));
  }

  // Audit: strings hardcodées
  log.title("5. Strings hardcodées (non traduites)");
  if (allHardcoded.length === 0) {
    log.ok("Aucune string hardcodée détectée");
  } else {
    const byFile = {};
    allHardcoded.forEach(({ string, file }) => { if (!byFile[file]) byFile[file] = []; byFile[file].push(string); });
    for (const [file, strings] of Object.entries(byFile)) {
      log.warn(`${path.basename(file)}:`);
      strings.slice(0, 5).forEach(s => log.sub(`"${s}"`));
      if (strings.length > 5) log.sub(`... et ${strings.length - 5} autre(s)`);
    }
  }

  // Audit: clés inutilisées
  log.title("6. Clés JSON jamais utilisées");
  const unusedKeys = auditUnusedKeys(locales, usedKeys);
  if (unusedKeys.length === 0) {
    log.ok("Aucune clé inutilisée");
  } else {
    log.warn(`${unusedKeys.length} clé(s) inutilisée(s):`);
    unusedKeys.slice(0, 10).forEach(k => log.sub(k));
    if (unusedKeys.length > 10) log.sub(`... et ${unusedKeys.length - 10} autre(s)`);
  }

  // Résumé
  log.title("═══ Résumé ═══");
  const issues = Object.values(missingByLang).reduce((s, a) => s + a.length, 0) + missingFromJson.length + missingImports.length;
  if (issues === 0) {
    log.ok("Tout est en ordre — i18n complet !");
  } else {
    log.warn(`${issues} problème(s) détecté(s)`);
    if (!FIX_MODE) {
      console.log(`\n${C.bold}Conseil:${C.reset} Lancez ${C.cyan}npm run i18n:fix${C.reset} pour traduire automatiquement.`);
    }
  }

  // Mode --fix
  if (FIX_MODE) {
    const keysToTranslate = [...allMissingKeys];
    if (keysToTranslate.length === 0) {
      log.ok("Rien à traduire !");
    } else {
      log.title("7. Traduction automatique");
      const BATCH_SIZE = 30;
      for (let i = 0; i < keysToTranslate.length; i += BATCH_SIZE) {
        const batch = keysToTranslate.slice(i, i + BATCH_SIZE);
        log.info(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(keysToTranslate.length / BATCH_SIZE)}`);
        const translations = await translateKeys(batch, locales);
        applyTranslations(locales, translations);
      }
      saveLocales(locales);
      log.ok("Fichiers mis à jour !");
    }
  }

  // Mode --ci : exit 1 si problèmes critiques
  if (CI_MODE && issues > 0) {
    console.log(`\n${C.red}${C.bold}CI FAILED: ${issues} i18n issue(s) detected.${C.reset}`);
    console.log(`Run ${C.cyan}npm run i18n:fix${C.reset} to auto-translate missing keys.\n`);
    process.exit(1);
  }
}

main().catch(err => {
  log.error(`Erreur fatale: ${err.message}`);
  process.exit(1);
});

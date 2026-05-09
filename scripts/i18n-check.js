#!/usr/bin/env node
/**
 * SplitLy — Script d'audit i18n + traduction automatique
 * Usage : node scripts/i18n-check.js [--fix]
 *
 * Sans --fix : affiche les strings non traduites détectées
 * Avec --fix  : traduit automatiquement via Claude API et met à jour les fichiers JSON
 *
 * Nécessite : ANTHROPIC_API_KEY dans l'environnement
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

// ─── Scanner les fichiers source pour extraire les clés t() ─────
function scanSourceFiles(dir, extensions = [".jsx", ".js", ".tsx"]) {
  const files = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory() && !["node_modules", ".git", "dist", "api"].includes(entry.name)) {
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
  // Patterns: t("key"), t('key'), t(`key`)
  const regex = /\bt\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

function extractHardcodedStrings(content, filePath) {
  const hardcoded = [];
  const relPath = path.relative(ROOT, filePath);

  // Détecter les strings français dans JSX (entre > et <, ou dans addToast)
  // On cherche des strings littérales en français qui ne sont pas déjà dans t()
  const patterns = [
    // addToast("string en dur", ...)
    /addToast\(\s*["'`]([^"'`]+)["'`]/g,
    // JSX text content >texte<
    />([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][^<>{}\n]{10,})</g,
  ];

  for (const pattern of patterns) {
    let match;
    const content2 = content;
    while ((match = pattern.exec(content2)) !== null) {
      const str = match[1].trim();
      // Filtrer: pas de code, pas de clés déjà, pas de URLs
      if (str.length > 5 && !str.includes("{") && !str.startsWith("http") &&
          !/^[a-z_]+$/.test(str) && !str.includes("=>") && !str.includes("//")) {
        hardcoded.push({ string: str, file: relPath });
      }
    }
  }
  return hardcoded;
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

// ─── Audit : clés dans JSON mais jamais utilisées dans le code ──
function auditUnusedKeys(locales, usedKeys) {
  const refKeys = Object.keys(locales[REFERENCE_LANG]);
  return refKeys.filter(k => !usedKeys.has(k));
}

// ─── Audit : clés utilisées dans le code mais absentes du JSON ──
function auditMissingFromCode(locales, usedKeys) {
  const refKeys = new Set(Object.keys(locales[REFERENCE_LANG]));
  return [...usedKeys].filter(k => !refKeys.has(k));
}

// ─── Traduction automatique via Claude API ───────────────────────
async function translateKeys(keysToTranslate, locales) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.error("ANTHROPIC_API_KEY non définie. Impossible de traduire automatiquement.");
    log.sub("Ajoutez-la: export ANTHROPIC_API_KEY=sk-...");
    process.exit(1);
  }

  const frValues = {};
  for (const key of keysToTranslate) {
    frValues[key] = locales[REFERENCE_LANG][key] || key;
  }

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
- Respecte les emojis, symboles (✓, ✕, →, ↩) et balises comme {name}
- Ne traduis PAS les mots: SplitLy, Admin, PDF, CSV, email, dashboard`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    log.error(`Erreur API Claude: ${response.status} — ${err}`);
    process.exit(1);
  }

  const data = await response.json();
  const raw = data.content[0].text.trim();

  // Parser la réponse JSON
  let translations;
  try {
    // Nettoyer les éventuels backticks markdown
    const clean = raw.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim();
    translations = JSON.parse(clean);
  } catch (e) {
    log.error(`Impossible de parser la réponse: ${e.message}`);
    log.sub(`Réponse brute: ${raw.slice(0, 200)}...`);
    process.exit(1);
  }

  return translations;
}

// ─── Appliquer les traductions aux fichiers JSON ─────────────────
function applyTranslations(locales, translations) {
  for (const [key, langValues] of Object.entries(translations)) {
    for (const [lang, value] of Object.entries(langValues)) {
      if (LANGS.includes(lang) && lang !== REFERENCE_LANG) {
        locales[lang][key] = value;
      }
    }
  }
}

function saveLocales(locales) {
  for (const lang of LANGS) {
    const filePath = path.join(LOCALES_DIR, `${lang}.json`);
    // Trier les clés pour un diff Git propre
    const sorted = Object.fromEntries(Object.entries(locales[lang]).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
    log.ok(`${lang}.json sauvegardé (${Object.keys(sorted).length} clés)`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────
async function main() {
  log.title("═══ SplitLy i18n Audit ═══");
  console.log(`Mode: ${FIX_MODE ? `${C.green}--fix (traduction automatique)${C.reset}` : `${C.yellow}audit seul${C.reset}`}\n`);

  // 1. Charger les traductions
  const locales = loadLocales();
  const refCount = Object.keys(locales[REFERENCE_LANG]).length;
  log.info(`Référence (${REFERENCE_LANG}): ${refCount} clés chargées`);

  // 2. Scanner le code source
  log.title("1. Scan du code source");
  const sourceFiles = scanSourceFiles(PAGES_DIR);
  log.info(`${sourceFiles.length} fichiers scannés`);

  const usedKeys = new Set();
  const allHardcoded = [];

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, "utf-8");
    for (const key of extractTKeys(content)) usedKeys.add(key);
    const hardcoded = extractHardcodedStrings(content, file);
    allHardcoded.push(...hardcoded);
  }

  log.info(`${usedKeys.size} clés t() utilisées dans le code`);

  // 3. Audit clés manquantes entre langues
  log.title("2. Clés manquantes entre langues");
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

  // 4. Audit clés utilisées mais absentes du JSON
  log.title("3. Clés dans le code mais absentes des JSON");
  const missingFromJson = auditMissingFromCode(locales, usedKeys);
  if (missingFromJson.length === 0) {
    log.ok("Toutes les clés t() sont définies dans les JSON");
  } else {
    log.warn(`${missingFromJson.length} clé(s) utilisée(s) dans le code mais absente(s) du JSON:`);
    missingFromJson.forEach(k => log.sub(`${C.red}${k}${C.reset}`));
  }

  // 5. Audit strings hardcodées
  log.title("4. Strings hardcodées détectées (non traduites)");
  if (allHardcoded.length === 0) {
    log.ok("Aucune string hardcodée détectée");
  } else {
    const byFile = {};
    allHardcoded.forEach(({ string, file }) => {
      if (!byFile[file]) byFile[file] = [];
      byFile[file].push(string);
    });
    for (const [file, strings] of Object.entries(byFile)) {
      log.warn(`${path.basename(file)}:`);
      strings.slice(0, 5).forEach(s => log.sub(`"${s.slice(0, 60)}${s.length > 60 ? "..." : ""}"`));
      if (strings.length > 5) log.sub(`... et ${strings.length - 5} autre(s)`);
    }
    log.sub(`\nPour corriger: remplacez par t("ma_cle") et ajoutez la clé dans fr.json`);
  }

  // 6. Audit clés inutilisées
  log.title("5. Clés JSON jamais utilisées dans le code");
  const unusedKeys = auditUnusedKeys(locales, usedKeys);
  if (unusedKeys.length === 0) {
    log.ok("Aucune clé inutilisée");
  } else {
    log.warn(`${unusedKeys.length} clé(s) définies mais jamais appelées via t():`);
    unusedKeys.slice(0, 10).forEach(k => log.sub(k));
    if (unusedKeys.length > 10) log.sub(`... et ${unusedKeys.length - 10} autre(s)`);
  }

  // 7. Résumé
  log.title("═══ Résumé ═══");
  const issues = Object.values(missingByLang).reduce((s, a) => s + a.length, 0) + missingFromJson.length;
  if (issues === 0) {
    log.ok("Tout est en ordre — i18n complet !");
  } else {
    log.warn(`${issues} problème(s) détecté(s)`);
  }

  // 8. Mode --fix : traduire automatiquement
  if (FIX_MODE) {
    const keysToTranslate = [...new Set([...allMissingKeys])];
    if (keysToTranslate.length === 0) {
      log.ok("Rien à traduire !");
    } else {
      log.title("6. Traduction automatique");

      // Traduire par batch de 30 pour éviter les timeouts
      const BATCH_SIZE = 30;
      for (let i = 0; i < keysToTranslate.length; i += BATCH_SIZE) {
        const batch = keysToTranslate.slice(i, i + BATCH_SIZE);
        log.info(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(keysToTranslate.length / BATCH_SIZE)} (${batch.length} clés)...`);
        const translations = await translateKeys(batch, locales);
        applyTranslations(locales, translations);
      }

      log.title("7. Sauvegarde");
      saveLocales(locales);
      log.ok("Fichiers mis à jour ! Relancez sans --fix pour vérifier.");
    }
  } else if (Object.keys(missingByLang).length > 0 || missingFromJson.length > 0) {
    console.log(`\n${C.bold}Conseil:${C.reset} Lancez avec ${C.cyan}--fix${C.reset} pour traduire automatiquement les clés manquantes.`);
    console.log(`${C.gray}  node scripts/i18n-check.js --fix${C.reset}\n`);
  }
}

main().catch(err => {
  log.error(`Erreur fatale: ${err.message}`);
  process.exit(1);
});

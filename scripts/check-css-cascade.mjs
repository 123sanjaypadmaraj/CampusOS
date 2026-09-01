#!/usr/bin/env node
// scripts/check-css-cascade.mjs
//
// Static scanner for the one CSS bug class that has bitten this codebase
// three times in production (docs point back to `src/index.css`'s own
// "UI REFRESH" comment near the bottom of the file):
//
//   A rule inside an `@media (max-width: Npx)` block sets `display` for
//   some selector (e.g. hiding it, or switching it to a grid layout), and
//   a LATER, unconditional (or equally-specific) rule for the exact same
//   selector also sets `display` -- since @media adds no specificity, the
//   later rule wins the cascade at every width where the media query is
//   true, silently defeating the responsive rule.
//
// Three confirmed live incidents of exactly this pattern:
//   - topbar `.location` staying visible below 900px (campusos-cross-device-pass)
//   - `.bottom-nav button` labels truncated to one letter on phone widths
//     (campusos-bottom-nav-mobile-fix)
//   - (see the "UI REFRESH" comment in src/index.css for the third)
//
// This script finds that pattern by parsing (selector, media, index) for
// every rule that touches `display`, grouped by exact selector text, and
// flagging any conditional rule whose effect is later overridden by an
// unconditional rule setting a different `display` value. It is a
// heuristic (exact-selector-string match only, no real specificity engine,
// naive comma-splitting), not a full CSS cascade resolver -- but it is
// exactly the check that would have caught all three past incidents before
// they shipped, and it needs no browser to run.
//
// Usage: node scripts/check-css-cascade.mjs [path-to-css]
// Exit code 1 if any clobber candidates are found, 0 otherwise.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.resolve(__dirname, '..', 'src', 'index.css');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
}

function parseFlatRules(css, media, rules) {
  let i = 0;
  const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;
    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) break;
    const selectorText = css.slice(i, braceIdx).trim();
    const closeIdx = css.indexOf('}', braceIdx);
    if (closeIdx === -1) break;
    const decl = css.slice(braceIdx + 1, closeIdx);
    if (selectorText) rules.push({ selectorText, decl, media, index: rules.length });
    i = closeIdx + 1;
  }
}

function parseCSS(rawCss) {
  const css = stripComments(rawCss);
  const rules = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;

    if (css.startsWith('@media', i)) {
      const braceIdx = css.indexOf('{', i);
      if (braceIdx === -1) break;
      const cond = css.slice(i, braceIdx).replace(/\s+/g, ' ').trim();
      let depth = 1;
      let j = braceIdx + 1;
      while (j < n && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const inner = css.slice(braceIdx + 1, j - 1);
      parseFlatRules(inner, cond, rules);
      i = j;
    } else if (
      css.startsWith('@keyframes', i) ||
      css.startsWith('@-webkit-keyframes', i) ||
      css.startsWith('@font-face', i) ||
      css.startsWith('@supports', i) ||
      css.startsWith('@page', i)
    ) {
      const braceIdx = css.indexOf('{', i);
      if (braceIdx === -1) break;
      let depth = 1;
      let j = braceIdx + 1;
      while (j < n && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      i = j;
    } else if (css[i] === '@') {
      // Unknown at-rule (e.g. @import, @charset) -- skip to next `;` or `{...}`.
      const semi = css.indexOf(';', i);
      const brace = css.indexOf('{', i);
      if (brace !== -1 && (semi === -1 || brace < semi)) {
        let depth = 1;
        let j = brace + 1;
        while (j < n && depth > 0) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') depth--;
          j++;
        }
        i = j;
      } else if (semi !== -1) {
        i = semi + 1;
      } else {
        break;
      }
    } else {
      const braceIdx = css.indexOf('{', i);
      if (braceIdx === -1) break;
      const selectorText = css.slice(i, braceIdx).trim();
      const closeIdx = css.indexOf('}', braceIdx);
      if (closeIdx === -1) break;
      const decl = css.slice(braceIdx + 1, closeIdx);
      if (selectorText) rules.push({ selectorText, decl, media: null, index: rules.length });
      i = closeIdx + 1;
    }
  }
  return rules;
}

function lastDisplayValue(decl) {
  const matches = [...decl.matchAll(/display\s*:\s*([^;}!]+?)(\s*!important)?\s*(?:;|$)/gi)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim().toLowerCase();
}

function isMaxWidthMedia(media) {
  return !!media && /max-width\s*:/i.test(media);
}

function findLineNumber(rawCss, needle, fromIndex = 0) {
  const idx = rawCss.indexOf(needle, fromIndex);
  if (idx === -1) return null;
  return rawCss.slice(0, idx).split('\n').length;
}

function run(cssPath) {
  const raw = fs.readFileSync(cssPath, 'utf8');
  const rules = parseCSS(raw);

  // (selector -> [{selectorText, media, display, index}])
  const bySelector = new Map();
  for (const rule of rules) {
    const display = lastDisplayValue(rule.decl);
    if (display === null) continue;
    for (const part of rule.selectorText.split(',')) {
      const sel = part.trim();
      if (!sel) continue;
      if (!bySelector.has(sel)) bySelector.set(sel, []);
      bySelector.get(sel).push({ media: rule.media, display, index: rule.index, decl: rule.decl.trim() });
    }
  }

  const findings = [];
  for (const [selector, entries] of bySelector) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.index - b.index);
    for (let a = 0; a < entries.length; a++) {
      const earlier = entries[a];
      if (!isMaxWidthMedia(earlier.media)) continue; // only care about conditional rules being clobbered
      for (let b = a + 1; b < entries.length; b++) {
        const later = entries[b];
        if (later.display === earlier.display) continue; // no behavioral difference
        // Flag when the later rule is unconditional (always wins once
        // applicable) or shares the identical media condition (equal
        // specificity, later-in-source wins within the same query too).
        if (later.media === null || later.media === earlier.media) {
          findings.push({ selector, earlier, later });
        }
      }
    }
  }

  if (findings.length === 0) {
    console.log(`check-css-cascade: clean -- no display-property clobber candidates found in ${path.relative(process.cwd(), cssPath)} (${rules.length} rules scanned).`);
    return 0;
  }

  console.error(`check-css-cascade: found ${findings.length} candidate cascade-order clobber(s) in ${path.relative(process.cwd(), cssPath)}:\n`);
  for (const f of findings) {
    const earlierLine = findLineNumber(raw, f.earlier.decl) ?? '?';
    const laterLine = findLineNumber(raw, f.later.decl) ?? '?';
    console.error(
      `  Selector "${f.selector}":\n` +
      `    - ${f.earlier.media} sets display:${f.earlier.display} (around line ${earlierLine})\n` +
      `    - a LATER rule${f.later.media ? ` (${f.later.media})` : ' (unconditional)'} sets display:${f.later.display} (around line ${laterLine})\n` +
      `    -> the later rule wins even when the media query matches; the responsive rule is dead.\n`
    );
  }
  return 1;
}

const code = run(target);
process.exit(code);

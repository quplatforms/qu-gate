#!/usr/bin/env node
/**
 * qu-gate: build an independent-review packet from a git repository.
 *
 * The agent that wrote a change tends to describe it as finished. A reviewer
 * that only reads that description can only judge the description. This script
 * binds the claim to evidence: the exact commit, the real diff, and (when you
 * supply them) the real test and CI results, so an independent reviewer such as
 * Qu Review is inspecting the change rather than the story about it.
 *
 * Zero dependencies. Node 18+. Read-only: it runs git (and optionally gh) and
 * prints or writes a markdown packet. It never pushes, merges, or edits the repo.
 *
 * Usage:
 *   node qu-gate.mjs                                  packet for HEAD vs the default branch
 *   node qu-gate.mjs --base origin/main               choose the base
 *   node qu-gate.mjs --claim "CI green, P0=0/P1=0"    the certification under review
 *   node qu-gate.mjs --claim-file claim.md
 *   node qu-gate.mjs --tests test-output.txt          attach real test output (tail is kept)
 *   node qu-gate.mjs --ci                             attach `gh pr checks` for the current branch
 *   node qu-gate.mjs --concerns "auth path, migration rollback"
 *   node qu-gate.mjs --context routes/api.js:handleToday   attach UNCHANGED code the claim
 *                                                     depends on. Repeatable. Forms:
 *                                                     path | path:12-40 | path:symbolName.
 *                                                     Read from the commit under review,
 *                                                     shown in its own section, and
 *                                                     labelled as author-selected.
 *   node qu-gate.mjs --context-budget 5000            max characters of context (default 5000)
 *   node qu-gate.mjs --budget 12000                   max characters of diff (default 12000)
 *   node qu-gate.mjs --out packet.md                  write to a file instead of stdout
 *   node qu-gate.mjs --json                           emit the Qu Review reviewBrief as JSON
 *
 * Exit codes: 0 packet built, 2 not a git repo or nothing to review.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PROTOCOL = 'qu-gate/1';
// Enough for a focused change whole, and for the high-signal files of a larger one; the
// rest is named in the packet, never dropped silently. It was 40000, and with context and
// tests on top a packet ran past 55k characters, which every panelist pays to read. Raise
// it with --budget for a change whose risk is in the files that did not fit.
const DEFAULT_BUDGET = 12000;
// Enough to carry the run's verdict, not its scrollback. A green Jest summary plus the
// lines some runners print after it (emulator shutdown, `npm ERR!`, a CI wrapper's own
// footer) measured 337 characters; this is ~3.5x that. The gate only submits runs that
// already passed, so the summary is the evidence — the stack traces above it are noise
// three panelists each pay to read past.
const TEST_TAIL_CHARS = 1200;

// Context is the one input the author chooses, so it gets its own budget and can never
// crowd out the diff, which is the input the author does not choose.
const DEFAULT_CONTEXT_BUDGET = 5000;

// Files whose diffs are noise to a reviewer. They are listed in the packet,
// never silently dropped: the reviewer is told what it did not see.
const LOW_SIGNAL = [
  /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)Cargo\.lock$/, /(^|\/)poetry\.lock$/, /(^|\/)go\.sum$/, /(^|\/)composer\.lock$/,
  /\.min\.(js|css)$/, /\.map$/, /(^|\/)dist\//, /(^|\/)build\//, /(^|\/)vendor\//,
  /\.snap$/, /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?)$/i,
];

function parseArgs(argv) {
  const opts = { budget: DEFAULT_BUDGET, json: false, ci: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === '--base') opts.base = next();
    else if (a === '--claim') opts.claim = next();
    else if (a === '--claim-file') opts.claim = readFileSync(next(), 'utf8').trim();
    else if (a === '--tests') opts.tests = next();
    else if (a === '--concerns') opts.concerns = next();
    else if (a === '--budget') opts.budget = Math.max(2000, parseInt(next(), 10) || DEFAULT_BUDGET);
    else if (a === '--context') (opts.context ||= []).push(next());
    else if (a === '--context-budget') opts.contextBudget = Math.max(200, parseInt(next(), 10) || DEFAULT_CONTEXT_BUDGET);
    else if (a === '--out') opts.out = next();
    else if (a === '--ci') opts.ci = true;
    else if (a === '--json') opts.json = true;
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else fail(`Unknown option ${a}. Try --help.`);
  }
  return opts;
}

function printHelp() {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('/**'), src.indexOf('*/'));
  console.log(block.split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
}

function fail(msg, code = 2) {
  console.error(`qu-gate: ${msg}`);
  process.exit(code);
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trimEnd();
  } catch (err) {
    if (allowFail) return null;
    fail(`git ${args.join(' ')} failed: ${(err.stderr || err.message || '').toString().trim()}`);
  }
}

function resolveBase(explicit) {
  if (explicit) {
    if (git(['rev-parse', '--verify', '--quiet', `${explicit}^{commit}`], { allowFail: true }) === null) {
      fail(`base "${explicit}" is not a commit in this repository`);
    }
    return explicit;
  }
  const originHead = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { allowFail: true });
  const candidates = [originHead, 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
  for (const c of candidates) {
    if (git(['rev-parse', '--verify', '--quiet', `${c}^{commit}`], { allowFail: true }) !== null) return c;
  }
  fail('could not find a base branch. Pass one with --base <ref>.');
}

function splitDiffByFile(diff) {
  if (!diff) return [];
  const parts = diff.split(/^(?=diff --git )/m).filter(Boolean);
  return parts.map((text) => {
    const m = text.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    return { path: m ? m[2] : '(unknown)', text };
  });
}

/**
 * Fit the diff into the character budget without lying about it.
 * Small, high-signal files go in whole, smallest first, so a single enormous
 * file cannot crowd out ten small ones. Anything left out is named.
 */
function budgetDiff(files, budget) {
  const lowSignal = [];
  const candidates = [];
  for (const f of files) {
    if (LOW_SIGNAL.some((re) => re.test(f.path))) lowSignal.push(f.path);
    else candidates.push(f);
  }
  candidates.sort((a, b) => a.text.length - b.text.length);

  const included = [];
  const truncated = [];
  const omitted = [];
  let used = 0;
  for (const f of candidates) {
    const room = budget - used;
    if (f.text.length <= room) {
      included.push(f);
      used += f.text.length;
    } else if (room > 1500 && truncated.length === 0) {
      // One partial file is worth having; several half-files are not.
      const cut = f.text.slice(0, room - 200);
      const safe = cut.slice(0, cut.lastIndexOf('\n'));
      included.push({ path: f.path, text: `${safe}\n[... ${f.path} truncated by qu-gate: ${f.text.length - safe.length} more characters not shown ...]` });
      truncated.push(f.path);
      used += safe.length;
    } else {
      omitted.push(f.path);
    }
  }
  // Restore a stable, readable order for the reviewer.
  included.sort((a, b) => a.path.localeCompare(b.path));
  return { included, truncated, omitted, lowSignal };
}

/**
 * Resolve one `--context` spec against the commit under review.
 *
 * Accepted: `path`, `path:12-40`, `path:symbolName`. The file is read with
 * `git show <head>:<path>` rather than from disk, so the excerpt provably belongs to
 * the commit being reviewed — reading the working tree would let an author commit one
 * thing and attach another.
 */
function readContextSpec(spec, head) {
  const m = spec.match(/^(.+?)(?::([^:]+))?$/);
  const path = m[1];
  const region = m[2];

  const raw = git(['show', `${head}:${path}`], { allowFail: true });
  if (raw === null) {
    fail(`--context path "${path}" is not in the commit under review (${head.slice(0, 12)})`);
  }
  const lines = raw.split('\n');
  const total = lines.length;

  let from = 1;
  let to = total;
  let label = 'whole file';

  const range = region && region.match(/^(\d+)-(\d+)$/);
  if (range) {
    from = Math.max(1, parseInt(range[1], 10));
    to = Math.min(total, parseInt(range[2], 10));
    if (from > to) fail(`--context range "${region}" in ${path} is empty`);
    label = `lines ${from}-${to}`;
  } else if (region) {
    const found = findSymbol(lines, region);
    if (!found) {
      fail(`--context symbol "${region}" not found in ${path} at the commit under review`);
    }
    ({ from, to } = found);
    label = region;
  }

  const text = lines.slice(from - 1, to).join('\n');
  return { spec, path, label, from, to, total, text };
}

/**
 * The enclosing block of a named declaration, by brace matching.
 *
 * Deliberately not a parser: a reviewer needs the function it was pointed at, and a
 * regex plus balanced braces gets that for every shape this codebase uses. A miss
 * FAILS rather than silently attaching the wrong lines — quietly shipping the
 * neighbouring function as evidence is worse than sending none.
 */
function findSymbol(lines, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decl = new RegExp(
    `(^|\\s)(function\\s+${escaped}\\b|(const|let|var)\\s+${escaped}\\s*=|${escaped}\\s*[:=]\\s*(async\\s*)?(function|\\())`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (!decl.test(lines[i])) continue;
    let depth = 0;
    let seen = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--;
      }
      if (seen && depth <= 0) return { from: i + 1, to: j + 1 };
    }
    // A declaration with no balanced block: give the reviewer the single line.
    return { from: i + 1, to: i + 1 };
  }
  return null;
}

/** Fit the excerpts into their own budget. Anything left out is named, never dropped. */
function budgetContext(items, budget) {
  const included = [];
  const omitted = [];
  let used = 0;
  for (const it of items) {
    if (it.text.length <= budget - used) {
      included.push(it);
      used += it.text.length;
    } else {
      omitted.push(it);
    }
  }
  return { included, omitted };
}

function readTests(path) {
  if (!existsSync(path)) fail(`--tests file not found: ${path}`);
  const raw = readFileSync(path, 'utf8').trimEnd();
  if (raw.length <= TEST_TAIL_CHARS) return { text: raw, clipped: false };
  return { text: raw.slice(-TEST_TAIL_CHARS), clipped: true };
}

function readCi() {
  try {
    return execFileSync('gh', ['pr', 'checks'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  } catch (err) {
    // gh exits non-zero when checks are failing or pending, and still prints them.
    const out = (err.stdout || '').toString().trimEnd();
    if (out) return out;
    return null;
  }
}

function build(opts) {
  if (git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }) !== 'true') {
    fail('not inside a git repository');
  }

  const head = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const base = resolveBase(opts.base);
  const mergeBase = git(['merge-base', base, 'HEAD'], { allowFail: true }) || git(['rev-parse', base]);
  const dirty = git(['status', '--porcelain']);
  const repoUrl = git(['config', '--get', 'remote.origin.url'], { allowFail: true }) || '';
  const repoName = repoUrl.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('/') || '(local repository)';

  const log = git(['log', '--no-merges', '--format=%h %s', `${mergeBase}..HEAD`]);
  const stat = git(['diff', '--stat=120', `${mergeBase}..HEAD`]);
  const diff = git(['diff', '--no-color', '--unified=3', `${mergeBase}..HEAD`]);

  if (!diff) fail(`no changes between ${base} (${mergeBase.slice(0, 12)}) and HEAD. Nothing to review.`);

  const fit = budgetDiff(splitDiffByFile(diff), opts.budget);
  const notSeen = [
    ...fit.truncated.map((p) => `${p} (partially shown)`),
    ...fit.omitted.map((p) => `${p} (over the size budget)`),
    ...fit.lowSignal.map((p) => `${p} (lockfile, build output, or binary)`),
  ];

  const contextItems = (opts.context || []).map((spec) => readContextSpec(spec, head));
  const ctx = budgetContext(contextItems, opts.contextBudget || DEFAULT_CONTEXT_BUDGET);
  for (const it of ctx.omitted) notSeen.push(`${it.path} (context, over the context budget)`);
  if (ctx.included.length) {
    notSeen.push('the rest of each context file: only the named regions were shown');
  }

  const tests = opts.tests ? readTests(opts.tests) : null;
  const ci = opts.ci ? readCi() : null;

  const evidence = [];
  evidence.push(`Repository: ${repoName}`);
  evidence.push(`Branch: ${branch}`);
  evidence.push(`HEAD under review: ${head}`);
  evidence.push(`Base: ${base} (merge-base ${mergeBase})`);
  if (dirty) evidence.push('WARNING: the working tree has uncommitted changes that are NOT part of this packet.');

  const sections = [];
  sections.push(`# Independent gate review request (${PROTOCOL})`);
  sections.push(evidence.join('\n'));
  sections.push(
    '## The claim under review\n' +
      (opts.claim
        ? opts.claim
        : '_No claim supplied. Review the change on its evidence alone and state what a merge-readiness claim would have to prove._'),
  );
  sections.push(`## Commits (${mergeBase.slice(0, 12)}..${head.slice(0, 12)})\n\`\`\`\n${log || '(no non-merge commits)'}\n\`\`\``);
  sections.push(`## Diff stat\n\`\`\`\n${stat}\n\`\`\``);
  if (tests) {
    sections.push(
      `## Test output${tests.clipped ? ` (last ${TEST_TAIL_CHARS} characters)` : ''}\n\`\`\`\n${tests.text}\n\`\`\``,
    );
  }
  if (opts.ci) {
    sections.push(`## CI checks (gh pr checks)\n\`\`\`\n${ci || 'gh returned nothing: no PR for this branch, or gh is not installed/authenticated.'}\n\`\`\``);
  }
  if (contextItems.length) {
    // Before the diff, because it is background the reviewer reads first — and headed
    // with who chose it, since this is the one section the author curates.
    const body = ctx.included
      .map((it) => `### ${it.path} — ${it.label} (lines ${it.from}-${it.to} of ${it.total})\n`
        + `\`\`\`\n${it.text.trimEnd()}\n\`\`\``)
      .join('\n\n');
    sections.push(
      '## Unchanged context (author-selected, not part of this change)\n'
      + `Requested: ${contextItems.map((it) => it.spec).join(', ')}\n\n`
      + 'These excerpts were selected by the author of the change to support claims the\n'
      + 'diff alone cannot settle. They are read from the commit under review and are NOT\n'
      + 'modified by it. Judge them as evidence, not as a complete account of the\n'
      + 'surrounding code.\n\n'
      + (body || '_Nothing fitted the context budget; see what this packet does not contain._'),
    );
  }
  sections.push(`## Diff\n\`\`\`diff\n${fit.included.map((f) => f.text.trimEnd()).join('\n')}\n\`\`\``);
  sections.push(
    '## What this packet does NOT contain\n' +
      (notSeen.length
        ? notSeen.map((p) => `- ${p}`).join('\n')
        : '- Nothing was left out of the diff.') +
      `\n${tests ? '' : '- No test output was attached. Any statement that tests pass is unverified.\n'}` +
      `${opts.ci && ci ? '' : '- No CI results were attached. Any statement that CI is green is unverified.\n'}` +
      '- The rest of the repository. Behaviour that depends on unchanged code cannot be confirmed from this packet.',
  );

  const packet = sections.join('\n\n') + '\n';

  const constraints = [
    `Protocol: ${PROTOCOL}`,
    `Exact HEAD under review: ${head}`,
    `Base: ${base} at merge-base ${mergeBase}`,
    'The reviewer is independent of the agent that wrote this change and must not defer to its claim.',
    'Judge the claim against the attached diff and results only. Where the evidence is absent, say so rather than assuming it.',
    'A PASS means: no P0 or P1 defect found in the evidence shown. It does not certify anything listed under "What this packet does NOT contain".',
  ];
  if (contextItems.length) {
    constraints.push(
      'Any "unchanged context" section was selected by the author of this change. Treat it as evidence, not as a complete account of the surrounding code, and say so if the selection appears to omit something material.',
    );
  }

  const brief = {
    reviewBrief: {
      objective: `Independent merge-gate review of ${repoName} at ${head.slice(0, 12)} on ${branch}. Decide whether the claim is supported by the evidence, and find what would break.`,
      constraints,
      responseUnderReview: packet,
      userConcerns: opts.concerns || 'Find defects the authoring agent would not report about its own work: unhandled failure paths, claims not backed by the diff, missing tests, security and data-loss risks.',
    },
    additionalContext: { protocol: PROTOCOL, headSha: head, baseRef: base },
  };

  return { packet, brief, stats: { chars: packet.length, files: fit.included.length, notSeen: notSeen.length } };
}

const opts = parseArgs(process.argv.slice(2));
const { packet, brief, stats } = build(opts);
const output = opts.json ? JSON.stringify(brief, null, 2) + '\n' : packet;

if (opts.out) {
  writeFileSync(opts.out, output);
  console.error(`qu-gate: wrote ${opts.out} (${stats.chars} chars, ${stats.files} files in diff, ${stats.notSeen} not shown)`);
} else {
  process.stdout.write(output);
  console.error(`qu-gate: ${stats.chars} chars, ${stats.files} files in diff, ${stats.notSeen} not shown`);
}

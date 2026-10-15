# qu-gate

**The agent that wrote the change may not approve it.**

One block for your `AGENTS.md` or `CLAUDE.md` that makes an independent reviewer a
required step before anything your coding agent produces is called merge-ready, released,
or done. The reviewer is [Qu Review](https://qureview.ai): a three-perspective panel on a
different vendor's models than the agent doing the work, reachable from Codex, Claude
Code, ChatGPT, Claude, Cursor or any MCP client, inside the same session.

Three files do the work:

| File | Use it for |
|---|---|
| [`protocol.md`](protocol.md) | Code: pull requests, migrations, releases. Also this repo's own [`AGENTS.md`](AGENTS.md). |
| [`protocol-design.md`](protocol-design.md) | Designs, architecture, specs, plans, decision records |
| [`protocol-documents.md`](protocol-documents.md) | Anything that goes out: drafts, filings, manuscripts, recommendations |

Plus [`qu-gate.mjs`](qu-gate.mjs), a zero-dependency script that turns a git repository
into a review packet (exact SHA, real diff, real test output), so the reviewer inspects
the change rather than the story about it.

## Install in two minutes

**1. Connect Qu Review** to the client your agent runs in.

| Client | How |
|---|---|
| Codex, ChatGPT | Install the plugin: <https://chatgpt.com/plugins/plugin_asdk_app_699f1bb1c5ac819182dfee0b2d2ed99f> |
| Claude Code | `claude mcp add --transport http qu-review https://app.qureview.ai/mcp` then `/mcp` to sign in |
| Claude (web, desktop) | Settings, Connectors, Add custom connector: `https://app.qureview.ai/claude/mcp` |
| Cursor, VS Code, Windsurf, any MCP client | `https://app.qureview.ai/mcp`, OAuth sign-in. Also on the [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=qureview) and [Smithery](https://smithery.ai/servers/qureview/review). |

Every account starts with free reviews, no card. That is one full cycle: review, fix,
re-review.

**2. Add the rule** to the instructions your agent reads at the start of every session:

```bash
curl -fsSL https://raw.githubusercontent.com/quplatforms/qu-gate/main/protocol.md >> AGENTS.md   # Codex
curl -fsSL https://raw.githubusercontent.com/quplatforms/qu-gate/main/protocol.md >> CLAUDE.md   # Claude Code
curl -fsSLO https://raw.githubusercontent.com/quplatforms/qu-gate/main/qu-gate.mjs             # the packet builder
```

Then rewrite it in your own words. Everyone who runs this does. The six rules that must
survive your rewrite are in the [operator guide](OPERATOR_GUIDE.md#3-install-the-rule).

**3. Submit evidence, not a summary of it.** Before a merge or release:

```bash
npm test > test-output.txt 2>&1
node qu-gate.mjs \
  --claim "All tests pass at HEAD, the migration is reversible, no public API changed" \
  --tests test-output.txt \
  --ci \
  --concerns "retry path, down-migration" \
  --out review-packet.md
```

Your agent submits `review-packet.md` unedited to Qu Review, reads the findings, fixes
what blocks, commits, and goes again at the new SHA. You authorize the merge. It does not.

## Why

A model asked to double-check its own work mostly returns a more confident version of the
first answer. A reviewer that did not write the change, runs on different models, and is
told to find a reason to block does better. And a reviewer can only judge what it is
sent: when agents submit their own description of a change, reviews come back cleaner
than when the real diff is attached. The lower score with the diff is the gate working.

The full reasoning, the severity mapping, and the patterns from people who run this every
day are in [`OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md).

## What `qu-gate.mjs` produces

- The exact HEAD and merge-base, the commit list, the diff stat.
- The diff itself, fitted to a size budget smallest files first, so one huge file cannot
  crowd out ten small ones. Lockfiles and build output are listed, not shown.
- The tail of your test output, and `gh pr checks` with `--ci`.
- Unchanged code your claim depends on, with `--context path`, `--context path:12-40`
  or `--context path:functionName`, read from the commit under review and labelled as
  author-selected.
- An explicit list of what the reviewer was **not** shown.

`node qu-gate.mjs --help` for every flag. Node 18+, no dependencies, read-only: it runs
`git` (and `gh` if asked) and writes markdown. It never pushes, merges or edits anything.

## What it is not

Qu Review does not clone your repository, run your code, or open your files. It reviews
what is submitted. It does not replace tests, CI or you; it is one independent check in a
process that should have others. It is a panel of language models and can be wrong,
which is why the protocol lets the agent record a disagreement and leaves the decision to
a human.

## Support

support@quplatforms.com · [qureview.ai/gate](https://qureview.ai/gate/) · [help](https://app.qureview.ai/help.html)

MIT licensed. Copy the block, change it, keep it.

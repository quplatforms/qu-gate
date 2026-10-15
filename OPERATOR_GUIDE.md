# Running Qu Review as an independent gate

This is how the people who get the most out of Qu Review actually use it. None of them
treat it as a fact-checker for a single answer. They run it as a **standing step in a
repeated process**: nothing their AI produces is allowed to move forward until a reviewer
that did not produce it has tried to break it.

It works for code (pull requests, designs, migrations) and just as well for documents
(legal drafts, manuscripts, curricula, anything with a "final" stage). The mechanics are
the same. Where they differ, this guide says so.

Time to set up: about 15 minutes.

---

## 1. The idea in one paragraph

The AI that produced the work believes the work is correct. Asking it to double-check
mostly returns a more confident version of the first answer. So you make a rule: **the
producer may not approve its own work.** Approval has to come from a reviewer that runs on
different models, has no stake in the work being finished, and is told to look for what is
wrong. Qu Review is that reviewer: a three-analyst panel (a skeptic, a subject expert, a
user advocate) on a different vendor's models than ChatGPT, Codex or Claude, callable from
inside the same conversation. Your AI calls it, reads the verdict, fixes what it found,
and calls it again. You make the final decision.

## 2. Connect it

| Where you work | How |
|---|---|
| **ChatGPT, and Codex through ChatGPT** | Install the plugin: <https://chatgpt.com/plugins/plugin_asdk_app_699f1bb1c5ac819182dfee0b2d2ed99f>. Sign in when prompted. Test it by typing `@Qu Review, review your last answer`. |
| **Claude (web or desktop)** | Settings, Connectors, Add custom connector. URL: `https://app.qureview.ai/claude/mcp` |
| **Another MCP client** | `https://app.qureview.ai/mcp`. OAuth sign-in. One tool: `submit_review_request`. |

Create the account at <https://app.qureview.ai/login?signup=true> first if you want your
history on the web. Use the same email everywhere and it is one account. You get 3 free
reviews, no card. That is exactly enough for one full cycle: review, fix, re-review.

> Use the path that matches your client. A Claude connector pointed at the ChatGPT path
> connects but renders nothing.

## 3. Install the rule

Copy one of these into the instructions your AI reads at the start of every session:

- **Code:** `protocol.md` into `AGENTS.md` (Codex),
  `CLAUDE.md` (Claude Code), or the instructions of the ChatGPT project that orchestrates
  your work.
- **Documents:** `protocol-documents.md` (or `protocol-design.md` for designs, specs and plans) into your ChatGPT project
  instructions, custom instructions, or Claude project.

Then rewrite it in your own words. Every heavy user has. The parts that must survive your
rewrite, because they are what make it a gate instead of a suggestion:

1. **The producer may not self-approve,** and may not substitute its own second pass if
   the reviewer is unavailable. It says "independent review unavailable" and stops.
2. **A review is bound to a version.** An exact commit SHA for code, a version label for a
   document. Any later change voids the review.
3. **Evidence, not a summary of it.** See section 4. This is the one most setups miss.
4. **A missing-evidence verdict is not a pass.** If the reviewer says it could not see
   something, the producer supplies it and re-submits.
5. **The producer cannot overrule a finding.** It can disagree, on the record, and the
   human decides.
6. **The human authorizes the final step.** Merge, send, file, publish, promote.

## 4. Submit the work, not the story about the work

Qu Review cannot see your repository or your files. It reviews exactly what is put in the
request. If your AI sends "CI is green at this SHA and the change is safe to merge", the
reviewer can only judge that sentence.

We measured this on our own traffic. When agents submitted only their own summary, 88% of
reviews scored 4 or higher out of 5. When the real diff was included, that fell to 78% and
more defects were found per review. The lower number is the gate working. 

**For code,** use the packet builder. One file, no dependencies, read-only:

```bash
curl -fsSLO https://qureview.ai/gate/qu-gate.mjs
npm test > test-output.txt 2>&1          # or your test command
node qu-gate.mjs \
  --claim "All tests pass at HEAD, the migration is reversible, no public API changed" \
  --tests test-output.txt \
  --ci \
  --concerns "retry path, down-migration" \
  --out review-packet.md
```

The packet contains the exact HEAD and merge-base, the commit list, the diff stat, the
diff itself fitted to a size budget (smallest files first, so one huge file cannot crowd
out ten small ones), the tail of your test output, `gh pr checks` if you pass `--ci`, any
unchanged code you attached with `--context`, and an explicit list of **what the reviewer
was not shown**: lockfiles, build output, anything over budget, the parts of a context
file outside the excerpt, and any result you did not attach. Your agent submits
`review-packet.md` unedited as `responseUnderReview`. `--json` emits the whole request
body if your client takes structured input. `--budget 80000` raises the diff budget for a
large change; split very large changes into separate reviews instead.

Commit `qu-gate.mjs` to the repo so every agent session has it.

**Attach the code your claim depends on, even when it did not change.** A diff shows what
moved. It cannot show the function your change calls, and a reviewer that cannot see that
function can only tell you it cannot see it. We hit this on our own work: four rounds
running, the reviewer said there was no evidence the API supplied the fields the page
read, about a handler that had not changed and therefore could not appear in the diff.

```bash
node qu-gate.mjs \
  --claim "..." --tests test-output.txt \
  --context routes/api.js:handleToday \
  --context lib/pricing.js:120-180
```

Repeatable, and three forms: a whole file, a line range, or a named function, which is the
one you will use most. Excerpts are read from the commit under review rather than from
your working copy, so what the reviewer sees provably belongs to the version being judged.
They get their own size budget, so context can never crowd out the change itself, and the
packet states how much of each file it is not showing.

Two things to understand before you use it.

**This is the one input you choose.** Everything else in the packet comes from git and
your test runner. `--context` does not, so the obvious failure is attaching the function
that supports your claim and skipping the one that complicates it. The packet says the
excerpts were author-selected and asks the reviewer to flag a selection that looks like it
omits something material. That makes curation visible. It does not make it impossible.
Attach what could prove you wrong.

**Expect a harder review, not an easier one.** When we re-ran a change that had already
passed, attaching one unchanged handler closed the standing gap and surfaced two new
concerns about code the reviewer had never been able to see. That is the flag working. A
packet that admits more evidence gets reviewed more thoroughly, which is the whole point.

**For documents,** the equivalent discipline is:

- Paste the **complete text**, word for word, with a version label.
- Paste **what it rests on**: the record, the sources, the standard, the rubric. A
  reviewer that cannot see the source cannot check the citation.
- State the claim so it can be proven false: "every factual statement is supported by the
  attached timeline, and nothing asserts a cause the record does not show".
- For a long work, review it in sections (a chapter, a unit, a filing section) and say
  which section this is. The heaviest document users paste 8,000 to 40,000 characters per
  review.

## 5. What a good request looks like

Your AI writes the request. These four fields are what it fills in:

| Field | Put here |
|---|---|
| `objective` | The decision being gated, and the moment. "Decide whether PR #48 at exact head `9f3c1e7…` may leave Draft." "Decide whether Unit 3 is ready to go to the printer." |
| `constraints` | `Protocol: qu-gate/1`, the SHA or version label, the base, and the rules of the review ("judge against the attached evidence only; say what is missing rather than assuming it"). |
| `responseUnderReview` | The packet or the full text. Never condensed. |
| `userConcerns` | What you are least sure of, specifically. "Double charges on retry, tests that pass without asserting anything, what happens if the migration is rolled back halfway." Specific concerns produce specific findings. |

Ask for an adversary, in so many words: *"Review this as a strict senior reviewer whose
job is to find a reason to block. Name concrete defects. Do not give credit for green CI
or confident wording."*

## 6. Reading the verdict

You get an overall score out of 5, scores for accuracy, completeness, depth, usefulness
and nuance, a list of **inaccuracies** (what is wrong, with the correction), a list of
**gaps** (what is missing, and why it matters), and follow-up questions.

Map them onto your own severity levels in your protocol. A workable default:

- **P0:** data loss, security, a broken build, a wrong result, a false statement in a
  filing. Blocks.
- **P1:** wrong behaviour on a realistic path, or a claim the evidence does not support.
  Blocks.
- **P2 and below:** recorded, does not block.

A high score with a P1 in it is still a fail. A middling score with only P2 findings may
pass. **Gate on the findings, not the number.**

Then the loop: fix, commit (or save the new version), rebuild the packet, re-submit. Tell
the reviewer what changed and ask whether the earlier findings are actually closed and
whether the fix introduced anything new. Expect two or three rounds on a change that
matters. That is normal, and it is where the value is.

## 7. Patterns from people who run this every day

- **Gate designs, not only diffs.** Several operators review the design or the plan before
  any code is written, then the implementation against the approved design. Catching a
  wrong invariant in a design review is far cheaper than catching it in a PR.
- **Gate stage transitions.** Draft to Ready-for-Review. Staging to production. Proposal to
  ratified. Candidate to published. One review per transition, recorded with the version.
- **Keep a review log.** One line per review: date, version, score, blocking findings,
  what changed. When something slips through, the log shows whether the gate saw it.
- **Let the reviewer's unavailability block.** If the reviewer cannot be reached, a
  well-instructed agent says it cannot claim an independent pass and stops. It does not
  quietly review itself instead. That is the rule working.
- **Keep the orchestrator separate from the executor.** A common shape: ChatGPT holds the
  thread and the protocol, Codex or Claude Code does the work in the repository, and the
  orchestrator calls Qu Review. The reviewer is then independent of both.
- **Favourable output is evidence, never proof.** A blocking finding freezes the work. A
  clean review is one more piece of evidence, and never a substitute for running the
  tests or checking the source.

## 8. What it is not

- It does not clone your repository, run your code, or open your files. It reviews what is
  submitted. If you did not send it, it was not reviewed.
- It does not replace tests, CI, a lawyer, an editor, or you. It is one independent check
  in a process that should have others.
- It is a panel of language models and can be wrong. That is why the producer can record a
  disagreement and you make the call.

## 9. Volume and fair use

An agent loop can run many reviews a day, and that is fine. There are fair-use safeguards
in place to stop runaway loops. If your real workload runs into them, write to
support@quplatforms.com and we will raise them for your account.

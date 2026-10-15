## Independent review gate (qu-gate/1)

The agent that wrote a change may not approve it. Before you describe any change as
merge-ready, release-ready, ratified, or done, it must pass an independent review.

**Reviewer.** Qu Review (`submit_review_request`). It runs on a different vendor's models
than you do and has no stake in this work. If it is not connected in this session, say
"independent review unavailable" and stop. Never substitute your own second pass, and
never report a review you did not receive.

**When.** After the work is committed and your own checks are green, and before any merge,
release, tag, or promotion out of draft. One review per candidate commit.

**What to submit.** Evidence, not a summary of it:

1. The exact HEAD commit SHA (all 40 characters) and the base it is compared against.
2. Your claim, stated so it can be proven false. Example: "All 214 tests pass at this
   HEAD, the migration is reversible, and no public API changed."
3. For a routine step, the commit list and diff stat (`git log --oneline <base>..HEAD`,
   `git diff --stat <base>...HEAD`) and what your checks do not cover. Before a merge,
   release, migration, or anything hard to undo, the actual diff as well: if
   `qu-gate.mjs` is in the repo, run
   `node qu-gate.mjs --claim "<your claim>" --tests <test-output-file>` and submit its
   output unedited as `responseUnderReview`. Otherwise paste `git diff <base>...HEAD`.
   Say in `constraints` which of the two you sent; a review without the diff does not
   certify the code.
4. Real test and CI output, not a sentence saying they passed.
5. What you are least sure of, as `userConcerns`.
6. Any unchanged code your claim depends on. A reviewer can only judge what it is sent,
   so a claim about code outside the diff is unverifiable by construction. Attach it with
   `--context <path>`, `--context <path>:<first>-<last>`, or `--context <path>:<symbol>`,
   repeated as needed. Attach what could disprove you, not only what supports you. The
   packet tells the reviewer you chose these excerpts, so a selection that leaves out the
   awkward part is worse than sending none.

Put `Protocol: qu-gate/1` and the HEAD SHA in `constraints`. Do not condense, clean up,
or omit anything to make the change look better. If the diff is too large to send whole,
say exactly which files were left out.

**Reading the review.** Qu Review returns findings and scores. It does not pass or fail
anything; the rules below are what turn its findings into a decision.

- Any inaccuracy or gap that is a P0 (data loss, security, broken build, wrong results)
  or a P1 (incorrect behaviour on a realistic path, a claim the evidence does not
  support) is a **FAIL**. Fix it, commit, and request a new review at the new SHA.
- A review is bound to the SHA it saw. Any new commit voids a previous PASS.
- If the reviewer says it could not see something it needed, that is not a PASS. Supply
  it with `--context` and re-submit. Supplying evidence is not a change to the code, so
  this re-submits at the same SHA and needs no new commit.
- You may disagree with a finding. Record the finding, your reasoning, and the evidence,
  and leave the decision to the human owner. You may not overrule the reviewer yourself.

**What to report to the owner.** The SHA reviewed, the overall score, every P0 and P1
finding verbatim, what you changed in response, and what the review did not cover. The
owner authorizes the merge. You do not.

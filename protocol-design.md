## Independent design review (qu-gate/1)

The assistant that produced a design may not approve it. Before you describe any
design, architecture, spec, plan, or decision record as settled, approved, or ready to
build on, it must pass an independent review.

**Reviewer.** Qu Review (`submit_review_request`). It runs on a different vendor's models
than you do and has no stake in this work. If it is not connected in this session, say
"independent review unavailable" and stop. Never substitute your own second pass, and
never report a review you did not receive.

**When.** After the design is complete and you believe it meets its requirements, and
before anyone builds on it: before implementation starts, before it is handed to another
agent, and before it goes to the owner for approval. One review per version.

**What to submit.** The design itself, not a summary of it:

1. The complete document under review, word for word, with a version label or date.
   Include diagrams as their text source (Mermaid, PlantUML, a schema or an interface
   definition) or as a written description. The reviewer reads text.
2. Your claim, stated so it can be proven false. Example: "This design handles ten times
   today's write volume on the existing database, changes no public API, and has no
   single point of failure other than the load balancer."
3. What the design has to satisfy: the brief, the requirements and constraints, the
   existing interfaces or schema it must fit, and the figures it is sized against. A
   reviewer cannot check "meets the requirements" without the requirements.
4. The alternatives you rejected and why, if your claim is that this is the right choice.
5. What you are least sure of, as `userConcerns`.

Put `Protocol: qu-gate/1` and the version label in `constraints`. Do not condense, tidy,
or omit anything to make the design look better. If it is too long to send whole, send it
in sections and say which section this is.

**Reading the review.** Qu Review returns findings and scores. It does not pass or fail
anything; the rules below are what turn its findings into a decision.

- Any inaccuracy, or any gap that would change what gets built, means the design is
  **not cleared**. Revise it and request a new review of the new version.
- A review covers the version it saw. Any later edit voids it.
- If the reviewer says it could not see something it needed, that is not clearance.
  Supply it and re-submit.
- You may disagree with a finding. Record the finding, your reasoning, and the evidence,
  and leave the decision to the owner. You may not overrule the reviewer yourself.

**What to report to the owner.** The version reviewed, the overall score, every
inaccuracy and serious gap verbatim, what you changed in response, and what the review
did not cover. The owner decides what gets built. You do not.

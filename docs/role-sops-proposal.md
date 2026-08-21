# Role SOPs: what to generate, what to write, and the seam between them

**Status: a proposal for Rajesh. Nothing is built.**

## The honest answer to the question you asked

> *"Tell me honestly if you think a generated SOP would be worse than a written
> one, because a generated document can be accurate and unreadable."*

**A fully generated SOP would be worse than a written one, and it would be
worse in the specific way you named.** But a fully written one is already
demonstrably wrong within weeks. The answer is not to pick a side — it is to
put the seam in the right place and gate it.

### What the app knows

- which groups and tabs each role has, with the **live labels**, because
  `tabs.<group>` is a setting somebody can rename
- every route, and which roles the matrix admits to it
- what each form requires, from the zod schemas
- what each save refuses, and in what words
- what every honesty rule says

### What the app does not know, and this is the SOP

- **The order of the day.** A tab strip is ordered by *frequency and person and
  moment*, not by time. `tabs.ts` says so in as many words: *"ISSUE BEFORE
  RECEIVE, deliberately. A store manager issues several times a day and
  receives once, so FREQUENCY sets the order."* A generated SOP walking the tab
  strip would tell the store manager to issue before receiving — reading a
  frequency ranking as a sequence and producing a day that is not the job.
- **What triggers each task.** "When the van is at the door." "Before the
  evening shift starts." "When the chef hands you the indent." None of that is
  in the code, and it is the whole content of an SOP.
- **What to do when something is wrong.** Who to call. Whether to accept a
  short delivery or refuse it. Whether to wait.
- **Why it matters.** *"Enter the bill before you put the goods away — if you
  don't, the shelf goes negative and the next count blames the wrong person."*
  That sentence is what makes somebody comply. No schema contains it.

Generate all of it and you get: *"Open Store → Issue. Fill: department,
session, items, quantities. Save."* That is a manual for a form. Nobody reads
it twice, and a document nobody reads twice is worse than none, because it
looks like the job is documented.

### But written-only is already failing

This month alone: Day close moved out of Record and back again, Expenses moved
from Staff to Accounts (a real permission change — a manager can no longer
record one), Production moved out of End of shift, Reorder / Count / Loss were
absorbed into Stock, and Employees and Attendance stopped being chips. A
written SOP would be wrong on all six, **and silently** — the person following
it hits a wall and concludes the app is broken.

---

## The proposal: prose carries the job, the app carries the facts that drift

One page per role: `/owner/sops/<role>`, printable. Each role can open their
own; manager and owner can read all of them.

A page is a sequence of **MOMENTS**, not tabs. A moment has six parts, and the
line between generated and written is hard:

| Part | Source |
|---|---|
| **WHEN** — "the van is at the door" | **written** |
| **WHERE** — route, its live label, its chips | **generated** |
| **WHAT IT ASKS FOR** | **generated** |
| **WHAT IT REFUSES, AND WHY** | **generated**, curated by key |
| **WHY IT MATTERS** | **written** |
| **IF IT GOES WRONG** | **written** |

The prose is short — a sentence or two per part — which is the amount somebody
will actually keep up to date. The app fills in the parts that move.

`src/lib/sops.ts` is a **KEY REGISTRY** like `tabs.ts` and
`query-entities.ts`: the moments, in order, per role, each naming a route by
key. Structural, in code. A settings row must never be able to invent a moment
or point one at a route that does not exist.

## The gate is the reason this beats a written document

This is the half that matters, and it needs no generated prose at all:

- **every moment names a route that EXISTS** — the same walk `smoke:phase-a`
  already does for the 32 tab chips, which caught `/store/reorder/due` and
  `/store/reorder/slow` 404ing for as long as that tab had existed;
- **every moment is OPENABLE by the role whose page it is on** — `canAccess`,
  the same instrument as `audit:matrix`;
- **every route a role can open appears in some moment, or is explicitly marked
  "not part of the daily round"** — otherwise the SOP silently omits a screen,
  which is the failure mode `/owner/day` shipped with;
- **the label shown is read from the live tab config**, so a rename in Settings
  reaches the SOP without anybody remembering.

Move a tab and the build goes red naming the moment, instead of a chef opening
a page that moved last month. **A separate document can never have that
property**, and a written SOP inside the app gets it for free.

## Two versions — start with the smaller one

**Version 1 (recommended first).** Written prose + generated route, live label
and link + the gate. Drops the generated *fields* and *refusals* entirely.
Small, readable, and drift-proof on the thing that actually drifts. This is
what I would build.

**Version 2.** Adds "what it asks for" and "what it refuses". Only if version 1
proves useful, and with two costs stated up front:

- a zod schema key is not a word a chef uses — `sectionId` is not "which
  department". So the field names must come from the form's own **labels**, not
  the schema, which means the labels have to be reachable from outside the
  component. That is real work and it is the reason version 2 is second.
- refusal strings are written for the moment of failure, not for a manual. Some
  read oddly in a list. Only the ones that are **rules** belong — the day-close
  chain, the session that is never assumed, the gas double-count — curated by
  key, never "all refusals in this file".

## Details worth settling now

**Print.** The stylesheet already has the block, keyed on `nav` and
`data-chrome="true"` and written as *"app furniture does not print"* — added
for the vendor statement. An SOP page inherits it. One page per role, so it can
go on a wall.

**Language.** The en/te dictionary covers **labels on five staff-facing forms**.
An SOP is prose, and translating prose is a genuine cost, not "adding data" the
way a label is. Ship English, put the Telugu column in the same registry so it
can be filled later, and do not pretend the machine can do it.

**Who writes the prose.** You do, once, per moment — about forty short
sentences across six roles. That is an afternoon, and it is the only part of
this that is actually the SOP.

**Where it lives in the nav.** Not a seventh tab in every group. One page under
Owner, plus a quiet "Your day" link on each group's dashboard pointing at that
role's own page — which is where somebody stands when they have forgotten what
comes next.

---

## What I would not do

- **Generate the whole thing.** Accurate and unreadable, exactly as you said.
- **Write the whole thing outside the app.** Wrong within weeks, silently.
- **Put it in a settings screen.** Settings configure vocabulary and local
  rules. The order of somebody's day is neither, and this project's own line is
  that a wall of toggles is the console it exists to avoid.

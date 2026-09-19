# MVP Plan

## Scope Statement

V0 builds the **universal engine** described in `architecture.md` and
proves it is genuinely sport-agnostic by configuring exactly three
`MotionTemplate`s — **squat, basketball jump shot, golf swing** — chosen
because they stress the architecture differently:

- **Squat**: cyclic, single-plane (side view), slow tempo, symmetric.
- **Basketball jump shot**: fast/explosive, asymmetric (shooting arm),
  vertical + rotational.
- **Golf swing**: fundamentally 3D/rotational, hardest to reduce to a
  single 2D camera plane, tests the limits of monocular analysis and
  informs the `Future3DPoseProvider` requirement.

If adding the third template requires touching core pipeline code (not
just `template.json`/`rules.json`), that is a signal the architecture
leaked sport-specific assumptions and must be fixed before continuing —
this is the explicit acceptance test for "sport-agnostic," not just an
aspiration.

## Pose Model Decision for V0

**MediaPipe Pose (BlazePose)**, behind the `PoseProvider` interface.
Rationale (full comparison in `research.md` §1):
- Only candidate that runs in-browser (WASM) *and* server-side *and*
  native mobile from one Apache-2.0 codebase — lets V0 start with
  zero backend infrastructure for pose extraction (extract client-side,
  upload only the derived `MotionSequence` JSON, not raw video, which
  also serves the Privacy goals in `architecture.md` §6).
- Native 3D "world landmarks" ship with the same model — directly
  supports the "ability to upgrade to 3D later" requirement without a
  provider swap, just a capability flag (`has3D: true`) already modeled
  in `data-model.md`.
- Accuracy is good enough for coaching-grade (not clinical) feedback; its
  documented weakness (occlusion) is mitigated by the recording-guidance
  UI (Step 1) steering users toward full-body, unoccluded framing.

**RTMPose (via `rtmlib`)** is the documented V1 upgrade: higher accuracy,
whole-body (133kp) coverage, better crowd/occlusion behavior via RTMO —
implement as a second `PoseProvider` once a FastAPI inference path exists
for other reasons (e.g. the rule engine or DTW alignment already need a
backend call). Sports2D's angle-calculation module is reused unchanged
either way, since it operates on the common schema, not on either
provider's native format.

## Milestones

### M0 — Scaffolding
- Add `docs/` (this milestone's own deliverable — done).
- Stand up a minimal FastAPI service alongside the existing Next.js app
  (this repo currently hosts an unrelated two-phone recorder app; the
  Motion Coach work lives in new, separate routes/directories so as not
  to disturb it).
- Define the `PoseProvider`, `StorageProvider`, `AlignmentEngine`
  interfaces as TypeScript types + Python Protocols, no implementations
  yet.
- **Exit criteria**: interfaces compile/typecheck; no behavior yet.

### M1 — Pose extraction + skeleton rendering
- Implement `MediaPipeProvider` (browser, via MediaPipe Tasks Vision JS).
- Build the landmark adapter into `CommonSkeleton`.
- Recording UI: upload or record a short clip; basic guidance text (angle/
  distance/full-body/lighting) per `MotionTemplate.cameraGuidance`.
- Render the extracted skeleton over the source video on a Canvas overlay.
- **Exit criteria**: record/upload → see skeleton tracking overlaid on
  video, for any of the 3 target movements, no angle/phase logic yet.

### M2 — Motion representation
- Port Sports2D's `compute_angle`/`compute_angles_for_person` (angle math)
  and filtering pipeline into the shared representation module.
- Implement `buildMotionSequence()`: fills `jointAngles`, `segmentAngles`,
  `velocities`, centers, torso angle, normalization block.
- **Exit criteria**: a recorded clip produces a complete, schema-valid
  `MotionSequence` JSON (`data-model.md` §2) for all 3 movements, with
  joint angles visibly plausible (e.g. knee angle ~180° standing, ~90° at
  squat bottom).

### M3 — Movement segmentation
- Implement the generic `PhaseDetector` (project → peak-find → validate
  order, per `architecture.md` §3.3).
- Write `sports/squat/template.json`, `sports/basketball_shot/template.json`,
  `sports/golf_swing/template.json` — phases exactly as enumerated in the
  product brief.
- **Exit criteria**: for each of the 3 movements, phase boundaries are
  detected and roughly match a human's manual labeling of the same clip
  (spot-checked, not statistically validated at V0).

### M4 — Motion quality analysis + correction (single video)
- Implement the rule engine: `EvaluationRule` evaluation over a completed
  `MotionSequence` + phases, using baseline sources (A) template-default
  and (B) fixed biomechanical thresholds only (per `architecture.md` §4;
  (C)/(D) personal baselines are out of scope for V0).
- Seed `issueId` taxonomy and initial `rules.json` per sport from the
  FitAQA rubric categories (`research.md` §4), populated with a small,
  hand-picked set of rules per sport (one or two real, checkable
  deviations per movement — e.g. squat knee-valgus, jump-shot forward
  lean at release, golf swing early-extension — not attempting full
  biomechanical coverage).
- Implement the correction engine: rank findings, select the single
  primary one, generate `{what, when, why, whatToChange, cue, drill}` —
  cue/drill from a small authored library per `issueId`, `why`/phrasing
  polish via one LLM call constrained to the `Finding` object only (no
  video/raw landmarks in the prompt).
- UI: show PRIMARY CORRECTION only.
- **Exit criteria**: recording a deliberately-flawed rep of any of the 3
  movements surfaces one plausible, correctly-phased primary correction.

### M5 — Second recording + temporal + spatial alignment
- Prompt for an "after" recording once a correction has been shown; run
  M1–M4's pipeline on it identically.
- Implement `AlignmentEngine` with `dtaidistance`, Sakoe-Chiba windowed,
  phase-seeded (per `architecture.md` §3.6) — this is the first place a
  FastAPI round-trip is required (Python-only dependency).
- Implement `SpatialAligner` with selectable anchor (hip default).
- **Exit criteria**: `AlignmentMap` correctly pairs the "before release"
  frame with the "after release" frame (or equivalent key phase) even
  when the two clips run at different tempos — validated by spot-checking
  against manually identified key frames in test clips.

### M6 — Ghost overlay + comparison UI
- Implement `GhostOverlayView` (opacity slider) and `DifferenceView`
  (displacement vectors + measurement callouts) first; `SideBySideView`,
  `KeyFrameComparisonView`, `AnimatedComparisonView` follow if time
  allows within V0 — Ghost Overlay and Difference View are the two modes
  the product brief calls "the primary product feature" and are
  non-negotiable for V0; the other three modes may slip to V0.1 without
  invalidating the MVP.
- Motion trails for 1–2 key joints per sport (e.g. wrist for jump shot,
  hip for squat, wrist+hip for golf swing).
- Result screen assembling `MotionComparison` (deltas, no aggregate score).
- **Exit criteria**: full pipeline, RECORD → ... → RESULT, runs end-to-end
  for all 3 target movements without code changes between them — only
  `template.json`/`rules.json` differ.

### M7 — Cross-sport validation pass
- Deliberately try to break the sport-agnostic claim: attempt a 4th,
  unplanned movement (e.g. push-up) using only new config files, no code
  changes, as a hard test.
- Fix any core-code leakage discovered.
- **Exit criteria**: push-up runs through the same pipeline via config
  only, or a documented list of exactly what had to change and why.

## Explicit Non-Goals for V0

- No aggregate performance score.
- No personal baseline / motion signature (`UserBaseline`,
  `UserHistoryBaseline`) — architecture supports it, not built yet.
- No multi-camera 3D capture.
- No cloud storage (local filesystem only, behind the `StorageProvider`
  interface).
- No training of any new ML model — MediaPipe (and later RTMPose) are used
  as-is.

## Sequencing Rationale

M1→M4 (single-video pipeline) is deliberately front-loaded and validated
before M5 (two-video alignment) begins, because the product's hardest
open technical risk (DTW alignment quality) is easiest to debug once the
single-video `MotionSequence`/phase/finding pipeline is already known-good
— otherwise alignment bugs and representation bugs are hard to tell apart.

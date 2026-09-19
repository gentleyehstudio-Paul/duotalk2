# Architecture: Universal Motion Coach

## 1. Design Principles

1. **Sport-agnostic core, sport-specific config.** No `if sport == X`
   branching in analysis code. A sport is a data bundle (`MotionTemplate` +
   `EvaluationRule` set), loaded at runtime.
2. **Separate measurement from judgment from language.** Three distinct
   layers, never merged:
   - **Computer vision** produces numbers (angles, velocities, positions).
   - **Rule engine** turns numbers into structured, objective findings
     (deviation from a baseline, with a confidence and severity).
   - **LLM** turns structured findings into human-readable coaching text.
   The LLM never sees raw video and never invents a measurement — it only
   narrates findings the rule engine already computed. This prevents
   hallucinated biomechanical claims and keeps the "measurable changes over
   arbitrary scores" requirement enforceable in code, not just in prompts.
3. **Provider abstraction at every swappable boundary.** Pose engine,
   alignment algorithm, and storage backend are each behind an interface so
   V0's concrete choice (see `mvp-plan.md`) is not load-bearing for the rest
   of the system.
4. **Everything downstream of pose extraction operates on the normalized
   schema**, never on a specific provider's raw output. See
   `data-model.md`.

## 2. High-Level Pipeline

```
 ┌─────────┐   ┌────────────┐   ┌───────────────┐   ┌──────────────┐
 │ RECORD  │──▶│ POSE       │──▶│ MOTION         │──▶│ PHASE        │
 │ (video) │   │ EXTRACTION │   │ REPRESENTATION │   │ SEGMENTATION │
 └─────────┘   └────────────┘   └───────────────┘   └──────┬───────┘
                                                            │
      ┌─────────────────────────────────────────────────────┘
      ▼
 ┌───────────────┐   ┌───────────────┐   ┌─────────────┐
 │ MOTION QUALITY │──▶│ CORRECTION    │──▶│ SECOND      │
 │ ANALYSIS (rule │   │ ENGINE (rules │   │ RECORDING   │
 │ engine + LLM)  │   │  + LLM text)  │   │ (repeat 1-4)│
 └───────────────┘   └───────────────┘   └──────┬──────┘
                                                 ▼
 ┌────────────────┐   ┌────────────────┐   ┌─────────────┐
 │ TEMPORAL        │──▶│ SPATIAL        │──▶│ GHOST MOTION│
 │ ALIGNMENT (DTW) │   │ ALIGNMENT      │   │ OVERLAY +   │
 │                 │   │ (anchor/scale) │   │ DIFF/TRAILS │
 └────────────────┘   └────────────────┘   └──────┬──────┘
                                                    ▼
                                          ┌───────────────────┐
                                          │ RESULT SCREEN      │
                                          │ (before/after diff)│
                                          └───────────────────┘
```

Steps 1–4 run identically for the "before" and "after" recordings — there
is exactly one extraction/representation/segmentation pipeline, invoked
twice. Only the alignment/overlay stage is inherently two-sequence.

## 3. Module Breakdown

### 3.1 PoseProvider (pose extraction abstraction)

```
PoseProvider (interface)
 ├── extract(videoFrame) -> RawPoseFrame
 ├── capabilities: { keypointCount, has3D, runtime: 'browser'|'server'|'both' }
 └── landmarkMap: maps provider-specific indices -> CommonSkeleton indices

Implementations:
 ├── MediaPipeProvider     (browser + server, 33 kp, native 3D "world" coords)
 ├── RTMPoseProvider       (server via rtmlib/ONNXRuntime, COCO-17/133, 2D)
 └── Future3DPoseProvider  (placeholder: RTMPose3D/RTMW3D or triangulated
                             multi-camera 3D via Pose2Sim-derived code)
```

Every provider outputs `RawPoseFrame` in its own native indexing; an
adapter (`landmarkMap`) immediately projects it into the shared
`CommonSkeleton` schema (`data-model.md`) before anything else touches it.
No downstream code ever imports a provider-specific type. Swapping
MediaPipe for RTMPose is a config change plus a new `landmarkMap`, not a
rewrite.

Provider selection is a runtime capability negotiation, not a hardcoded
choice: the frontend requests "best available for this device," and the
system picks browser-side MediaPipe when no backend round-trip is desired
(privacy, latency) or server-side RTMPose when higher joint coverage/
accuracy is worth the upload.

### 3.2 Motion Representation

A pure function, `buildMotionSequence(CommonSkeleton[]) -> MotionSequence`,
computes (per `data-model.md`):
- normalized joint positions (scaled by a body-size reference, e.g.
  shoulder-to-hip distance, so different camera distances/body sizes are
  comparable)
- joint angles and segment angles (Sports2D-derived arctan2 math, reused
  verbatim regardless of provider)
- joint velocity / acceleration (finite differences over the filtered
  position signal; filtering reuses Sports2D/Pose2Sim's Butterworth/
  One-Euro options)
- body/hip/shoulder centers, torso angle, movement direction
- a per-frame confidence, propagated from the provider's own per-keypoint
  confidence/visibility score

This module has no knowledge of "sport" — it is the same function for a
squat and a golf swing.

### 3.3 MotionTemplate (movement segmentation)

```
MotionTemplate (data, loaded from sports/<name>/template.json)
 ├── phases: ordered list of { name, entryCondition, exitCondition }
 ├── keyJoints: which joints/angles this sport cares about
 ├── relevantAngles: which computed angles feed phase/rule evaluation
 ├── temporalRelationships: expected ordering/timing constraints between phases
 └── evaluationRules: ref into EvaluationRule set (3.4)
```

Phase detection is a generic `PhaseDetector` that:
1. Projects the `MotionSequence` onto the axis/angle the template names as
   its primary signal (e.g. hip vertical position for a squat, wrist height
   for a jump shot, torso rotation for a golf swing) — the same
   project-then-peak-find pattern generalized from `opencap-processing`'s
   gait detector (see `research.md` §3).
2. Finds candidate phase boundaries via peak/threshold detection on that
   projected signal.
3. Validates candidates against `temporalRelationships` (expected order),
   discarding violations — directly generalizing `opencap-processing`'s
   `detect_correct_order()`.

Sport modules are JSON config, not code:

```
sports/
  squat/
    template.json     # phases: standing, descent, bottom, ascent, standing
    rules.json
  basketball_shot/
    template.json     # phases: ready, dip, load, upward_drive, set_point,
                       #         release, follow_through, landing
    rules.json
  golf_swing/
    template.json     # phases: address, backswing, top, downswing,
                       #         impact, follow_through
    rules.json
```

Adding a fourth sport (e.g. push-up) means writing a new `template.json` +
`rules.json`; it never touches `PhaseDetector`, the rule engine, or the
correction engine.

### 3.4 Motion Quality Analysis (rule engine)

```
EvaluationRule (data, per sport, referenced by template.json)
 { id, phase, metric: (MotionSequence, phase) -> number,
   baselineSource: 'template_default' | 'user_baseline' | 'user_history',
   threshold, severityBands, issueId }
```

The rule engine evaluates every `EvaluationRule` against the completed
`MotionSequence` and its detected phases, producing `Finding` objects
(`data-model.md`) — e.g. `excessive_forward_lean`, `late_hip_extension`,
`asymmetric_knee_valgus`. This is pure computation: given the same
sequence and rules, it is deterministic and testable without any LLM call.
The `issueId` taxonomy is seeded from FitAQA's 38-error/6-dimension rubric
(`research.md` §4) rather than invented ad hoc.

Only after findings exist does an LLM turn the single, ranked **primary**
finding into coaching text (3.5) — it receives the structured `Finding`
object, phase name, and measured/baseline values as its entire input; it
does not receive video or raw landmarks.

### 3.5 Correction Engine

```
CorrectionEngine.generate(Finding, MotionTemplate) -> Correction
 { what, when, why, whatToChange, cue, drill }
```

`CorrectionRule` configs (per sport, keyed by `issueId`) provide the
drill/cue library; the LLM's job is narrowing a template + measured values
into one or two natural sentences, not inventing biomechanical advice from
scratch. Findings are ranked (by severity × confidence); the UI is
contractually shown only the top-ranked `Correction` by default ("PRIMARY
CORRECTION"), matching the spec's anti-overwhelm requirement.

### 3.6 Temporal Alignment (DTW)

```
AlignmentEngine.align(beforeSeq: MotionSequence, afterSeq: MotionSequence,
                       phases: {before: Phase[], after: Phase[]})
  -> AlignmentMap   // alignment_map[beforeFrame] = afterFrame
```

Implementation (per `research.md` §5): `dtaidistance`, applied to
normalized joint-angle vectors (not raw pixel landmarks), windowed with a
Sakoe-Chiba band sized to a configurable max tempo-ratio (default ±40%),
and **seeded by phase boundaries** — DTW runs within each corresponding
phase pair (before-phase-N ↔ after-phase-N) rather than across the whole
clip unconstrained. This directly avoids the pathological-warp failure
mode documented in `research.md` and ensures "before release" aligns with
"after release" rather than an arbitrary equal-cost frame.

### 3.7 Spatial Alignment

```
SpatialAligner.normalize(sequence, anchor: 'hip'|'torso'|'foot'|custom)
  -> normalizedSequence  // translated to anchor origin, scaled, optionally
                          // rotated to a canonical facing direction
```

Anchor is user/sport-selectable (spec requirement). Rotation normalization
is applied only when the template says orientation is not itself
meaningful (e.g. squat facing direction is arbitrary); it is *not* applied
where orientation is part of what's being measured (e.g. torso rotation in
a golf swing) — this decision lives in the `VisualizationProfile` (3.8),
not hardcoded.

### 3.8 Ghost Motion Overlay & Visualization

```
VisualizationProfile (per sport, optional overrides)
 { anchor, rotationNormalization: bool, trailJoints: string[],
   primaryCamera Angle guidance text }

Renderer (Canvas2D or WebGL in the Next.js frontend)
 ├── GhostOverlayView      (before+after skeleton, opacity slider)
 ├── SideBySideView
 ├── DifferenceView        (per-joint displacement vectors + measurements)
 ├── KeyFrameComparisonView
 └── AnimatedComparisonView (play/pause/scrub/frame-step/slow-mo, using
                              AlignmentMap to keep before/after in sync)
```

All five views consume the same `{beforeSeq, afterSeq, alignmentMap}`
triple; they differ only in draw calls, not in data prep. Motion trails
(3.9) are a rendering mode within these views, not a separate pipeline
stage.

### 3.9 Motion Trails

A trail is a polyline of a selected joint's normalized position across
`[phaseStart, phaseEnd]`, rendered for both `beforeSeq` and `afterSeq` in
the same coordinate space established by Spatial Alignment. No new data
model — it's a rendering-time reduction of `MotionSequence.landmarks` for
one joint.

### 3.10 Result Screen

Assembles: primary `Finding` + `Correction` (from before-video's analysis),
the joint-angle/timing/motion-path deltas at the aligned key phase (from
`AlignmentMap` + both `MotionSequence`s), and one embedded `GhostOverlayView`
snapshot. No aggregate score is computed or shown, per spec.

## 4. Baseline Architecture

Four baseline sources must be interchangeable inputs to the rule engine's
`baselineSource`:

```
BaselineProvider (interface)
 ├── TemplateDefaultBaseline   (A: reference athlete/template, ships with sport config)
 ├── BiomechanicalRuleBaseline (B: fixed rule thresholds, e.g. "knee valgus < 10°")
 ├── UserBaseline              (C: user-entered or system-estimated personal norm)
 └── UserHistoryBaseline       (D: aggregate of the user's own prior successful attempts)
```

V0 ships (A) and (B) only (see `mvp-plan.md`). (C) and (D) require a
`MotionSignature` store (a rolling summary of a user's own `MotionSequence`
history per sport) — the schema is defined in `data-model.md` so it can be
added later without a rule-engine rewrite, but it is explicitly out of
scope for V0.

## 5. Tech Stack Mapping

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js, TypeScript, Tailwind | Rapid MVP, one codebase for recording UI + result/overlay UI |
| Video/canvas | HTML5 Video + Canvas2D (WebGL only if Canvas2D profiles poorly for 5+ skeletons at 30fps) | Simplicity first; WebGL is an optimization, not a V0 requirement |
| Backend | Python, FastAPI | Needed only where a `PoseProvider` or `AlignmentEngine` implementation requires Python (RTMPose/`rtmlib`, `dtaidistance`); browser-only MediaPipe path can skip the backend round-trip entirely for pose extraction |
| CV/numerics | OpenCV, NumPy, SciPy | Sports2D/Pose2Sim's own stack; keeps ported code (angle math, filtering) dependency-compatible |
| Pose estimation | MediaPipe (V0) behind `PoseProvider`; RTMPose/`rtmlib` (V1) | See `mvp-plan.md` recommendation |
| Alignment | `dtaidistance` | See `research.md` §5 |
| Storage | Local filesystem, behind a `StorageProvider` interface (`save(blob) -> ref`, `load(ref) -> blob`, `delete(ref)`) | POC simplicity now; swapping to S3/GCS later is an interface implementation, not a rewrite |

## 6. Privacy

- Faces are never used as input to any analysis step; pose landmarks are
  sufficient and the schema carries no identity data.
- `StorageProvider` supports deleting the raw video independently of the
  derived `MotionSequence` — pose data can outlive the video, or the video
  can be deleted immediately after extraction while the (non-identifying)
  pose data is retained for the before/after comparison.
- The `PoseProvider` abstraction is what makes "process locally" a real
  future option: a browser-side `MediaPipeProvider` already keeps video
  entirely on-device (no upload needed) whenever the device is capable
  enough; this is a deployment configuration, not an architecture change.

## 7. What Is Explicitly Deferred (not V0)

- Multi-camera 3D capture (Pose2Sim-derived triangulation) — `Future3DPoseProvider` is a named placeholder, not implemented.
- `UserBaseline` / `UserHistoryBaseline` / personal `MotionSignature`.
- Cloud storage backend (interface exists; only local FS implementation ships).
- Any aggregate "performance score."

# Research: Pose & Motion Technology Landscape

This document compares existing pose-estimation engines, motion-alignment
techniques, and action-quality-assessment (AQA) prior art, so the Universal
Motion Coach architecture is grounded in what already exists rather than
guessed from first principles. See `open-source-audit.md` for the
license/reuse verdict per project, and `architecture.md` for how these
pieces map onto the system design.

## 1. Pose Estimation Engines

Six candidates were evaluated: MediaPipe Pose (BlazePose), MoveNet, MMPose /
RTMPose, and the three "reference projects" the task named (Sports2D,
Pose2Sim, OpenCap), each of which is itself a *wrapper* around one of the
first three rather than an independent pose model.

| Criterion | MediaPipe Pose (BlazePose) | MoveNet | MMPose (framework) | RTMPose (model in MMPose / `rtmlib`) |
|---|---|---|---|---|
| License | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |
| Runs in-browser (WASM/TFJS) | Yes — official Tasks-Vision JS (WASM+WebGL) | Yes — official TFJS build (WebGL/WASM) | No official browser build | No official browser build (would need ONNX Runtime Web port) |
| Native mobile (on-device) | Yes — official Android/iOS SDKs, GPU/NNAPI/Core ML delegates | Yes — via TFLite, incl. Edge TPU variant | No (research framework) | Yes via MMDeploy → ncnn/TensorRT, or the lightweight `rtmlib` package |
| Needs server/GPU | No | No | Effectively yes for research use | Runs well on CPU (ONNXRuntime); GPU/TensorRT for max throughput |
| Keypoints | 33 (body+face/hand endpoints), 2D + 3D "world" coords + visibility | 17 (COCO body), 2D only | 17–133 depending on model/task | COCO-17 / COCO-133 whole-body / Halpe-26 / animal variants |
| Reported accuracy | PCK@0.2 ≈ 84 (full model); degrades under occlusion | ~75–81% in one independent PCK-style study (no official COCO AP published) | SOTA research models, 75–81%+ COCO AP | RTMPose-m: 75.8% COCO AP; RTMPose-l (whole-body): 67.0% AP — best real-time accuracy/speed tradeoff in class |
| Speed | ~20–30 fps mobile CPU across lite/full/heavy tiers | Lightning ~50 fps mobile; Thunder ~12 fps (WASM) | N/A (framework) | RTMPose-m: 90+ fps CPU, 430+ fps GPU (TensorRT); RTMPose-s: 70+ fps on a 2020-era phone SoC via ncnn |
| Occlusion handling | Documented weak point — accuracy drops under occlusion/clutter | Not well documented, no explicit occlusion features | Depends on model | Top-down variant bounded by the person detector; sibling **RTMO** model targets crowded/occluded scenes directly (73–82% AP on CrowdPose) |
| 2D → 3D upgrade path | Native — "world landmarks" ship with the same model, no extra step | None official; needs a third-party lifting model | Separate 3D/mesh model families exist | Companion **RTMPose3D/RTMW3D** (2024–25) adds a 3D head for real-time whole-body 3D |
| Server vs. browser | Both, out of the box | Both, out of the box | Server/Python only; edge via export tooling | Server/Python/edge; no official browser build |
| Maintenance | Very active (commits within days) | Actively maintained overall; MoveNet's own weights unchanged since ~2021 | Slowing — last tagged release Jan 2024, last repo push over a year old | `rtmlib` (standalone runtime) actively maintained; commits within weeks |
| Commercial usability | Unrestricted | Unrestricted | Unrestricted (verify any third-party checkpoint's dataset terms separately) | Unrestricted (same caveat) |

**Reference-project pose backends** (see `open-source-audit.md` for full
detail):
- **Sports2D** defaults to RTMPose via `rtmlib` (not MediaPipe) — monocular,
  single-camera, BSD-3 licensed.
- **Pose2Sim** supports RTMPose, MediaPipe, AlphaPose, DeepLabCut, or legacy
  OpenPose as pluggable 2D backends, then triangulates 3D from ≥2 calibrated
  cameras.
- **OpenCap** is hard-wired to **OpenPose**, whose license is non-commercial
  research-only and whose paid commercial tier explicitly **excludes use in
  Sports** — a disqualifying constraint for this product (see audit doc).

**Implication for V0**: no single engine dominates on every axis. MediaPipe
wins on "works everywhere with zero infra" (browser + mobile + server, one
model, native 3D landmarks); RTMPose wins on raw accuracy/speed and
whole-body joint coverage but needs a Python inference service and has no
browser build. The `PoseProvider` abstraction (see `architecture.md`) exists
specifically so this choice is not permanent — see `mvp-plan.md`/the report
below for the concrete V0 recommendation.

## 2. Motion Representation & Normalization

None of the six candidate pose engines emit anything beyond raw per-frame
keypoints; the "joint angle / velocity / normalized skeleton" layer the
product needs does not come from the pose engine itself, but from Sports2D's
downstream angle-computation code:

- `compute_angle()` / `compute_angles_for_person()` (Sports2D) — arctan2-based
  joint and segment angle math from 2D keypoint pairs/triplets, with
  automatic left/right flip resolution from foot-toe orientation. Pose-engine
  agnostic (works on any keypoint set with matching landmark indices),
  BSD-3, directly portable.
- `compute_floor_line()` (Sports2D) — estimates the ground-plane angle from
  low-velocity stance frames via linear regression, giving a calibration-free
  reference frame instead of requiring a checkerboard.
- `convert_px_to_meters()` (Sports2D) — a monocular pixel-to-metric heuristic
  usable for very rough scale normalization without full 3D triangulation.
- Filtering (Butterworth / Kalman / One-Euro / GCV spline), shared between
  Sports2D and Pose2Sim — standard, reusable signal-cleaning for noisy
  keypoint streams before angle/velocity derivation.

Pose2Sim's `weighted_triangulation()` and calibration code (OpenCV
checkerboard/ChArUco, BSD-3) is the reference implementation for a *future*
multi-camera 3D upgrade, but is explicitly out of scope for a
single-phone-camera V0 (see `open-source-audit.md`).

## 3. Movement Segmentation (Phase Detection)

No project among Sports2D, Pose2Sim, or OpenCap's core repo ships general
phase/event detection. The one directly relevant algorithm found is in the
companion repo **`opencap-processing`** (`ActivityAnalyses/gait_analysis.py`):
gait event (heel-strike/toe-off) detection via `scipy.find_peaks()` on
marker positions projected onto the walking-direction heading vector, with a
`detect_correct_order()` step that rejects peaks violating the canonical
stride sequence. The technique — **project keypoints onto a
movement-relevant axis, peak-find, then validate against an expected
event order** — generalizes cleanly to non-gait movements (e.g. barbell
vertical displacement for a squat, wrist height for a jump shot) and is the
closest existing precedent for the sport-agnostic `MotionTemplate`
phase-detector this project needs. It still has to be generalized and
reimplemented ourselves; nothing ships a configurable, sport-agnostic phase
detector today.

## 4. Motion Quality Analysis / Action Quality Assessment (AQA)

AQA is an active research area with two competing paradigms (per the 2026
IJCV survey "A Decade of Action Quality Assessment", arXiv:2502.02817, and
"A Comprehensive Survey of AQA: Method and Benchmark", arXiv:2412.11149):

- **Video-based**: end-to-end CNN/transformer regresses a quality score
  directly from raw pixels. Opaque, not interpretable, not what this
  product needs (the spec explicitly rejects an arbitrary "score").
- **Skeleton-based**: pose extracted first, then reasoning happens over
  joint trajectories/angles — more interpretable, more sample-efficient,
  and the correct branch of the literature for a system that must explain
  *which joint, which phase, how much*.

**FitAQA** (Hugging Face: `Kelly0510/FitAQA`, Apache-2.0 for annotations)
is the most directly useful artifact found: 2,219 videos / 5,512 QA
instances across 30 bodyweight exercises, annotated against a **taxonomy of
38 recurring form errors across 6 quality dimensions** (alignment,
symmetry, stability, coordination, tempo, completeness). This taxonomy is
reusable *as a rubric* for structuring our own `Finding` schema
(`data-model.md`) even without using the dataset's videos — it is
sports-science-informed prior art for "what kinds of things can be wrong
with a movement," which otherwise we would have to invent from scratch.
A related, larger dataset (**FLEX**, arXiv:2506.03198) exists in the same
research lineage but its license was not confirmed and should be checked
before any use.

**Fitness-AQA** (ParitoshParmar) is a relevant self-supervised
pose-contrastive approach to detecting BackSquat/OverheadPress/BarbellRow
form errors from a single video, but its dataset is gated behind a signed,
non-commercial-only terms form — not usable for a commercial product.

## 5. Temporal Alignment (DTW)

The task's reference project, `divyakarnani/sports-video-analysis`
("FormCheck"), was cloned and inspected directly. It implements a small,
hand-rolled, **unconstrained** DTW: a 36-dim hip-centered/torso-normalized
MediaPipe feature vector per frame, a plain O(n·m) DTW cost matrix with no
Sakoe-Chiba banding, and a traceback that is then **subsampled to
`min(n,m)` pairs** for the UI rather than exposing the true warping path. It
falls back to naive linear frame-index mapping if pose detection fails on
either clip. It has **no license** (default all-rights-reserved), 0
stars, and its entire history is a ~2-week solo project — useful only as a
*design reference* (the overall pipeline shape: normalize → DTW → resample
→ ghost overlay with joint-angle color-coded status is sound and worth
reimplementing cleanly), never as a dependency.

**Library options for a maintained, licensed DTW implementation:**

| Library | License | Maintenance | Verdict |
|---|---|---|---|
| `dtaidistance` | Apache-2.0 | Active (commits within days) | **Recommended.** Native multivariate/N-D support, `window` param for Sakoe-Chiba banding, `psi` relaxation for imprecisely-trimmed clip boundaries. |
| `tslearn` | BSD-2 | Active | Good alternative; ships DTW + Soft-DTW + global constraints, heavier dependency footprint (also brings clustering/classification tooling we don't need). |
| `fastdtw` | MIT | Stale since 2019 | **Avoid.** Wu & Keogh (arXiv:2003.11246 / IEEE TKDE 2020) showed FastDTW's approximation is both less accurate *and not reliably faster* than exact DTW at realistic sequence lengths — a 30–60s clip at 30fps is well within exact DTW's practical range anyway. |
| `dtw-python` | **GPL-3.0** | Actively released | Avoid for a commercial product — copyleft license is incompatible with a closed-source app; feature-rich constraint/step-pattern support otherwise. |
| `soft-dtw` (reference impl) / `pytorch-softdtw-cuda` | BSD-2 / MIT | Unmaintained (~2019) / research-grade | Not applicable — Soft-DTW's differentiability exists to support gradient-based *training*. This project aligns two already-recorded sequences offline; there is no training loop, so Soft-DTW buys nothing over classic DTW here. |

**Phase-seeded / hybrid alignment** is the pattern the biomechanics
literature actually recommends over raw whole-clip DTW:
- A golf-swing similarity paper (PMC12656346) explicitly argues "frame-wise
  comparisons — even when assisted by DTW — are inadequate," and instead
  segments into 7 phases and compares phase-wise.
- **PoseCoach** (arXiv:2204.08805, a running-coach system) uses a hybrid:
  coarse alignment at detected key events, then DTW *within* those
  windows — i.e., phase detection constrains DTW rather than replacing it.
- A javelin-throw paper (arXiv:2509.24606) segments into biomechanical
  phases before any cross-sequence comparison.

**Known DTW pitfalls and mitigations** (standard in the DTW literature,
also called out in `tslearn`'s own docs): unconstrained DTW can produce
pathological/degenerate warps (one frame in sequence A matching dozens of
frames in sequence B) and is sensitive to noise because it only compares
raw point distances. Mitigations: a Sakoe-Chiba band (`|i−j| ≤ r`) sized to
the expected max tempo-ratio between "before" and "after" attempts (e.g.
±30–50%), and/or Derivative DTW (comparing local slopes instead of raw
values) to reduce shape-blind matching.

**Conclusion**: build alignment on `dtaidistance`, windowed with a
Sakoe-Chiba band, applied to normalized joint-angle vectors (not raw pixel
landmarks), and — per the phase-based literature above — seed/segment the
DTW using the same `MotionTemplate` phase boundaries already needed for
Step 4, rather than treating phase detection and alignment as unrelated
components. This directly mitigates the pathological-warp failure mode and
is citable, not novel.

## 6. Summary Table: Head-Start Value by Component

| Product component | Best existing reference | What we still have to build |
|---|---|---|
| Pose extraction | MediaPipe / RTMPose (pick one, `PoseProvider` abstracts) | Normalization into our common skeleton schema |
| Joint/segment angles | Sports2D `process.py` (reusable as-is) | Wiring into our `MotionSequence` object |
| Phase/event detection | `opencap-processing` gait peak-finder (technique, not code, reusable) | Generalizing to a configurable, sport-agnostic detector |
| Rule-based deviation findings | FitAQA's 38-error/6-dimension taxonomy (rubric only) | The rule engine itself, and sport-specific `EvaluationRule` configs |
| DTW alignment | `dtaidistance` (library) + FormCheck (design reference only) | Windowed/phase-seeded implementation, our own alignment_map format |
| Spatial normalization | Pose2Sim/Sports2D anchor-normalization concepts | Our own anchor-selection UI and rotation/scale normalization |
| Ghost overlay / motion trails / diff view | FormCheck's overlay pattern (design reference only, unlicensed) | All rendering code (Canvas/WebGL), from scratch |
| Correction/coaching text | — | The whole correction engine + LLM-explanation layer (CV/rules/LLM separation is our own architectural decision, not found elsewhere) |

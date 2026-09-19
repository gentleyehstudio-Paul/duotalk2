# Open-Source Audit

License, maintenance, and reuse verdict for every project and library
evaluated during Phase 1 research. "Reuse" means: can we take code/algorithms
directly; "Reference only" means: useful as a design pattern but not to be
copied (license or quality prevents it); "Avoid" means: do not depend on
this at all for a commercial product.

## Pose Estimation

### MediaPipe Pose / BlazePose
- **Repo**: `google-ai-edge/mediapipe`
- **License**: Apache-2.0
- **Maintenance**: Very active (commits within days of this audit); ~37k stars
- **Reuse**: The model itself, via official Python/JS/Android/iOS SDKs, as our primary or fallback `PoseProvider`. No code to "extract," it's consumed as a library/SDK.
- **Do not reuse**: N/A
- **Integration difficulty**: Low. Official SDKs for every target platform (browser WASM, native mobile, Python server).

### MoveNet
- **Repo**: `tensorflow/tfjs-models` (MoveNet lives inside)
- **License**: Apache-2.0
- **Maintenance**: Repo active overall; MoveNet's own weights essentially frozen since ~2021
- **Reuse**: Possible lightweight browser-only alternative to MediaPipe if binary size/speed matters more than 3D landmarks or joint coverage.
- **Do not reuse**: Don't pick as primary if 3D upgrade path matters — no native 3D output and no first-party 3D companion model.
- **Integration difficulty**: Low (browser), Medium (native mobile — no dedicated SDK, must use raw TFLite runtime).

### MMPose (framework) / RTMPose (model) / `rtmlib` (standalone runtime)
- **Repos**: `open-mmlab/mmpose`, `Tau-J/rtmlib`
- **License**: Apache-2.0 (both)
- **Maintenance**: MMPose framework itself has slowed (last tagged release Jan 2024, last push >1 year old at time of audit); `rtmlib` (the piece we'd actually depend on) is actively maintained (commits within weeks).
- **Reuse**: `rtmlib` as a `PoseProvider` implementation when server-side accuracy/whole-body coverage matters more than zero-infra browser deployment. RTMPose checkpoints (COCO-17 / COCO-133 whole-body) via `rtmlib`.
- **Do not reuse**: The full MMPose training framework — we only need inference, and `rtmlib` already strips the heavy `mmcv`/`mmdet` dependency chain.
- **Integration difficulty**: Low via `rtmlib` (ONNXRuntime, CPU-capable); Medium if targeting mobile/edge (needs MMDeploy export to ncnn/TensorRT).
- **Caveat**: verify licensing of any specific pretrained checkpoint's *training dataset* terms before shipping — the Apache-2.0 grant covers the code, not necessarily every derived weight file per OpenMMLab community discussion.

## Reference Projects Named in the Brief

### Sports2D — `davidpagnon/Sports2D`
- **What it is**: Single-camera, monocular Python CLI: video → 2D pose (via `rtmlib`/RTMPose by default) → 2D joint/segment angles over time, optional OpenSim export.
- **License**: BSD-3-Clause.
- **Commercial usability**: Fully permissive. One transitive caveat: default backend is RTMPose/rtmlib (Apache-2.0), fine; if a user substitutes an OpenPose backend, that reintroduces OpenPose's restriction (see OpenCap below) — don't offer that option.
- **Reuse**:
  - `compute_angle()` / `compute_angles_for_person()` / `draw_joint_angle()` — arctan2-based joint/segment angle math with automatic left/right flip resolution. **Directly portable** into our angle-calculation module regardless of which `PoseProvider` we use.
  - `compute_floor_line()` — ground-plane angle estimation from stance-phase foot positions via linear regression; calibration-free reference frame.
  - `convert_px_to_meters()` — monocular pixel-to-metric heuristic.
  - The Butterworth/Kalman/One-Euro/GCV-spline filtering pipeline.
- **Do not reuse**: The OpenSim inverse-kinematics export path (heavy native dependency, not web/serverless-friendly). The LSTM marker-augmentation model (built for anatomical marker sets we don't use).
- **Note**: Sports2D has **no gait/phase-cycle detection** — do not assume it. We build phase detection ourselves (see `opencap-processing` below).
- **Maintenance**: Active, essentially solo-maintained (David Pagnon), commits within weeks of this audit, ~300 stars.
- **Integration difficulty**: **Low.** Pure Python, pip-installable, CPU-capable (ONNX). This is our highest-value reuse target.

### Pose2Sim — `perfanalytics/pose2sim`
- **What it is**: Multi-camera (≥2, calibrated, synchronized) markerless 3D mocap pipeline: 2D pose (pluggable backend) → DLT triangulation → OpenSim inverse kinematics. Peer-reviewed accuracy: 2–6° joint-angle error vs. marker-based mocap.
- **License**: BSD-3-Clause.
- **Commercial usability**: Fully permissive for the code itself. Avoid the optional OpenPose backend choice for the same reason as above.
- **Reuse**:
  - `calibration.py` — OpenCV checkerboard/ChArUco calibration, plus format conversion from Vicon/Qualisys/OptiTrack.
  - `triangulation.py` — confidence-weighted DLT triangulation with iterative worst-camera exclusion.
  - `synchronization.py` — Pearson time-lagged cross-correlation of per-camera keypoint-speed signals for multi-camera sync (notably: **not DTW** — Pose2Sim deliberately avoids DTW here for a different problem, cross-camera sync, not before/after comparison).
  - All of the above is relevant only once/if we add a multi-camera 3D mode — **not for V0**.
- **Do not reuse**: OpenSim itself (C++/SWIG, conda-distributed, multi-GB, not deployable in a lightweight FastAPI container). The ≥2-calibrated-camera assumption is architecturally incompatible with a single-phone V0.
- **Maintenance**: Active, ~800 stars, same primary maintainer as Sports2D.
- **Integration difficulty**: **High** as a whole pipeline (multi-camera hardware + OpenSim); **Low** for cherry-picking the calibration/triangulation/sync modules later.

### OpenCap — `opencap-org/opencap-core` (+ `opencap-processing`)
- **What it is**: Full system for markerless 3D movement dynamics from ≥2 synchronized smartphone videos: iOS capture app (closed-source, not in these repos) + cloud backend (`opencap-core`, `opencap-api`) + OpenSim-based kinetics.
- **License**: Apache-2.0 on `opencap-core` itself.
- **Commercial usability**: **Disqualifying issue.** `opencap-core`'s default and only documented pose backend is **OpenPose** (CMU Perceptual Computing Lab), which is licensed non-commercial-research-only; CMU's paid commercial tier (~$25k/yr) **explicitly excludes use "in the field of Sports."** The Apache-2.0 wrapper does not launder this restriction on the underlying model it calls. **Do not adopt OpenCap's default pipeline for this product.**
- **Reuse**:
  - `opencap-processing/ActivityAnalyses/gait_analysis.py` — `detect_gait_peaks()`/`segment_walking()`: projects ankle/toe positions onto a walking-direction heading vector, finds heel-strike/toe-off via `scipy.find_peaks()` with adaptive prominence, then validates against the canonical stride sequence with `detect_correct_order()`. **This technique (project → peak-find → validate order) is the best available precedent for our sport-agnostic phase detector** — reusable as a *pattern*, needs reimplementation against 2D keypoints instead of 3D OpenSim markers. Verify `opencap-processing`'s own license file (separate repo from `opencap-core`) before lifting any literal code.
  - General system-design lessons only: cloud video-upload/processing/results pattern (`opencap-api`).
- **Do not reuse**: The OpenPose backend (license). The OpenSim + CUDA + TensorFlow + Anaconda desktop-research toolchain. The ≥2-phone capture assumption. The iOS app (not open-sourced).
- **Maintenance**: Most actively multi-maintained of the three (Stanford NMBL lab, multiple contributors, commits within days), but also the highest open-issue count (45) — more user-facing complexity.
- **Integration difficulty**: **High**, and legally blocked as a whole pipeline. Treat as reference architecture + one reusable algorithm pattern only.

### sports-video-analysis ("FormCheck") — `divyakarnani/sports-video-analysis`
- **What it is**: A Next.js + FastAPI + MediaPipe + OpenCV + GPT prototype comparing a user's technique (tennis/skating/dance) against a professional's: normalized pose vectors → hand-rolled DTW → resampled alignment pairs → ghost-overlay rendering with per-joint color-coded status.
- **License**: **None** (no LICENSE file; default all-rights-reserved). Cannot be reused as code without contacting the author.
- **Maintenance**: Solo, ~2-week burst of 17 commits, 0 stars/forks, no activity since. A finished course/hackathon project, not an ongoing OSS project.
- **Reuse**: **Reference only.** It validates that our target stack (Next.js/FastAPI/MediaPipe/DTW) is a workable shape for this product, and its overall pipeline sequencing (normalize → DTW → resample → overlay) is sound. Its DTW is unconstrained (no Sakoe-Chiba band) and its "alignment" is a lossy resample of the true warping path — we should do this better, not copy it.
- **Do not reuse**: Any literal code (no license to permit it).
- **Integration difficulty**: N/A (not a dependency, a precedent).

## Alignment & Analysis Libraries

| Library | License | Maintenance | Verdict |
|---|---|---|---|
| `dtaidistance` | Apache-2.0 | Active | **Reuse.** Recommended DTW implementation — native multivariate support, Sakoe-Chiba `window` param, `psi` relaxation for imprecise clip trimming. |
| `tslearn` | BSD-2 | Active | Reuse-eligible alternative; heavier dependency footprint (brings clustering/classification we don't need). |
| `fastdtw` | MIT | Stale (~2019) | **Avoid.** Proven both less accurate and not reliably faster than exact DTW at realistic lengths (Wu & Keogh, arXiv:2003.11246). |
| `dtw-python` | **GPL-3.0** | Active | **Avoid** for a commercial/closed-source product — copyleft. |
| `soft-dtw` / `pytorch-softdtw-cuda` | BSD-2 / MIT | Unmaintained / research-grade | **Not applicable.** Differentiability solves a training-loop problem we don't have (offline alignment of two fixed recordings, no gradient descent). |

## Datasets / Taxonomies

| Name | License | Verdict |
|---|---|---|
| FitAQA (`Kelly0510/FitAQA`, HF) | Apache-2.0 (annotations) | **Reuse the taxonomy** (38 form-errors / 6 quality dimensions) as a rubric for our `Finding` schema. Videos not needed for V0. |
| FLEX (fitness AQA dataset) | Not confirmed | Do not use until license is verified. |
| Fitness-AQA (`ParitoshParmar/Fitness-AQA`) | Dataset gated, **non-commercial only** | **Avoid** for a commercial product; approach (pose-contrastive disentangling of camera angle from form) is a citable idea, not usable code/data. |

## Adjacent Single-Video Fitness-Form Tools (found, not central)

| Name | License | Note |
|---|---|---|
| `NgoQuocBao1010/Exercise-Correction` | MIT | Single-video pose classifier (bicep curl/plank/squat/lunge), no DTW/alignment. Usable as MIT-licensed reference for classification-side code only. |
| `huguesvinzant/Motion-Correction` | Not stated | EPFL thesis: GCN + differentiable DTW *loss* to train a motion-corrector model. Unmaintained, unlicensed — reference only, and solves a different problem (generative correction, not before/after visualization). |

## Net Verdict

The largest concrete code-reuse win is **Sports2D's angle/floor/filtering
modules** (BSD-3, low integration difficulty, pose-engine agnostic). Pose2Sim
and OpenCap contribute algorithm *patterns* (triangulation/calibration;
phase-detection-by-peak-finding) worth reimplementing rather than importing,
and OpenCap's default backend must be avoided outright for licensing
reasons. No project provides the DTW-alignment, ghost-overlay, or
sport-agnostic template engine this product needs — those are built new,
informed by the design patterns FormCheck and the phase-based-alignment
literature demonstrate.

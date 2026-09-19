# Data Model

All schemas below are given as TypeScript types (frontend contract) with
notes on the equivalent Python/Pydantic representation for the FastAPI
backend, since `MotionSequence` and its children cross that boundary as
JSON.

## 1. CommonSkeleton — the pose-provider-agnostic frame

Every `PoseProvider` implementation maps its native output into this shape
before anything else in the system sees it.

```typescript
type CommonJointId =
  | 'nose' | 'left_eye' | 'right_eye' | 'left_ear' | 'right_ear'
  | 'left_shoulder' | 'right_shoulder'
  | 'left_elbow' | 'right_elbow'
  | 'left_wrist' | 'right_wrist'
  | 'left_hip' | 'right_hip'
  | 'left_knee' | 'right_knee'
  | 'left_ankle' | 'right_ankle'
  | 'left_heel' | 'right_heel'
  | 'left_foot_index' | 'right_foot_index';
  // superset covering MediaPipe (33), COCO-17, and COCO-133 subsets;
  // a provider with fewer keypoints simply omits the unsupported ids.

interface Landmark2D {
  x: number;              // normalized [0,1] image-space
  y: number;
  confidence: number;     // [0,1], provider's own visibility/score
}

interface Landmark3D extends Landmark2D {
  z: number;               // provider-relative depth; undefined if 2D-only provider
}

interface CommonSkeletonFrame {
  frameIndex: number;
  timestampMs: number;
  joints: Partial<Record<CommonJointId, Landmark2D | Landmark3D>>;
  has3D: boolean;
}
```

## 2. MotionSequence — the core analysis object

```typescript
interface MotionSequence {
  id: string;
  sourceVideoRef: string | null;   // StorageProvider ref; null if video deleted post-extraction
  poseProvider: { name: string; version: string; has3D: boolean };
  fps: number;
  duration: number;                 // seconds
  frameCount: number;

  landmarks: CommonSkeletonFrame[]; // raw-to-normalized per-frame joints
  jointAngles: JointAngleFrame[];
  segmentAngles: SegmentAngleFrame[];
  velocities: JointVelocityFrame[];
  accelerations: JointAccelerationFrame[] | null; // null where signal too noisy to trust (see confidence)

  bodyCenter: Point2D[];      // per frame
  hipCenter: Point2D[];
  shoulderCenter: Point2D[];
  torsoAngle: number[];        // per frame, degrees
  movementDirection: 'left' | 'right' | 'toward_camera' | 'away_from_camera' | 'unknown';

  phases: DetectedPhase[];     // populated after MotionTemplate segmentation runs
  confidence: number[];        // per-frame overall confidence, propagated from provider

  normalization: {
    anchor: 'hip' | 'torso' | 'foot' | string; // custom anchor id
    scaleReference: 'shoulder_hip_distance' | string;
    scaleValuePx: number;      // the measured reference distance used to normalize
  };
}

interface JointAngleFrame {
  frameIndex: number;
  angles: Partial<Record<string, number>>; // e.g. "left_knee_flexion": 103.4 (degrees)
}

interface SegmentAngleFrame {
  frameIndex: number;
  angles: Partial<Record<string, number>>; // e.g. "torso": 14.2 (degrees from vertical)
}

interface JointVelocityFrame {
  frameIndex: number;
  velocities: Partial<Record<CommonJointId, { vx: number; vy: number; speed: number }>>;
}

interface JointAccelerationFrame {
  frameIndex: number;
  accelerations: Partial<Record<CommonJointId, { ax: number; ay: number }>>;
}

interface Point2D { x: number; y: number; }
```

Notes:
- `accelerations` is nullable per-sequence (not just per-value) because
  second-derivative signals are frequently too noisy to trust at consumer
  webcam framerates; the analysis layer must handle its absence rather than
  assuming it's always populated.
- `confidence` is a single rollup per frame (e.g. mean of tracked-joint
  confidences) used for coarse filtering (e.g. discard low-confidence
  frames from phase detection); per-joint confidence remains available
  inside `landmarks[i].joints[...].confidence` for fine-grained use.

## 3. MotionTemplate — sport configuration (data, not code)

```typescript
interface MotionTemplate {
  sportId: string;             // "squat", "basketball_shot", "golf_swing", ...
  displayName: string;
  cameraGuidance: {
    angle: string;              // human-readable recording guidance
    distance: string;
    orientation: 'side' | 'front' | 'front_side' | '45_degree';
  };
  phases: PhaseDefinition[];    // ordered
  keyJoints: CommonJointId[];
  relevantAngles: string[];     // keys into JointAngleFrame.angles / SegmentAngleFrame.angles
  temporalRelationships: {
    // e.g. { before: "load", after: "release", maxGapMs: 800 }
    before: string; after: string; maxGapMs?: number; minGapMs?: number;
  }[];
  evaluationRuleIds: string[];  // references into the sport's rules.json
  visualization?: {
    anchor?: 'hip' | 'torso' | 'foot' | string;
    rotationNormalization?: boolean;
    trailJoints?: CommonJointId[];
  };
}

interface PhaseDefinition {
  name: string;                 // e.g. "backswing"
  primarySignal: string;        // which computed signal drives detection,
                                 // e.g. "segment_angle.torso" or "landmark.right_wrist.y"
  entryCondition: SignalCondition;
  exitCondition: SignalCondition;
}

type SignalCondition =
  | { type: 'local_max' | 'local_min' }
  | { type: 'threshold_crossed'; direction: 'above' | 'below'; value: number }
  | { type: 'velocity_sign_change' };
```

## 4. DetectedPhase — output of phase detection

```typescript
interface DetectedPhase {
  name: string;                 // matches PhaseDefinition.name
  startFrame: number;
  endFrame: number;
  confidence: number;           // how well the detected boundary matched the condition
}
```

## 5. Finding — output of the rule engine

```typescript
interface Finding {
  issueId: string;               // e.g. "excessive_forward_lean" — drawn from the
                                  // FitAQA-derived taxonomy (research.md §4), namespaced
                                  // by quality dimension, e.g. "alignment.excessive_forward_lean"
  qualityDimension:
    | 'alignment' | 'symmetry' | 'stability'
    | 'coordination' | 'tempo' | 'completeness';
  phase: string;                 // matches a DetectedPhase.name
  confidence: number;            // [0,1]
  measuredValue: number;
  baselineValue: number;
  unit: 'degrees' | 'seconds' | 'ratio' | 'normalized_distance';
  severity: 'mild' | 'moderate' | 'severe';
  baselineSource: 'template_default' | 'biomechanical_rule' | 'user_baseline' | 'user_history';
}
```

## 6. Correction — output of the correction engine

```typescript
interface Correction {
  findingId: string;             // Finding.issueId + phase, to trace back
  what: string;
  when: string;                  // phase name, human-readable
  why: string;
  whatToChange: string;
  cue: string;                   // one short coaching cue
  drill: string;                 // one correction drill
}
```

## 7. AlignmentMap — output of temporal alignment

```typescript
interface AlignmentMap {
  beforeSequenceId: string;
  afterSequenceId: string;
  // alignment_map[beforeFrame] = afterFrame, per spec naming
  frameMap: Record<number, number>;
  phaseAlignment: {
    phaseName: string;
    beforeRange: [number, number];
    afterRange: [number, number];
  }[];
  method: 'dtw_windowed_phase_seeded';
  params: { sakoeChibaRadius: number; featureSpace: 'joint_angles' };
}
```

## 8. Comparison / Result — assembled for the result screen

```typescript
interface MotionComparison {
  before: MotionSequence;
  after: MotionSequence;
  alignment: AlignmentMap;
  primaryFinding: Finding;        // from `before`'s analysis
  correction: Correction;
  deltas: {
    metric: string;               // e.g. "torso_lean_at_release"
    phase: string;
    beforeValue: number;
    afterValue: number;
    unit: Finding['unit'];
  }[];
  trailComparisons: {
    joint: CommonJointId;
    phase: string;
    beforePath: Point2D[];
    afterPath: Point2D[];
  }[];
}
```

## 9. Baseline / Personal Motion Signature (schema only — not populated in V0)

```typescript
interface MotionSignature {
  userId: string;
  sportId: string;
  sampleCount: number;
  // per relevantAngle/phase, running summary statistics from the user's
  // own successful past attempts (as judged by prior Finding severity)
  metricSummaries: Record<string /* "phase.angleKey" */, {
    mean: number; stdDev: number; lastUpdated: string /* ISO date */;
  }>;
}
```

## 10. Cross-boundary notes

- All JSON crossing the Next.js ↔ FastAPI boundary uses these shapes
  directly (camelCase preserved both sides; FastAPI/Pydantic models mirror
  them field-for-field to avoid a translation layer).
- `MotionSequence`, `Finding`, `Correction`, and `AlignmentMap` are the only
  objects persisted; raw video is referenced by `sourceVideoRef` and may be
  null once deleted (Privacy, `architecture.md` §6).

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MetricId, ShotMetrics } from '../types/metrics';
import type { PoseTrack } from '../types/pose';
import type { Shot } from '../types/shot';

/**
 * IndexedDB：只存骨架與指標 JSON，不存原始影片。
 * 資料模型：Session → Shot → Phase → Metrics；另有 Finding 與 Experiment。
 * sessions 存 PoseTrack；shots 存每球的事件/階段與指標（供個人基準）；findings / experiments 於步驟 6 補齊。
 */
export interface SessionRecord {
  id: string;
  name: string;
  createdAt: string;
  track: PoseTrack;
}

export interface ShotRecord {
  id: string;
  sessionId: string;
  index: number;
  createdAt: string;
  /** 事件與階段（ProcessedTrack 索引）。 */
  shot: Shot;
  metrics: ShotMetrics;
}

/** Finding：某個 Session 觸發的規則與當時的數值。 */
export interface FindingRecord {
  id: string;
  sessionId: string;
  ruleId: string;
  metric: MetricId;
  createdAt: string;
  values: { current: number | null; n: number; baseline: number | null; diff: number | null; z: number | null; cv: number | null };
}

/** Experiment：使用者決定嘗試的 Cue，與之後的 Retest 結果。 */
export interface ExperimentRecord {
  id: string;
  ruleId: string;
  metric: MetricId;
  cue: string;
  drill: string;
  target: string;
  startedAt: string;
  /** 開始實驗時該指標的本次平均。 */
  startValue: number | null;
  startSessionId: string | null;
  retest: { sessionId: string | null; recordedAt: string; value: number; delta: number | null } | null;
}

interface MotionLabDB extends DBSchema {
  sessions: { key: string; value: SessionRecord; indexes: { byCreatedAt: string } };
  shots: { key: string; value: ShotRecord; indexes: { bySession: string } };
  findings: { key: string; value: FindingRecord; indexes: { bySession: string } };
  experiments: { key: string; value: ExperimentRecord; indexes: { byStartedAt: string } };
}

const DB_NAME = 'motion-lab';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MotionLabDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<MotionLabDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('byCreatedAt', 'createdAt');
        const shots = db.createObjectStore('shots', { keyPath: 'id' });
        shots.createIndex('bySession', 'sessionId');
        const findings = db.createObjectStore('findings', { keyPath: 'id' });
        findings.createIndex('bySession', 'sessionId');
        const experiments = db.createObjectStore('experiments', { keyPath: 'id' });
        experiments.createIndex('byStartedAt', 'startedAt');
      },
    });
  }
  return dbPromise;
}

export function newId(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
  return `${prefix}_${rnd}`;
}

export async function saveSession(
  name: string,
  track: PoseTrack,
  shots: Array<{ shot: Shot; metrics: ShotMetrics }> = [],
  findings: Array<Omit<FindingRecord, 'id' | 'sessionId' | 'createdAt'>> = [],
): Promise<SessionRecord> {
  const db = await getDB();
  const createdAt = new Date().toISOString();
  const record: SessionRecord = { id: newId('sess'), name, createdAt, track };
  const tx = db.transaction(['sessions', 'shots', 'findings'], 'readwrite');
  await tx.objectStore('sessions').put(record);
  for (const s of shots) {
    await tx.objectStore('shots').put({ id: newId('shot'), sessionId: record.id, index: s.shot.index, createdAt, shot: s.shot, metrics: s.metrics });
  }
  for (const f of findings) {
    await tx.objectStore('findings').put({ id: newId('find'), sessionId: record.id, createdAt, ...f });
  }
  await tx.done;
  return record;
}

export async function listExperiments(): Promise<ExperimentRecord[]> {
  const db = await getDB();
  return (await db.getAllFromIndex('experiments', 'byStartedAt')).reverse();
}

export async function startExperiment(e: Omit<ExperimentRecord, 'id' | 'startedAt' | 'retest'>): Promise<ExperimentRecord> {
  const db = await getDB();
  const rec: ExperimentRecord = { ...e, id: newId('exp'), startedAt: new Date().toISOString(), retest: null };
  await db.put('experiments', rec);
  return rec;
}

export async function recordRetest(id: string, value: number, sessionId: string | null): Promise<ExperimentRecord | undefined> {
  const db = await getDB();
  const rec = await db.get('experiments', id);
  if (!rec) return undefined;
  rec.retest = { sessionId, recordedAt: new Date().toISOString(), value, delta: rec.startValue === null ? null : value - rec.startValue };
  await db.put('experiments', rec);
  return rec;
}

/** 所有已儲存的球（供個人基準）。 */
export async function listAllShots(): Promise<ShotRecord[]> {
  const db = await getDB();
  return db.getAll('shots');
}

export async function listShotsOfSession(sessionId: string): Promise<ShotRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('shots', 'bySession', sessionId);
}

export async function listSessions(): Promise<Array<Omit<SessionRecord, 'track'> & { frameCount: number; fileName: string }>> {
  const db = await getDB();
  const all = await db.getAllFromIndex('sessions', 'byCreatedAt');
  return all
    .reverse()
    .map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, frameCount: s.track.frameCount, fileName: s.track.video.fileName }));
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  const db = await getDB();
  return db.get('sessions', id);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['sessions', 'shots', 'findings'], 'readwrite');
  await tx.objectStore('sessions').delete(id);
  for (const key of await tx.objectStore('shots').index('bySession').getAllKeys(id)) await tx.objectStore('shots').delete(key);
  for (const key of await tx.objectStore('findings').index('bySession').getAllKeys(id)) await tx.objectStore('findings').delete(key);
  await tx.done;
}

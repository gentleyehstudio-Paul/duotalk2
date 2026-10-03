import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PoseTrack } from '../types/pose';

/**
 * IndexedDB：只存骨架與指標 JSON，不存原始影片。
 * 資料模型：Session → Shot → Phase → Metrics；另有 Finding 與 Experiment。
 * 步驟 1 先建立 sessions（含 PoseTrack）；shots / findings / experiments 的欄位會在後續步驟補齊。
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
  startFrame: number;
  endFrame: number;
}

export interface FindingRecord {
  id: string;
  sessionId: string;
  ruleId: string;
  createdAt: string;
  payload: unknown;
}

export interface ExperimentRecord {
  id: string;
  cue: string;
  startedAt: string;
  retest?: unknown;
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

export async function saveSession(name: string, track: PoseTrack): Promise<SessionRecord> {
  const db = await getDB();
  const record: SessionRecord = { id: newId('sess'), name, createdAt: new Date().toISOString(), track };
  await db.put('sessions', record);
  return record;
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
  await db.delete('sessions', id);
}

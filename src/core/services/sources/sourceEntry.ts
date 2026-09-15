import type { SourceCallDiagnostic } from './diagnostics';
import { declarationPlatform } from './platformMap';
import type { LxUpdateAlert } from './protocol';
import type { MusicSourceRecord } from './store';
import type { SourceUpdateState } from './sourceUpdates';
import type { SandboxSnapshot, SandboxStatus } from './workerHost';

export interface MusicSourcePlatform {
  appPlatform: string;
  lxPlatform: string;
  actions: string[];
  qualitys?: string[];
}

export interface MusicSourceEntry {
  record: MusicSourceRecord;
  status: SandboxStatus;
  error: string;
  platforms: MusicSourcePlatform[];
  updateAlert: LxUpdateAlert | null;
  hosts: string[];
  logs: string[];
  calls: SourceCallDiagnostic[];
  update: SourceUpdateState | null;
}

export const buildSourceEntry = (
  record: MusicSourceRecord,
  snapshot?: SandboxSnapshot,
  startError?: string,
  update: SourceUpdateState | null = null,
): MusicSourceEntry => ({
  record,
  status: startError ? 'failed' : snapshot?.status ?? 'idle',
  error: startError ?? snapshot?.error ?? '',
  platforms: Object.entries(snapshot?.sources ?? {}).flatMap(([lxPlatform, declaration]) => {
    const mapped = declarationPlatform(lxPlatform, declaration);
    return mapped ? [{ ...mapped, lxPlatform }] : [];
  }),
  updateAlert: snapshot?.updateAlert ?? null,
  hosts: snapshot?.hosts ?? [],
  logs: snapshot?.logs ?? [],
  calls: snapshot?.calls ?? [],
  update,
});

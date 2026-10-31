import { MD_MAX_ATOMS, MD_MAX_COORDINATES, type MdParseResult } from './md-parser.ts';
import type { MdAnalysis, MdFrame } from './md-types.ts';
import type { MdCloudSignableArtifactPath } from './md-cloud-api.ts';

export type MdCloudTimelineFrame = {
  frame: number;
  artifact: MdCloudSignableArtifactPath;
  artifactIndex: number | null;
};

type MdCloudFramePacket = {
  version: 1;
  analysisId: string;
  result: MdAnalysis;
};

const finiteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

function finiteNumbers(value: unknown, expectedLength?: number): value is number[] {
  return Array.isArray(value)
    && (expectedLength === undefined || value.length === expectedLength)
    && value.every(finiteNumber);
}

function validateFrame(value: unknown, expectedFrame: number): MdFrame {
  if (!value || typeof value !== 'object') throw new Error('Personal compute returned an invalid trajectory frame.');
  const frame = value as Partial<MdFrame>;
  if (!Number.isInteger(frame.index) || frame.index !== expectedFrame) {
    throw new Error('Personal compute returned trajectory frames out of order.');
  }
  if (!Array.isArray(frame.ids) || !Array.isArray(frame.species) || frame.ids.length !== frame.species.length) {
    throw new Error('Personal compute returned inconsistent particle identities.');
  }
  if (frame.ids.length < 1 || frame.ids.length > MD_MAX_ATOMS) {
    throw new Error(`A trajectory frame must contain 1–${MD_MAX_ATOMS.toLocaleString('en-US')} atoms.`);
  }
  if (!frame.ids.every((id) => typeof id === 'string' && id.length > 0)
    || new Set(frame.ids).size !== frame.ids.length
    || !frame.species.every((species) => typeof species === 'string' && species.length > 0)) {
    throw new Error('Personal compute returned invalid particle identifiers.');
  }
  if (!finiteNumbers(frame.positions, frame.ids.length * 3)) {
    throw new Error('Personal compute returned invalid particle coordinates.');
  }
  if (!Array.isArray(frame.vectors) || frame.vectors.length !== 3
    || !frame.vectors.every((row) => finiteNumbers(row, 3))
    || !finiteNumbers(frame.origin, 3)
    || !Array.isArray(frame.periodic) || frame.periodic.length !== 3
    || !frame.periodic.every((flag) => typeof flag === 'boolean')
    || typeof frame.hasCell !== 'boolean') {
    throw new Error('Personal compute returned an invalid simulation cell.');
  }
  if (frame.timestep !== null && !finiteNumber(frame.timestep)) {
    throw new Error('Personal compute returned an invalid timestep.');
  }
  if (frame.time !== null && !finiteNumber(frame.time)) {
    throw new Error('Personal compute returned an invalid frame time.');
  }
  if (!frame.properties || typeof frame.properties !== 'object' || Array.isArray(frame.properties)) {
    throw new Error('Personal compute returned invalid particle properties.');
  }
  for (const values of Object.values(frame.properties)) {
    if (!finiteNumbers(values, frame.ids.length)) {
      throw new Error('Personal compute returned an invalid per-particle property.');
    }
  }
  if (frame.stringProperties !== undefined && (!frame.stringProperties || typeof frame.stringProperties !== 'object' || Array.isArray(frame.stringProperties) || Object.values(frame.stringProperties).some(values => !Array.isArray(values) || values.length !== frame.ids!.length || values.some(value => typeof value !== 'string')))) {
    throw new Error('Personal compute returned invalid string particle properties.');
  }
  return frame as MdFrame;
}

function readCloudPacket(value: unknown, expectedFrame: number) {
  if (!value || typeof value !== 'object') throw new Error('Personal compute returned an invalid trajectory packet.');
  const packet = value as Partial<MdCloudFramePacket>;
  if (packet.version !== 1 || typeof packet.analysisId !== 'string' || !packet.result || typeof packet.result !== 'object') {
    throw new Error('Personal compute returned an incompatible trajectory packet.');
  }
  const frame = validateFrame(packet.result.frame, expectedFrame);
  const warnings = Array.isArray(packet.result.warnings)
    ? packet.result.warnings.filter((warning): warning is string => typeof warning === 'string' && Boolean(warning.trim())).map((warning) => warning.trim())
    : [];
  return { frame, warnings };
}

export function mdCloudTimelineFrames(value: unknown): MdCloudTimelineFrame[] {
  if (!value || typeof value !== 'object') throw new Error('Personal compute returned an invalid trajectory index.');
  const rawFrames = (value as { frames?: unknown }).frames;
  if (!Array.isArray(rawFrames) || rawFrames.length < 1 || rawFrames.length > 10_000) {
    throw new Error('Personal compute returned an invalid trajectory frame count.');
  }
  return rawFrames.map((raw, position) => {
    if (!raw || typeof raw !== 'object') throw new Error('Personal compute returned an invalid trajectory index.');
    const item = raw as { frame?: unknown; frameArtifact?: unknown; frameShardArtifact?: unknown; frameShardIndex?: unknown };
    if (!Number.isInteger(item.frame) || item.frame !== position) {
      throw new Error('Personal compute returned a non-contiguous trajectory index.');
    }
    const legacyArtifact = typeof item.frameArtifact === 'string' && /^frames\/[0-9]{6}\.json\.gz$/.test(item.frameArtifact)
      ? item.frameArtifact as MdCloudSignableArtifactPath
      : null;
    const shardArtifact = typeof item.frameShardArtifact === 'string' && /^frames\/[0-9]{6}-[0-9]{6}\.json\.gz$/.test(item.frameShardArtifact)
      ? item.frameShardArtifact as MdCloudSignableArtifactPath
      : null;
    const shardIndex = item.frameShardIndex;
    if ((!legacyArtifact && !shardArtifact)
      || (legacyArtifact && shardArtifact)
      || (shardArtifact && (!Number.isInteger(shardIndex) || Number(shardIndex) < 0 || Number(shardIndex) >= 64))) {
      throw new Error('Personal compute returned an unsafe trajectory artifact path.');
    }
    return { frame: item.frame, artifact: legacyArtifact ?? shardArtifact!, artifactIndex: shardArtifact ? Number(shardIndex) : null };
  });
}

export function mdCloudPacketFromArtifact(value: unknown, timelineFrame: MdCloudTimelineFrame): unknown {
  if (timelineFrame.artifactIndex === null) return value;
  if (!value || typeof value !== 'object') throw new Error('Personal compute returned an invalid trajectory shard.');
  const shard = value as { version?: unknown; analysisId?: unknown; frames?: unknown };
  if (shard.version !== 1 || typeof shard.analysisId !== 'string' || !Array.isArray(shard.frames)) {
    throw new Error('Personal compute returned an incompatible trajectory shard.');
  }
  const packet = shard.frames[timelineFrame.artifactIndex];
  if (!packet) throw new Error('Personal compute returned an incomplete trajectory shard.');
  return packet;
}

export function mdParseResultFromCloudPackets(
  name: string,
  timeline: MdCloudTimelineFrame[],
  packets: unknown[],
): MdParseResult {
  if (timeline.length !== packets.length) throw new Error('Personal compute returned an incomplete trajectory.');
  const collector = createMdCloudTrajectoryCollector(name, timeline);
  packets.forEach((packet, position) => collector.append(packet, position));
  return collector.finish();
}

export function createMdCloudTrajectoryCollector(name: string, timeline: MdCloudTimelineFrame[]) {
  let coordinates = 0;
  const warnings = new Set<string>();
  const frames: MdFrame[] = [];
  return {
    append(packet: unknown, position: number) {
      if (position !== frames.length || position >= timeline.length) {
        throw new Error('Personal compute returned trajectory frames out of order.');
      }
      const decoded = readCloudPacket(packet, timeline[position].frame);
      coordinates += decoded.frame.positions.length;
      if (coordinates > MD_MAX_COORDINATES) {
        throw new Error('Trajectory exceeds the browser memory limit. Split it into smaller files.');
      }
      decoded.warnings.forEach((warning) => warnings.add(warning));
      frames.push(decoded.frame);
    },
    finish(): MdParseResult {
      if (frames.length !== timeline.length) throw new Error('Personal compute returned an incomplete trajectory.');
      const resultWarnings = [...warnings];
      return {
        frames,
        warnings: resultWarnings,
        index: { format: 'ovito', name, offsets: frames.map((frame) => frame.index), warnings: resultWarnings },
      };
    },
  };
}

export function shouldUsePersonalTrajectoryImport(filename: string, sizeBytes: number) {
  if (sizeBytes > 64 * 1024 * 1024) return true;
  return /\.(?:gz|bz2|xz|zst|dcd|xtc|trr|nc|netcdf|gsd|yaml|yml|bin|data|axsf|xdatcar|h5|hdf5)$/i.test(filename);
}

/** Validate one fetched frame without accumulating the entire trajectory. */
export function mdCloudFrameFromPacket(packet: unknown, index: number): MdFrame {
  return readCloudPacket(packet, index).frame;
}

import { ImportedModelImportMode } from '../domain/types';

export type ModelImportTier = 'standard' | 'heavy' | 'extreme' | 'reject';

export interface ImportDeviceProfile {
  deviceMemoryGb: number;
  isMobile: boolean;
  source: 'navigator' | 'fallback';
  developerOverride?: boolean;
}

export interface ImportGeometryStats {
  loadedVertexCount: number;
  triangleCount: number;
  meshNodeCount: number;
  instanceCount: number;
  expandedInstanceCount: number;
  uniquePositionBytes: number;
  uniqueIndexBytes: number;
  outputPositionBytes: number;
  outputIndexBytes: number;
  mode: ImportedModelImportMode;
  legacyBase64?: boolean;
}

export interface ImportBudgetEstimate extends ImportGeometryStats {
  normalBytes: number;
  transformationBytes: number;
  combinedTemporaryBytes: number;
  packedBytes: number;
  base64Bytes: number;
  gpuBytes: number;
  projectStorageBytes: number;
  estimatedPeakHeapBytes: number;
  safetyBudgetBytes: number;
  tier: ModelImportTier;
  exceeded: string[];
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * Browser tabs cannot use all installed RAM. The per-import heap budget is the
 * smaller of 20% of reported device RAM and the platform cap below. Unknown
 * devices use a conservative 4 GB desktop / 2 GB mobile profile. Tiers consume
 * <=35%, <=65%, and <=100% of that budget. These are byte-derived heuristics,
 * not claims about currently free memory.
 */
export const IMPORT_BUDGET_POLICY = {
  fallbackDesktopGb: 4,
  fallbackMobileGb: 2,
  installedMemoryFraction: 0.20,
  desktopBudgetCapBytes: 1536 * MIB,
  mobileBudgetCapBytes: 384 * MIB,
  standardFraction: 0.35,
  heavyFraction: 0.65,
  maxPackedAssetBytes: 768 * MIB,
  maxProjectAssetBytes: 1024 * MIB,
  maxSourceFileBytes: 1024 * MIB,
  maxTypedArrayBytes: 0x7fffffff,
  maxUint32AddressableVertices: 0xffffffff,
} as const;

export function detectImportDeviceProfile(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): ImportDeviceProfile {
  const candidate = nav as (Navigator & { deviceMemory?: number }) | undefined;
  const reported = candidate?.deviceMemory;
  const isMobile = Boolean(candidate && /Android|iPhone|iPad|iPod|Mobile/i.test(candidate.userAgent));
  return {
    deviceMemoryGb: typeof reported === 'number' && Number.isFinite(reported) && reported > 0
      ? reported
      : isMobile ? IMPORT_BUDGET_POLICY.fallbackMobileGb : IMPORT_BUDGET_POLICY.fallbackDesktopGb,
    isMobile,
    source: typeof reported === 'number' && reported > 0 ? 'navigator' : 'fallback',
  };
}

export function estimateModelImportBudget(stats: ImportGeometryStats, device: ImportDeviceProfile): ImportBudgetEstimate {
  const normalBytes = stats.outputPositionBytes;
  const transformationBytes = stats.outputPositionBytes;
  const combinedTemporaryBytes = stats.mode === 'combined'
    ? stats.outputPositionBytes + stats.outputIndexBytes
    : 0;
  const packedBytes = 40 + stats.outputPositionBytes + stats.outputIndexBytes + normalBytes;
  const base64Bytes = stats.legacyBase64 ? Math.ceil(packedBytes / 3) * 4 : 0;
  const gpuBytes = stats.outputPositionBytes + stats.outputIndexBytes + normalBytes;
  const projectStorageBytes = packedBytes + 1024 + stats.meshNodeCount * 256;
  // Loader-owned unique buffers + transformed output + packed binary + normals
  // + combined output (when applicable). GPU bytes are reported separately.
  const estimatedPeakHeapBytes = stats.uniquePositionBytes + stats.uniqueIndexBytes
    + transformationBytes + combinedTemporaryBytes + packedBytes + base64Bytes;
  const platformCap = device.isMobile
    ? IMPORT_BUDGET_POLICY.mobileBudgetCapBytes
    : IMPORT_BUDGET_POLICY.desktopBudgetCapBytes;
  const safetyBudgetBytes = Math.min(device.deviceMemoryGb * GIB * IMPORT_BUDGET_POLICY.installedMemoryFraction, platformCap);
  const exceeded: string[] = [];
  if (stats.loadedVertexCount > IMPORT_BUDGET_POLICY.maxUint32AddressableVertices) exceeded.push('32-bit index addressing');
  if (stats.outputPositionBytes > IMPORT_BUDGET_POLICY.maxTypedArrayBytes || stats.outputIndexBytes > IMPORT_BUDGET_POLICY.maxTypedArrayBytes) exceeded.push('typed-array size');
  if (packedBytes > IMPORT_BUDGET_POLICY.maxPackedAssetBytes) exceeded.push('packed asset size');
  if (projectStorageBytes > IMPORT_BUDGET_POLICY.maxProjectAssetBytes) exceeded.push('project asset storage size');
  if (estimatedPeakHeapBytes > safetyBudgetBytes) exceeded.push('estimated peak memory');

  let tier: ModelImportTier;
  if (exceeded.length > 0) tier = 'reject';
  else if (estimatedPeakHeapBytes <= safetyBudgetBytes * IMPORT_BUDGET_POLICY.standardFraction) tier = 'standard';
  else if (estimatedPeakHeapBytes <= safetyBudgetBytes * IMPORT_BUDGET_POLICY.heavyFraction) tier = 'heavy';
  else tier = device.isMobile && !device.developerOverride ? 'reject' : 'extreme';

  return { ...stats, normalBytes, transformationBytes, combinedTemporaryBytes, packedBytes, base64Bytes, gpuBytes, projectStorageBytes, estimatedPeakHeapBytes, safetyBudgetBytes, tier, exceeded };
}

export function formatImportBytes(bytes: number): string {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GB`;
  return `${(bytes / MIB).toFixed(1)} MB`;
}

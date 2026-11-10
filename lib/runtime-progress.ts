export type RuntimeInstallProgress = {
  state?: string;
  phase?: string;
  component?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
};

/** Byte counts measure downloads; they never measure package extraction. */
export function runtimeProgressDisplay(progress: RuntimeInstallProgress) {
  return {
    stage: progress.state === 'installing' && progress.phase === 'unpacking' ? 'unpacking' : progress.state,
    downloadPercent: progress.state === 'downloading' && progress.totalBytes && progress.totalBytes > 0 && progress.downloadedBytes !== undefined
      ? Math.min(100, Math.max(0, progress.downloadedBytes / progress.totalBytes * 100)).toFixed(0)
      : undefined,
  };
}

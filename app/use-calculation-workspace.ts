"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ensureCalculationWorkspaceMetadata,
  getCalculationWorkspaceSnapshot,
  getServerCalculationWorkspaceSnapshot,
  subscribeToCalculationWorkspace,
  summarizeCalculationWorkspace,
} from "@/lib/workspace-storage";

export function useCalculationWorkspace() {
  useEffect(() => {
    ensureCalculationWorkspaceMetadata();
  }, []);

  const rawSnapshot = useSyncExternalStore(
    subscribeToCalculationWorkspace,
    getCalculationWorkspaceSnapshot,
    getServerCalculationWorkspaceSnapshot,
  );

  return useMemo(
    () => summarizeCalculationWorkspace(rawSnapshot),
    [rawSnapshot],
  );
}

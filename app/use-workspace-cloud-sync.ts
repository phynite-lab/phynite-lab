"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import {
  getCalculationWorkspaceSnapshot,
  parseCalculationWorkspaceSnapshot,
  replaceCalculationWorkspaceSnapshot,
  subscribeToCalculationWorkspace,
  type StoredWorkspaceSnapshot,
} from "@/lib/workspace-storage";

export type WorkspaceCloudStatus = "idle" | "syncing" | "synced" | "error";
export type WorkspaceCloudState = { status: WorkspaceCloudStatus; sizeBytes: number; lastSyncedAt: string; ready: boolean; flush: () => Promise<void> };
export const WorkspaceCloudSyncContext = createContext<{ owner: string; state: WorkspaceCloudState } | null>(null);
const WORKSPACE_OWNER_KEY = "phynite:calculation-workspace-owner:v1";

type WorkspaceResponse = {
  workspace: StoredWorkspaceSnapshot | null;
  revision: number;
  updatedAt?: string;
  sizeBytes?: number;
  resetAt?: string;
};

function snapshotTime(snapshot: StoredWorkspaceSnapshot | null, fallback = "") {
  const parsed = Date.parse(snapshot?.savedAt || fallback);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resetWorkspace(resetAt: string): StoredWorkspaceSnapshot {
  return { version: 1, projects: [], materials: [], jobs: [], calculationComponents: [], savedAt: resetAt };
}

function shouldResetLocal(remote: WorkspaceResponse, local: StoredWorkspaceSnapshot | null) {
  const resetTime = Date.parse(remote.resetAt ?? "");
  return !remote.workspace && Boolean(local) && Number.isFinite(resetTime) && snapshotTime(local) <= resetTime;
}

async function fetchWorkspace() {
  const response = await fetch("/api/phynite/v1/workspace", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Workspace load failed with ${response.status}`);
  return response.json() as Promise<WorkspaceResponse>;
}

async function saveWorkspace(workspace: StoredWorkspaceSnapshot, baseRevision: number) {
  const response = await fetch("/api/phynite/v1/workspace", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, baseRevision }),
  });
  const payload = await response.json().catch(() => ({})) as WorkspaceResponse & { code?: string };
  if (!response.ok) {
    const error = new Error(`Workspace save failed with ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function useWorkspaceCloudSync(userId?: string, readOnly = false) {
  const context = useContext(WorkspaceCloudSyncContext);
  const shared = context && context.owner === userId ? context.state : null;
  const [status, setStatus] = useState<WorkspaceCloudStatus>(userId ? "syncing" : "idle");
  const [sizeBytes, setSizeBytes] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [initializedOwner, setInitializedOwner] = useState("");
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const flush = useCallback(() => flushRef.current(), []);

  useEffect(() => {
    if (shared) return;
    if (readOnly) return;
    if (!userId) {
      flushRef.current = async () => undefined;
      return;
    }

    let disposed = false;
    let applyingRemote = false;
    let revision = 0;
    let timer = 0;
    let unsubscribe: () => void = () => undefined;
    let uploadInFlight: Promise<void> | null = null;
    let uploadAgain = false;
    let lastUploadError: unknown = null;
    let revisionConflict = false;

    const performUpload = async () => {
      // A remote AI action may have changed saved research while this editor was dirty.
      // Freeze uploads until the user explicitly loads the saved workspace; never pick a winner by wall clock.
      if (revisionConflict) { lastUploadError = new Error('The saved workspace changed. Preserve a local copy and reload before saving.'); setStatus('error'); return; }
      lastUploadError = null;
      const local = parseCalculationWorkspaceSnapshot(getCalculationWorkspaceSnapshot());
      if (disposed) return;
      if (!local) {
        setStatus("synced");
        return;
      }
      setStatus("syncing");
      try {
        const saved = await saveWorkspace(local, revision);
        if (disposed) return;
        revision = saved.revision;
        window.localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
        setSizeBytes(saved.sizeBytes || 0);
        if (!disposed) {
          setLastSyncedAt(saved.updatedAt || local.savedAt || new Date().toISOString());
          setStatus("synced");
        }
      } catch (error) {
        let failure: unknown = error;
        if ((error as Error & { status?: number }).status === 409) {
          try {
            const remote = await fetchWorkspace();
            const current = parseCalculationWorkspaceSnapshot(getCalculationWorkspaceSnapshot());
            if (shouldResetLocal(remote, current)) {
              applyingRemote = true;
              try { replaceCalculationWorkspaceSnapshot(resetWorkspace(remote.resetAt!)); }
              finally { applyingRemote = false; }
              window.localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
              setSizeBytes(0);
              setLastSyncedAt(remote.resetAt!);
              setStatus("synced");
              revision = remote.revision;
              return;
            }
            revisionConflict = true;
            window.dispatchEvent(new CustomEvent('phynite:workspace-revision-conflict'));
          } catch (conflictError) {
            failure = conflictError;
          }
        }
        lastUploadError = failure;
        if (!disposed) setStatus("error");
      }
    };

    const uploadCurrent = () => {
      if (uploadInFlight) {
        uploadAgain = true;
        return uploadInFlight;
      }
      uploadInFlight = (async () => {
        do {
          uploadAgain = false;
          await performUpload();
        } while (uploadAgain && !disposed);
      })().finally(() => {
        uploadInFlight = null;
      });
      return uploadInFlight;
    };

    flushRef.current = async () => {
      window.clearTimeout(timer);
      await uploadCurrent();
      if (lastUploadError) throw lastUploadError;
    };

    const initialize = async () => {
      setStatus("syncing");
      try {
        const remote = await fetchWorkspace();
        if (disposed) return;
        revision = remote.revision;
        setSizeBytes(remote.sizeBytes || 0);
        setLastSyncedAt(remote.updatedAt || remote.workspace?.savedAt || "");
        const localOwner = window.localStorage.getItem(WORKSPACE_OWNER_KEY);
        const belongsToAnotherUser = Boolean(localOwner && localOwner !== userId);
        let local = belongsToAnotherUser
          ? null
          : parseCalculationWorkspaceSnapshot(getCalculationWorkspaceSnapshot());
        const resetApplied = shouldResetLocal(remote, local);
        if (resetApplied) {
          local = resetWorkspace(remote.resetAt!);
          applyingRemote = true;
          try { replaceCalculationWorkspaceSnapshot(local); }
          finally { applyingRemote = false; }
          window.localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
          setLastSyncedAt(remote.resetAt!);
          setStatus("synced");
        }
        if (!resetApplied && belongsToAnotherUser && !remote.workspace) {
          local = {
            version: 1,
            projects: [],
            materials: [],
            jobs: [],
            calculationComponents: [],
            savedAt: new Date().toISOString(),
          };
          applyingRemote = true;
          replaceCalculationWorkspaceSnapshot(local);
          applyingRemote = false;
        }
        if (resetApplied) {
          window.localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
          setStatus("synced");
        } else if (remote.workspace && (!local || snapshotTime(remote.workspace, remote.updatedAt) >= snapshotTime(local))) {
          applyingRemote = true;
          replaceCalculationWorkspaceSnapshot(remote.workspace);
          applyingRemote = false;
          window.localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
          setStatus("synced");
        } else if (local) {
          await uploadCurrent();
        } else {
          window.localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
          setStatus("synced");
        }

        unsubscribe = subscribeToCalculationWorkspace(() => {
          if (applyingRemote || disposed) return;
          setStatus("syncing");
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void uploadCurrent(), 1100);
        });
        if (!disposed) setInitializedOwner(userId);
      } catch {
        if (!disposed) setStatus("error");
      }
    };

    void initialize();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unsubscribe();
      flushRef.current = async () => undefined;
    };
  }, [userId, shared, readOnly]);

  return shared ?? { status: readOnly ? 'synced' : status, sizeBytes, lastSyncedAt, ready: readOnly ? Boolean(userId) : Boolean(userId && initializedOwner === userId), flush };
}

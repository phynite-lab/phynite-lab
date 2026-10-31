"use client";

import { useEffect } from "react";
import { ProjectCrystalWorkspace } from "@/components/ProjectCrystalWorkspace";
import { useSession } from "../use-session";
import { useWorkspaceCloudSync } from "../use-workspace-cloud-sync";
import { StudioLabOperations } from '../studio-navigation';

export function CalculationExperience() {
  const { session, ready } = useSession();
  const cloudSync = useWorkspaceCloudSync(session?.user.id);

  useEffect(() => {
    if (ready && !session) {
      window.location.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [ready, session]);

  if (!ready || !session) {
    return (
      <main className="workspace-loading">
        <p>{ready ? "Opening sign in" : "Opening DFT Lab"}</p>
      </main>
    );
  }

  return (
    <main className="calculation-shell">
      <ProjectCrystalWorkspace session={session} key={session.user.id} ownerId={session.user.id} cloudSync={cloudSync} />
      <StudioLabOperations session={session} active="calculation" />
    </main>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "./workspace-shell";
import { ResearchAccessGate } from '../research-access-gate';

export const metadata: Metadata = {
  title: "Workspace — Phynite",
  description: "Organize research projects, prepare material calculations, and compose publication figures in Phynite Lab.",
};

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.view === 'projects') {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === 'view' || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
    }
    redirect(`/workspace${query.size ? `?${query}` : ''}`);
  }
  return <ResearchAccessGate><WorkspaceShell /></ResearchAccessGate>;
}

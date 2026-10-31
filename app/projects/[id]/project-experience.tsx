'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';
import { useParams } from 'next/navigation';
import { useSession } from '@/app/use-session';
import { ProjectWorkflowWorkspace } from '@/components/ProjectWorkflowWorkspace';
export function ProjectWorkflowExperience() {
  const params = useParams<{ id: string }>();
  const { session } = useSession();
  return session ? <ProjectWorkflowWorkspace key={`${session.user.id}:${params.id}`} owner={session.user.id} projectId={params.id} session={session} /> : <WorkspaceLoading label="Opening project…" />;
}

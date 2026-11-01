export const personalComputeImage = 'public.ecr.aws/p8i3a1t8/phynite/personal-compute@sha256:2e478dd301384eaa9ea754fcf6630de7fe7ad1ccb114fb5f5c5d8dba3d49a185';

// One line works in PowerShell, macOS Terminal, and Linux shells.
export function personalComputeCommand(apiUrl?: string) {
  const endpoint = apiUrl && /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(apiUrl) ? ` --api-url ${apiUrl}` : '';
  return `docker run -d --name phynite-compute --restart unless-stopped --init --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --cpus 4 --memory 8g --tmpfs /tmp:rw,size=512m -v phynite-compute:/state ${personalComputeImage}${endpoint}`;
}

export const personalComputeLogs = 'docker logs --tail 30 phynite-compute';

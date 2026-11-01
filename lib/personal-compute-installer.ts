import { personalComputeImage } from './personal-compute.ts';

export type PersonalComputePlatform = 'macos' | 'windows' | 'linux';

export type PersonalComputeInstallerFile = {
  name: string;
  content: string;
  executable?: boolean;
};

const dockerDownloadUrl = 'https://docs.docker.com/get-started/get-docker/';

function safeOrigin(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !local)) {
    throw new Error(`${label} must use HTTPS or localhost.`);
  }
  return parsed.origin;
}

export function personalComputeInstallerFilename(platform: PersonalComputePlatform) {
  return `phynite-compute-${platform}.zip`;
}

function unixLauncher(apiUrl: string, websiteUrl: string) {
  return `#!/bin/sh
set -eu

IMAGE='${personalComputeImage}'
NAME='phynite-compute'
VOLUME='phynite-compute'
API_URL='${apiUrl}'
WEBSITE_URL='${websiteUrl}'
DOCKER_URL='${dockerDownloadUrl}'

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 &
  fi
}

finish() {
  printf '\n%s\n' "$1"
  if [ -t 0 ]; then printf 'Press Return to close.'; read -r _answer || true; fi
}

printf '\nPhynite Compute setup\n=====================\n'
if ! command -v docker >/dev/null 2>&1; then
  open_url "$DOCKER_URL"
  finish 'The local compute engine is not installed. Its official download page has been opened.'
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  finish 'Open the local compute engine, wait until it is ready, then open this launcher again.'
  exit 1
fi

printf 'Preparing the verified Phynite runtime...\n'
docker pull "$IMAGE"
desired_image=$(docker image inspect --format '{{.Id}}' "$IMAGE")
existing_image=''
if docker container inspect "$NAME" >/dev/null 2>&1; then
  existing_image=$(docker container inspect --format '{{.Image}}' "$NAME")
fi

if [ -n "$existing_image" ] && [ "$existing_image" != "$desired_image" ]; then
  printf '\nA Phynite Compute update is ready. Finish or cancel active calculations first.\n'
  printf 'Install the update now? [y/N] '
  read -r update_answer || update_answer=''
  case "$update_answer" in
    y|Y|yes|YES)
      docker stop --time 45 "$NAME" >/dev/null
      docker rm "$NAME" >/dev/null
      existing_image=''
      ;;
    *) finish 'Update cancelled. Your existing Phynite Compute service was not changed.'; exit 0 ;;
  esac
fi

if [ -n "$existing_image" ]; then
  if [ "$(docker container inspect --format '{{.State.Running}}' "$NAME")" = 'true' ]; then
    running_logs=$(docker logs --tail 100 "$NAME" 2>&1 || true)
    running_code=$(printf '%s\n' "$running_logs" | sed -n 's/.*Connection code: \\([0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]\\).*/\\1/p' | tail -n 1)
    if [ -n "$running_code" ]; then
      open_url "$WEBSITE_URL/account/computer?pair=$running_code"
    else
      open_url "$WEBSITE_URL/account/computer"
    fi
    finish 'Phynite Compute is already running. The account page has been opened.'
    exit 0
  fi
  docker start "$NAME" >/dev/null
else
  docker run -d --name "$NAME" --restart unless-stopped --init --read-only \
    --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 \
    --cpus 4 --memory 8g --tmpfs /tmp:rw,size=512m \
    -v "$VOLUME:/state" "$IMAGE" --api-url "$API_URL" --website-url "$WEBSITE_URL" >/dev/null
fi

printf 'Connecting this computer...\n'
attempt=0
while [ "$attempt" -lt 60 ]; do
  logs=$(docker logs --tail 100 "$NAME" 2>&1 || true)
  code=$(printf '%s\n' "$logs" | sed -n 's/.*Connection code: \\([0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]\\).*/\\1/p' | tail -n 1)
  if [ -n "$code" ]; then
    open_url "$WEBSITE_URL/account/computer?pair=$code"
    finish 'Approve the connection in the browser. Phynite Compute will continue in the background.'
    exit 0
  fi
  if printf '%s' "$logs" | grep -q 'Pseudopotentials ready'; then
    open_url "$WEBSITE_URL/account/computer"
    finish 'Phynite Compute is ready. The account page has been opened.'
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

open_url "$WEBSITE_URL/account/computer"
finish 'Setup is taking longer than expected. The account page has been opened with recovery guidance.'
exit 1
`;
}

function windowsPowerShell(apiUrl: string, websiteUrl: string) {
  return `$ErrorActionPreference = 'Stop'
$Image = '${personalComputeImage}'
$Name = 'phynite-compute'
$Volume = 'phynite-compute'
$ApiUrl = '${apiUrl}'
$WebsiteUrl = '${websiteUrl}'
$DockerUrl = '${dockerDownloadUrl}'

function Finish-Setup([string]$Message) {
  Write-Host "\`n$Message"
  if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' | Out-Null }
}

try {
  Write-Host "\`nPhynite Compute setup"
  Write-Host '====================='
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Start-Process $DockerUrl
    throw 'The local compute engine is not installed. Its official download page has been opened.'
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Open the local compute engine, wait until it is ready, then open this launcher again.' }

  Write-Host 'Preparing the verified Phynite runtime...'
  docker pull $Image
  if ($LASTEXITCODE -ne 0) { throw 'The verified Phynite runtime could not be downloaded.' }
  $DesiredImage = (docker image inspect --format '{{.Id}}' $Image 2>$null)
  $ExistingImage = (docker container inspect --format '{{.Image}}' $Name 2>$null)

  if ($ExistingImage -and $ExistingImage -ne $DesiredImage) {
    Write-Host "\`nA Phynite Compute update is ready. Finish or cancel active calculations first."
    $Answer = Read-Host 'Install the update now? [y/N]'
    if ($Answer -notmatch '^(y|yes)$') {
      Finish-Setup 'Update cancelled. Your existing Phynite Compute service was not changed.'
      exit 0
    }
    docker stop --time 45 $Name *> $null
    docker rm $Name *> $null
    $ExistingImage = $null
  }

  if ($ExistingImage) {
    $Running = (docker container inspect --format '{{.State.Running}}' $Name 2>$null)
    if ($Running -eq 'true') {
      $RunningLogs = (docker logs --tail 100 $Name 2>&1 | Out-String)
      $RunningMatch = [regex]::Match($RunningLogs, 'Connection code:\\s*([0-9]{4}-[0-9]{4}-[0-9]{4})')
      if ($RunningMatch.Success) {
        Start-Process "$WebsiteUrl/account/computer?pair=$($RunningMatch.Groups[1].Value)"
      } else {
        Start-Process "$WebsiteUrl/account/computer"
      }
      Finish-Setup 'Phynite Compute is already running. The account page has been opened.'
      exit 0
    }
    docker start $Name *> $null
  } else {
    docker run -d --name $Name --restart unless-stopped --init --read-only --cap-drop ALL \`
      --security-opt no-new-privileges --pids-limit 512 --cpus 4 --memory 8g \`
      --tmpfs /tmp:rw,size=512m -v "$($Volume):/state" $Image \`
      --api-url $ApiUrl --website-url $WebsiteUrl *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Phynite Compute could not be started.' }
  }

  Write-Host 'Connecting this computer...'
  for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
    $Logs = (docker logs --tail 100 $Name 2>&1 | Out-String)
    $Match = [regex]::Match($Logs, 'Connection code:\\s*([0-9]{4}-[0-9]{4}-[0-9]{4})')
    if ($Match.Success) {
      Start-Process "$WebsiteUrl/account/computer?pair=$($Match.Groups[1].Value)"
      Finish-Setup 'Approve the connection in the browser. Phynite Compute will continue in the background.'
      exit 0
    }
    if ($Logs -match 'Pseudopotentials ready') {
      Start-Process "$WebsiteUrl/account/computer"
      Finish-Setup 'Phynite Compute is ready. The account page has been opened.'
      exit 0
    }
    Start-Sleep -Seconds 2
  }
  Start-Process "$WebsiteUrl/account/computer"
  throw 'Setup is taking longer than expected. The account page has been opened with recovery guidance.'
} catch {
  Finish-Setup $_.Exception.Message
  exit 1
}
`;
}

const windowsLauncher = `@echo off\r\nsetlocal\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Phynite Compute.ps1"\r\n`;

export function personalComputeInstallerFiles(input: {
  platform: PersonalComputePlatform;
  apiUrl: string;
  websiteUrl: string;
}): PersonalComputeInstallerFile[] {
  const apiUrl = safeOrigin(input.apiUrl, 'Compute endpoint');
  const websiteUrl = safeOrigin(input.websiteUrl, 'Website endpoint');
  const readme = `Phynite Compute\n\nThis launcher prepares the verified Phynite local-compute runtime, starts it safely, and opens the account connection page. Existing calculation data stays in the phynite-compute Docker volume during updates.\n\nOnly approve a computer that you control. Finish active calculations before accepting a runtime update.\n`;
  if (input.platform === 'windows') {
    return [
      { name: 'Open Phynite Compute.cmd', content: windowsLauncher },
      { name: 'Phynite Compute.ps1', content: windowsPowerShell(apiUrl, websiteUrl) },
      { name: 'README.txt', content: `${readme}\nOpen “Open Phynite Compute.cmd” to begin.\n` },
    ];
  }
  const launcherName = input.platform === 'macos' ? 'Open Phynite Compute.command' : 'phynite-compute';
  return [
    { name: launcherName, content: unixLauncher(apiUrl, websiteUrl), executable: true },
    { name: 'README.txt', content: `${readme}\n${input.platform === 'macos' ? 'Double-click “Open Phynite Compute.command” to begin.' : 'Run ./phynite-compute to begin.'}\n` },
  ];
}

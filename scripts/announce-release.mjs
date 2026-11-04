#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const DEFAULT_AVATAR = 'https://avatars.githubusercontent.com/u/245534445?v=4';
const DEFAULT_USERNAME = 'Phynite Lab';
const DEFAULT_REPO = 'phynite-lab/phynite-lab';

export function cleanSummary(body, maxChars = 280) {
  if (!body) return '';
  // Strip out markdown headers
  const stripped = body.replace(/^#+\s+.*$/gm, '').trim();
  const firstPara = stripped.split(/\r?\n\r?\n/)[0].trim();
  if (!firstPara) return '';
  if (firstPara.length <= maxChars) return firstPara;
  const truncated = firstPara.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

export function buildDiscordPayload({
  tagName,
  releaseUrl,
  summary,
  mentionEveryone = true,
  username = DEFAULT_USERNAME,
  avatarUrl = DEFAULT_AVATAR,
}) {
  const lines = [];
  if (mentionEveryone) {
    lines.push('@everyone');
  }
  lines.push(`Phynite Lab ${tagName} has been released!`);
  if (summary) {
    lines.push('', summary);
  }
  lines.push('', releaseUrl);

  const payload = {
    username,
    avatar_url: avatarUrl,
    content: lines.join('\n'),
  };

  if (mentionEveryone) {
    payload.allowed_mentions = { parse: ['everyone'] };
  } else {
    payload.allowed_mentions = { parse: [] };
  }

  return payload;
}

export async function resolveRelease({ tag, repo = DEFAULT_REPO, eventPath = process.env.GITHUB_EVENT_PATH, token = process.env.GITHUB_TOKEN }) {
  if (eventPath) {
    try {
      const event = JSON.parse(readFileSync(eventPath, 'utf8'));
      if (event.release && (!tag || event.release.tag_name === tag)) {
        return event.release;
      }
    } catch {
      // fallback to API if reading event file fails
    }
  }

  const headers = {
    'User-Agent': 'phynite-release-announcer',
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const endpoint = tag
    ? `https://api.github.com/repos/${repo}/releases/tags/${tag}`
    : `https://api.github.com/repos/${repo}/releases/latest`;

  const res = await fetch(endpoint, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch release from GitHub API (${res.status} ${res.statusText})`);
  }
  return await res.json();
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tag' && args[i + 1]) options.tag = args[++i];
    else if (args[i] === '--summary' && args[i + 1]) options.summary = args[++i];
    else if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--no-mention') options.mentionEveryone = false;
    else if (args[i] === '--mention-everyone') options.mentionEveryone = true;
  }
  return options;
}

async function main() {
  const cliArgs = parseCliArgs();
  const tag = cliArgs.tag || process.env.INPUT_TAG || '';
  const customSummary = cliArgs.summary || process.env.INPUT_SUMMARY || '';
  const dryRun = cliArgs.dryRun || process.env.INPUT_DRY_RUN === 'true';
  const mentionEveryone =
    cliArgs.mentionEveryone !== undefined
      ? cliArgs.mentionEveryone
      : process.env.INPUT_MENTION_EVERYONE !== 'false';

  const webhookUrl = process.env.DISCORD_ANNOUNCEMENTS_WEBHOOK;
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;

  if (!webhookUrl && !dryRun) {
    console.error('Error: DISCORD_ANNOUNCEMENTS_WEBHOOK environment variable is required.');
    process.exit(1);
  }

  const release = await resolveRelease({ tag, repo });
  const tagName = release.tag_name || tag;
  const releaseUrl = release.html_url || `https://github.com/${repo}/releases/tag/${tagName}`;
  const summary = customSummary || cleanSummary(release.body);

  const payload = buildDiscordPayload({
    tagName,
    releaseUrl,
    summary,
    mentionEveryone,
  });

  if (dryRun) {
    console.log('[DRY-RUN] Discord Webhook Payload:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\nPreview:\n' + payload.content);
    return;
  }

  console.log(`Sending announcement for ${tagName} to Discord...`);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to post to Discord webhook: ${res.status} ${errText}`);
  }

  console.log(`Successfully announced ${tagName} to Discord announcements channel!`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

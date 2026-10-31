const CLOUD_FIELDS = new Set(['apiOrigin', 'region', 'clientId']);

/** Only public connection metadata belongs in a publicly downloadable package. */
export function validateCloudConfig(value) {
  if (value === undefined) return undefined;
  const invalid = () => { throw new Error('Cloud configuration must contain only a public HTTPS apiOrigin, AWS region and Cognito clientId. Credentials and secrets must not be packaged.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== CLOUD_FIELDS.size || Object.keys(value).some(key => !CLOUD_FIELDS.has(key))) invalid();
  if (typeof value.apiOrigin !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value.apiOrigin)) invalid();
  let origin;
  try { origin = new URL(value.apiOrigin); } catch { invalid(); }
  if (origin.protocol !== 'https:' || !origin.hostname || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) invalid();
  if (typeof value.region !== 'string' || !/^[a-z]{2}(?:-[a-z]+)+-[0-9]+$/.test(value.region)) invalid();
  if (typeof value.clientId !== 'string' || !/^[A-Za-z0-9_+-]{1,128}$/.test(value.clientId)) invalid();
  return { apiOrigin: origin.origin, region: value.region, clientId: value.clientId };
}

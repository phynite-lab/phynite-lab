/** Step-up mutations must never silently replay a submitted admin password. */
export function adminPasswordMutation(path: string, method: string): boolean {
  const pathname = path.split('?')[0];
  return (method === 'POST' && pathname === '/v1/developer/compute/cloud/actions')
    || (method === 'PATCH' && pathname === '/v1/developer/compute/cloud/budget')
    || (method === 'PATCH' && /^\/v1\/developer\/users\/[^/]+\/cloud-grant$/.test(pathname));
}

export function passwordRejectionKeepsSession(code: unknown): boolean {
  return code === 'ADMIN_PASSWORD_INVALID' || code === 'ADMIN_AUTH_CHALLENGE_REQUIRED';
}

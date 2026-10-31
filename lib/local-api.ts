/** Same-origin desktop API. Empty mutations still use the JSON body contract. */
export async function localRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const payload = ['GET', 'HEAD'].includes(method) ? undefined : body ?? {};
  const response = await fetch(`/api/local/${path}`, {
    method, cache: 'no-store', credentials: 'same-origin',
    ...(payload === undefined ? {} : { body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'The local operation failed.');
  return result as T;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

function getApiKey(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('intel_api_key') || '';
  }
  return '';
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': getApiKey(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.detail || err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

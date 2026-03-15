'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

function getApiKey(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('intel_api_key') || '';
  }
  return '';
}

export function isLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('intel_logged_in') === 'true';
}

export function setLoggedIn(value: boolean): void {
  if (typeof window === 'undefined') return;
  if (value) {
    localStorage.setItem('intel_logged_in', 'true');
  } else {
    localStorage.removeItem('intel_logged_in');
  }
}

export function useRequireAuth(): void {
  const router = useRouter();
  useEffect(() => {
    if (!isLoggedIn()) router.replace('/');
  }, [router]);
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
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

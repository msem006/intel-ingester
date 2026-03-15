'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(isLoggedIn() ? '/dashboard' : '/login');
  }, [router]);
  return null;
}

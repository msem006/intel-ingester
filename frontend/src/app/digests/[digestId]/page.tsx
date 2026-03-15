import { Suspense } from 'react';
import DigestDetailClient from './DigestDetailClient';

// Placeholder so output:export build succeeds.
// CloudFront routes any unmatched path → index.html, so the SPA handles real IDs client-side.
export function generateStaticParams() {
  return [{ digestId: '_' }];
}

export default function DigestDetailPage({
  params,
}: {
  params: Promise<{ digestId: string }>;
}) {
  return (
    <Suspense>
      <DigestDetailClient params={params} />
    </Suspense>
  );
}

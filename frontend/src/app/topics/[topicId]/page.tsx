import TopicDetailClient from './TopicDetailClient';

// Placeholder so output:export build succeeds.
// CloudFront routes any unmatched path → index.html, so the SPA handles real IDs client-side.
export function generateStaticParams() {
  return [{ topicId: '_' }];
}

export default function TopicDetailPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  return <TopicDetailClient params={params} />;
}

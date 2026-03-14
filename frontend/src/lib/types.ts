// Domain types matching the OpenAPI schema

export type SourceType = 'rss' | 'reddit' | 'youtube' | 'podcast' | 'pdf' | 'manual';

export interface Topic {
  topic_id: string;
  name: string;
  description: string;
  window_days: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TopicCreate {
  name: string;
  description: string;
  window_days?: number;
}

export interface TopicUpdate {
  name?: string;
  description?: string;
  window_days?: number;
  enabled?: boolean;
}

export interface RssConfig {
  feed_url: string;
  lookback_days?: number;
  max_items?: number;
}

export interface RedditConfig {
  subreddits: string[];
  post_limit?: number;
  min_score?: number;
  lookback_days?: number;
}

export interface YouTubeConfig {
  channel_ids?: string[];
  playlist_ids?: string[];
  search_query?: string;
  max_results?: number;
  lookback_days?: number;
}

export interface PodcastConfig {
  feed_url: string;
  lookback_days?: number;
  max_episodes?: number;
}

export interface PdfConfig {
  urls: string[];
}

export interface ManualConfig {
  pending_items?: ManualPendingItem[];
}

export interface ManualPendingItem {
  title: string;
  url?: string;
  text?: string;
}

export type SourceConfig =
  | RssConfig
  | RedditConfig
  | YouTubeConfig
  | PodcastConfig
  | PdfConfig
  | ManualConfig;

export interface Source {
  source_id: string;
  topic_id: string;
  name: string;
  source_type: SourceType;
  config: SourceConfig;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_run_at?: string | null;
}

export interface SourceCreate {
  name: string;
  source_type: SourceType;
  config: SourceConfig;
}

export interface SourceUpdate {
  name?: string;
  config?: SourceConfig;
  enabled?: boolean;
}

export type ItemStatus = 'RAW' | 'EMBEDDED' | 'SCORED';

export interface Item {
  item_id: string;
  topic_id: string;
  source_id: string;
  source_type: SourceType;
  title: string;
  url: string;
  status: ItemStatus;
  score?: number | null;
  score_reason?: string | null;
  published_at?: string | null;
  created_at: string;
}

export interface PaginatedItems {
  items: Item[];
  cursor?: string | null;
  total: number;
}

export interface TrendEntry {
  trend: string;
  evidence: string;
  source_urls: string[];
}

export interface InsightEntry {
  insight: string;
  implication: string;
}

export type SignalConfidence = 'high' | 'medium' | 'low';

export interface EmergingSignalEntry {
  signal: string;
  confidence: SignalConfidence;
}

export interface NotableQuoteEntry {
  quote: string;
  source_url: string;
  attribution: string;
}

export interface DigestSourceEntry {
  title: string;
  url: string;
  score: number;
}

export interface Synthesis {
  summary: string;
  top_trends: TrendEntry[];
  key_insights: InsightEntry[];
  emerging_signals: EmergingSignalEntry[];
  notable_quotes: NotableQuoteEntry[];
  sources: DigestSourceEntry[];
}

export interface DigestSummary {
  digest_id: string;
  topic_id: string;
  created_at: string;
  window_days: number;
  item_count: number;
  email_sent_at?: string | null;
  summary: string;
}

export interface Digest extends DigestSummary {
  synthesis: Synthesis;
}

export interface ScanResponse {
  scan_id: string;
  topic_id: string;
  status: string;
  sources_triggered: number;
  task_arns: string[];
}

export interface SynthesisResponse {
  execution_arn: string;
  topic_id: string;
  status: string;
}

export interface ManualIngestRequest {
  title: string;
  text?: string;
  url?: string;
}

export interface ManualIngestResponse {
  item_id: string;
}

export interface Settings {
  ses_from_email: string;
  ses_to_email: string;
  default_window_days: number;
}

export interface SettingsUpdate {
  ses_from_email?: string;
  ses_to_email?: string;
  default_window_days?: number;
}

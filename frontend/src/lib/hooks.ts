import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  Topic,
  TopicCreate,
  TopicUpdate,
  Source,
  SourceCreate,
  SourceUpdate,
  DigestSummary,
  Digest,
  Settings,
  SettingsUpdate,
  ScanResponse,
  SynthesisResponse,
  ManualIngestRequest,
  ManualIngestResponse,
} from './types';

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export const useTopics = () =>
  useQuery<Topic[]>({
    queryKey: ['topics'],
    queryFn: () => apiFetch<Topic[]>('/topics'),
  });

export const useTopic = (id: string) =>
  useQuery<Topic>({
    queryKey: ['topics', id],
    queryFn: () => apiFetch<Topic>(`/topics/${id}`),
    enabled: !!id,
  });

export const useCreateTopic = () => {
  const qc = useQueryClient();
  return useMutation<Topic, Error, TopicCreate>({
    mutationFn: (body) => apiFetch<Topic>('/topics', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topics'] }),
  });
};

export const useUpdateTopic = (id: string) => {
  const qc = useQueryClient();
  return useMutation<Topic, Error, TopicUpdate>({
    mutationFn: (body) => apiFetch<Topic>(`/topics/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['topics'] });
      qc.invalidateQueries({ queryKey: ['topics', id] });
    },
  });
};

export const useDeleteTopic = () => {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiFetch<void>(`/topics/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topics'] }),
  });
};

export const useTriggerScan = () =>
  useMutation<ScanResponse, Error, string>({
    mutationFn: (topicId) =>
      apiFetch<ScanResponse>(`/topics/${topicId}/scan`, { method: 'POST', body: '{}' }),
  });

export const useTriggerSynthesis = () =>
  useMutation<SynthesisResponse, Error, { topicId: string; windowDays?: number; minScore?: number }>({
    mutationFn: ({ topicId, windowDays, minScore }) =>
      apiFetch<SynthesisResponse>(`/topics/${topicId}/synthesise`, {
        method: 'POST',
        body: JSON.stringify({ window_days: windowDays, min_score: minScore }),
      }),
  });

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const useSources = (topicId: string) =>
  useQuery<Source[]>({
    queryKey: ['sources', topicId],
    queryFn: () => apiFetch<Source[]>(`/topics/${topicId}/sources`),
    enabled: !!topicId,
  });

export const useCreateSource = (topicId: string) => {
  const qc = useQueryClient();
  return useMutation<Source, Error, SourceCreate>({
    mutationFn: (body) =>
      apiFetch<Source>(`/topics/${topicId}/sources`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources', topicId] }),
  });
};

export const useUpdateSource = (topicId: string, sourceId: string) => {
  const qc = useQueryClient();
  return useMutation<Source, Error, SourceUpdate>({
    mutationFn: (body) =>
      apiFetch<Source>(`/topics/${topicId}/sources/${sourceId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources', topicId] }),
  });
};

export const useDeleteSource = (topicId: string) => {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (sourceId) =>
      apiFetch<void>(`/topics/${topicId}/sources/${sourceId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources', topicId] }),
  });
};

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

export const useDigests = (topicId: string) =>
  useQuery<DigestSummary[]>({
    queryKey: ['digests', topicId],
    queryFn: () => apiFetch<DigestSummary[]>(`/topics/${topicId}/digests`),
    enabled: !!topicId,
  });

export const useDigest = (topicId: string, digestId: string) =>
  useQuery<Digest>({
    queryKey: ['digests', topicId, digestId],
    queryFn: () => apiFetch<Digest>(`/topics/${topicId}/digests/${digestId}`),
    enabled: !!topicId && !!digestId,
  });

// ---------------------------------------------------------------------------
// Manual Ingest
// ---------------------------------------------------------------------------

export const useManualIngest = (topicId: string) =>
  useMutation<ManualIngestResponse, Error, ManualIngestRequest>({
    mutationFn: (body) =>
      apiFetch<ManualIngestResponse>(`/topics/${topicId}/ingest`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const useSettings = () =>
  useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => apiFetch<Settings>('/settings'),
  });

export const useUpdateSettings = () => {
  const qc = useQueryClient();
  return useMutation<Settings, Error, SettingsUpdate>({
    mutationFn: (body) =>
      apiFetch<Settings>('/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
};

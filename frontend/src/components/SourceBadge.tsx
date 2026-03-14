import { Radio, MessageSquare, Play, Mic, FileText, PenLine } from 'lucide-react';

const icons = {
  rss: Radio,
  reddit: MessageSquare,
  youtube: Play,
  podcast: Mic,
  pdf: FileText,
  manual: PenLine,
} as const;

const colours = {
  rss: 'bg-orange-900/40 text-orange-300',
  reddit: 'bg-red-900/40 text-red-300',
  youtube: 'bg-red-900/40 text-red-300',
  podcast: 'bg-purple-900/40 text-purple-300',
  pdf: 'bg-blue-900/40 text-blue-300',
  manual: 'bg-zinc-800 text-zinc-300',
} as const;

export function SourceBadge({ type }: { type: string }) {
  const Icon = icons[type as keyof typeof icons] || PenLine;
  const colour = colours[type as keyof typeof colours] || colours.manual;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colour}`}
    >
      <Icon size={10} />
      {type}
    </span>
  );
}

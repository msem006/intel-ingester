type Variant = 'enabled' | 'disabled' | 'high' | 'medium' | 'low' | 'default';

const variantClasses: Record<Variant, string> = {
  enabled: 'bg-emerald-900/40 text-emerald-400',
  disabled: 'bg-zinc-800 text-zinc-500',
  high: 'bg-emerald-900/40 text-emerald-400',
  medium: 'bg-yellow-900/40 text-yellow-400',
  low: 'bg-zinc-800 text-zinc-400',
  default: 'bg-zinc-800 text-zinc-400',
};

export function StatusBadge({
  label,
  variant = 'default',
}: {
  label: string;
  variant?: Variant;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variantClasses[variant]}`}
    >
      {label}
    </span>
  );
}

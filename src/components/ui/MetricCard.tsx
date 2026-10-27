import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  trend?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean };
}) {
  const TrendIcon =
    trend?.direction === 'up' ? ArrowUpRight : trend?.direction === 'down' ? ArrowDownRight : Minus;
  return (
    <article className="card metric-card">
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon">
          <Icon size={15} strokeWidth={1.8} />
        </span>
      </div>
      <p className="metric-value">{value}</p>
      <div className="metric-detail">
        {trend ? (
          <span className={`metric-trend trend-${trend.good === false ? 'negative' : trend.direction}`}>
            <TrendIcon size={12} strokeWidth={2.2} />
            {trend.value}
          </span>
        ) : null}
        <span>{detail}</span>
      </div>
    </article>
  );
}

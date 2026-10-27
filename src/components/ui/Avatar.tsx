import { initials } from '../../lib/format';

export function Avatar({
  name,
  size = 'md',
  muted = false,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  muted?: boolean;
}) {
  return (
    <span className={`avatar avatar-${size}${muted ? ' avatar-muted' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

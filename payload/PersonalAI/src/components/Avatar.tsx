import type { Character } from '../types';

/** Stable hue from a name, for monogram avatars. */
function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

interface Props {
  character?: Pick<Character, 'name' | 'avatar'>;
  size?: number;
  className?: string;
}

export function Avatar({ character, size = 32, className = '' }: Props) {
  const name = character?.name || 'AI';
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };

  if (character?.avatar) {
    return <img className={`avatar ${className}`} src={character.avatar} alt={name} style={style} draggable={false} />;
  }
  const h = hue(name);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const key = name.toLowerCase();
  const look: React.CSSProperties = key === 'lumicos'
    ? { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-strong)' }
    : key === 'nova'
      ? { background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', color: 'var(--accent-contrast)' }
      : { background: `linear-gradient(135deg, hsl(${h} 70% 68%), hsl(${(h + 50) % 360} 60% 55%))` };
  return (
    <div
      className={`avatar avatar-mono ${className}`}
      style={{ ...style, ...look }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}

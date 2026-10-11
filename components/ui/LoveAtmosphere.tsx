import type { CSSProperties } from 'react';

const hearts = [
  { x: '5%', y: '16%', size: 14, duration: 12, delay: -2, drift: 18, outline: false },
  { x: '12%', y: '68%', size: 11, duration: 15, delay: -8, drift: -14, outline: true },
  { x: '23%', y: '35%', size: 8, duration: 14, delay: -5, drift: 10, outline: false },
  { x: '34%', y: '88%', size: 13, duration: 17, delay: -11, drift: -18, outline: true },
  { x: '47%', y: '18%', size: 9, duration: 13, delay: -7, drift: 15, outline: true },
  { x: '58%', y: '74%', size: 12, duration: 16, delay: -4, drift: -12, outline: false },
  { x: '69%', y: '31%', size: 10, duration: 14, delay: -9, drift: 16, outline: true },
  { x: '78%', y: '84%', size: 9, duration: 18, delay: -13, drift: -10, outline: false },
  { x: '86%', y: '13%', size: 13, duration: 16, delay: -6, drift: 14, outline: true },
  { x: '94%', y: '54%', size: 11, duration: 15, delay: -10, drift: -15, outline: false }
];

export function LoveAtmosphere() {
  return (
    <div className="love-atmosphere" aria-hidden="true">
      <span className="love-orb love-orb-one" />
      <span className="love-orb love-orb-two" />
      {hearts.map((heart, index) => (
        <span
          key={index}
          className="love-heart"
          style={{
            '--love-x': heart.x,
            '--love-y': heart.y,
            '--love-size': `${heart.size}px`,
            '--love-duration': `${heart.duration}s`,
            '--love-delay': `${heart.delay}s`,
            '--love-drift': `${heart.drift}px`,
            '--love-color': heart.outline ? 'rgba(129, 140, 248, 0.62)' : 'rgba(238, 114, 151, 0.72)'
          } as CSSProperties}
        >
          {heart.outline ? '\u2661' : '\u2665'}
        </span>
      ))}
    </div>
  );
}

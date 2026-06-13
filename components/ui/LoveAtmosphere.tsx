import type { CSSProperties } from 'react';

const hearts = [
  { x: '6%', y: '18%', size: 12, duration: 12, delay: -2, drift: 18 },
  { x: '14%', y: '72%', size: 9, duration: 15, delay: -8, drift: -14 },
  { x: '26%', y: '38%', size: 7, duration: 14, delay: -5, drift: 10 },
  { x: '43%', y: '84%', size: 11, duration: 17, delay: -11, drift: -18 },
  { x: '58%', y: '22%', size: 8, duration: 13, delay: -7, drift: 15 },
  { x: '72%', y: '68%', size: 13, duration: 16, delay: -4, drift: -12 },
  { x: '84%', y: '30%', size: 10, duration: 14, delay: -9, drift: 16 },
  { x: '93%', y: '78%', size: 8, duration: 18, delay: -13, drift: -10 }
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
            '--love-drift': `${heart.drift}px`
          } as CSSProperties}
        >
          ♥
        </span>
      ))}
    </div>
  );
}

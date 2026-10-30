/**
 * AuthBrand — the Property NI dusk-waterway brand block shared by the public
 * auth surfaces (login, forgot-password, reset-password). Moved verbatim out
 * of app/login/page.tsx so the two password-reset pages reuse the exact same
 * skyline field + wordmark instead of duplicating ~150 lines of SVG per page
 * (plan Phase 4 / risk R4 "import a minimal slice of the brand block").
 *
 * Everything here is SSR-safe: the skyline is a deterministic author SVG
 * (no Math.random, no client state), so it renders identically on server and
 * client.
 */

function hash(n: number): number {
  let x = (n ^ 61) ^ (n >>> 16);
  x = (x + (x << 3)) | 0;
  x ^= x >>> 4;
  x = (Math.imul(x, 0x27d4eb2d)) | 0;
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

const SCENE_W = 640;
const QUAY_Y = 636;

interface Column {
  x: number;
  w: number;
  h: number;
  tone: number;
}

/** Deterministic row of variable-width columns rising from the horizon. */
function makeColumns(seed: number, minH: number, spanH: number): Column[] {
  const cols: Column[] = [];
  let x = -4;
  for (let i = 0; i < 60 && x < SCENE_W; i++) {
    const w = 7 + Math.floor(hash(seed * 131 + i) * 21); // 7–27px column
    const h = minH + hash(seed * 97 + i * 7 + 3) * spanH; // seeded height
    cols.push({ x: Math.round(x), w, h: Math.round(h), tone: (i + seed) % 2 });
    x += w + 5 + Math.floor(hash(seed * 53 + i * 11) * 9); // 5–13px gap
  }
  return cols;
}

const BACK_COLUMNS = makeColumns(3, 88, 224); // far layer — dimmer atmosphere
const FRONT_COLUMNS = makeColumns(7, 44, 248); // near layer — crisp chrome tones

const TONES = ['#2B3E66', '#24355C'];

/**
 * Abstract skyline field — conceptual take on the brand subject: distant city
 * columns over a working waterway at dusk. Two depth layers, one amber
 * horizon line, a pale reflection, drawn in the standard navy palette with
 * amber reserved for the live-status accents. Fills its positioned parent.
 */
export function SkylineField() {
  const stars = Array.from({ length: 18 }, (_, i) => ({
    x: 8 + hash(i * 7 + 1) * (SCENE_W - 16),
    y: 8 + hash(i * 13 + 5) * 400,
    r: 0.6 + hash(i * 31 + 9) * 0.9,
    o: 0.12 + hash(i * 19 + 3) * 0.2,
  }));
  const glints = Array.from({ length: 9 }, (_, i) => ({
    x: 18 + hash(i * 17 + 4) * (SCENE_W - 80),
    y: QUAY_Y + 18 + i * ((900 - QUAY_Y - 30) / 9) + hash(i * 29 + 6) * 6,
    w: 24 + hash(i * 3 + 8) * 40,
    o: 0.04 + hash(i * 5 + 4) * 0.07,
  }));
  const beaconIdx = [3, 10, 17].filter((i) => i < FRONT_COLUMNS.length);

  return (
    <svg
      viewBox={`0 0 ${SCENE_W} 900`}
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="login-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#121C30" />
          <stop offset="0.7" stopColor="#16223A" />
          <stop offset="1" stopColor="#1B2A4A" />
        </linearGradient>
        <linearGradient id="login-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0E1830" />
          <stop offset="1" stopColor="#0A1120" />
        </linearGradient>
        {/* Horizon haze — dissolves the far layer into the sky */}
        <linearGradient id="login-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1B2A4A" stopOpacity="0" />
          <stop offset="1" stopColor="#1B2A4A" stopOpacity="0.85" />
        </linearGradient>
        <filter id="login-blur-lg" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="login-blur-sm" x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* Sky */}
      <rect width={SCENE_W} height={QUAY_Y} fill="url(#login-sky)" />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#F8FAFC" opacity={s.o} filter="url(#login-blur-sm)" />
      ))}

      {/* Far columns — atmospheric depth layer */}
      <g filter="url(#login-blur-lg)" opacity={0.55}>
        {BACK_COLUMNS.map((c, i) => (
          <rect key={i} x={c.x} y={QUAY_Y - c.h} width={c.w} height={c.h} fill="#24355C" rx={2} />
        ))}
      </g>

      {/* Horizon haze over the far layer */}
      <rect x={0} y={QUAY_Y - 110} width={SCENE_W} height={110} fill="url(#login-haze)" />

      {/* Near columns — crisp, alternating chrome tones */}
      <g filter="url(#login-blur-sm)">
        {FRONT_COLUMNS.map((c, i) => (
          <rect key={i} x={c.x} y={QUAY_Y - c.h} width={c.w} height={c.h} fill={TONES[c.tone]} rx={2} />
        ))}
      </g>

      {/* Beacon lights — the city is occupied */}
      <g filter="url(#login-blur-sm)">
        {beaconIdx.map((i) => {
          const c = FRONT_COLUMNS[i];
          return (
            <circle key={i} cx={c.x + c.w / 2} cy={QUAY_Y - c.h - 3} r={1.7} fill="#F5A623" opacity={0.45} />
          );
        })}
      </g>

      {/* Water */}
      <rect x={0} y={QUAY_Y + 4} width={SCENE_W} height={900 - QUAY_Y - 4} fill="url(#login-water)" />

      {/* Reflection — near columns mirrored, compressed and dimmed */}
      <g transform={`translate(0 ${2 * QUAY_Y}) scale(1 -0.5)`} filter="url(#login-blur-lg)" opacity={0.4}>
        {FRONT_COLUMNS.map((c, i) => (
          <rect key={i} x={c.x} y={QUAY_Y - c.h} width={c.w} height={c.h} fill={TONES[c.tone]} rx={2} />
        ))}
      </g>

      {/* Amber horizon — the working waterway, a live-status line */}
      <line x1={0} y1={QUAY_Y + 4.5} x2={SCENE_W} y2={QUAY_Y + 4.5} stroke="#F5A623" strokeWidth={1.2} opacity={0.4} />

      {/* Quiet amber glints on the water */}
      {glints.map((g, i) => (
        <rect key={i} x={g.x} y={g.y} width={g.w} height={2} rx={1} fill="#F5A623" opacity={g.o * 0.9} filter="url(#login-blur-sm)" />
      ))}
    </svg>
  );
}

export function BrandMark({ onDark, className }: { onDark?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
        onDark ? 'border-white/20 bg-white/10' : 'border-navy-700/30 bg-navy-850'
      } ${className ?? ''}`}
    >
      {/* House glyph — the product's subject, drawn in the accent */}
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
        <path
          d="M4.5 11.5 12 5l7.5 6.5"
          fill="none"
          stroke="#F5A623"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6.5 10.5V19h11v-8.5"
          fill="none"
          stroke="#F5A623"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Wordmark({ onDark }: { onDark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark onDark={onDark} />
      <span className={`text-[30px] font-semibold tracking-tight ${onDark ? 'text-white' : 'text-slate-900'}`}>
        Property NI
      </span>
    </div>
  );
}

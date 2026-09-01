import React from 'react'

/*
 * Shared display pieces.
 *
 * The rule running through all of them: state is never encoded by colour alone.
 * A severity is a coloured chip *with its name in it*; a grade is a letter that
 * happens to sit on a coloured tile; the attribution chart carries a legend and
 * a signed number beside every bar. Colour is the fast path, text is the
 * guarantee.
 */

// ---------------------------------------------------------------- primitives

export function Card({ children, className = '', ...rest }) {
  return (
    <div
      className={`bg-surface border border-line rounded-md ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export function Label({ children, className = '' }) {
  return (
    <div
      className={`font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-ink-3 ${className}`}
    >
      {children}
    </div>
  )
}

export function Mono({ children, className = '' }) {
  return <span className={`font-mono text-[12.5px] ${className}`}>{children}</span>
}

// -------------------------------------------------------------------- grades

const GRADE_TONE = {
  'A+': 'bg-ok text-white',
  A: 'bg-ok text-white',
  B: 'bg-[#2e7d5b] text-white',
  C: 'bg-high text-white',
  D: 'bg-[#8a4a10] text-white',
  E: 'bg-[#94301f] text-white',
  F: 'bg-crit text-white',
}

export function GradeBadge({ grade, size = 'md', title }) {
  const letter = grade || '—'
  const tone = GRADE_TONE[letter] || 'bg-surface-3 text-ink-2'
  const dims =
    size === 'lg'
      ? 'w-24 h-24 text-5xl rounded-lg'
      : size === 'sm'
        // "A+" is two glyphs. A fixed 28px square crops it, so the small badge
        // becomes a pill when the grade is more than one character.
        ? `${letter.length > 1 ? 'px-1.5 min-w-[28px]' : 'w-7'} h-7 text-sm rounded`
        : 'w-11 h-11 text-xl rounded-md'
  return (
    <span
      className={`inline-flex items-center justify-center font-display font-bold tracking-tight shrink-0 ${dims} ${tone}`}
      title={title || `Grade ${letter}`}
      aria-label={`Grade ${letter}`}
    >
      {letter}
    </span>
  )
}

// ----------------------------------------------------------------- severity

const SEVERITY_TONE = {
  critical: 'bg-crit-soft text-crit',
  high: 'bg-high-soft text-high',
  medium: 'bg-med-soft text-med',
  low: 'bg-surface-3 text-ink-2',
  info: 'bg-info-soft text-info',
}

export function SeverityPill({ severity, className = '' }) {
  const key = String(severity || 'info').toLowerCase()
  return (
    <span
      className={`inline-block font-mono text-[10px] font-bold tracking-[0.05em] uppercase px-[7px] py-[2px] rounded whitespace-nowrap ${
        SEVERITY_TONE[key] || SEVERITY_TONE.info
      } ${className}`}
    >
      {key}
    </span>
  )
}

export function Chip({ children, tone = 'muted', className = '' }) {
  const tones = {
    muted: 'bg-surface-3 text-ink-2',
    accent: 'bg-accent-soft text-accent',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-high-soft text-high',
    crit: 'bg-crit-soft text-crit',
    info: 'bg-info-soft text-info',
  }
  return (
    <span
      className={`inline-block font-mono text-[10px] font-semibold tracking-[0.05em] uppercase px-[7px] py-[2px] rounded whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// --------------------------------------------------------------- stat tiles

/**
 * A count is a number, not a chart.
 *
 * Severity totals were the obvious place to reach for a stacked bar, and it
 * would have been the wrong form: four values, no trend, no part-to-whole
 * question anyone actually asks. Tiles read faster and let each value keep its
 * own label — which is also what keeps the status colours legible.
 */
export function StatTile({ label, value, tone = 'default', hint }) {
  const accentBar = {
    default: 'bg-line-2',
    critical: 'bg-crit',
    high: 'bg-high',
    medium: 'bg-med',
    low: 'bg-line-2',
    ok: 'bg-ok',
    accent: 'bg-accent',
  }[tone]

  return (
    <div className="bg-surface border border-line rounded-md p-3.5 flex gap-3 items-start">
      <span className={`w-[3px] self-stretch rounded-sm ${accentBar}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-2xl leading-none font-semibold tabular-nums">{value}</div>
        <Label className="mt-1.5">{label}</Label>
        {hint && <div className="text-[11px] text-ink-3 mt-1 leading-snug">{hint}</div>}
      </div>
    </div>
  )
}

// -------------------------------------------------- model attribution chart

/**
 * TreeSHAP contributions, as a diverging bar chart.
 *
 * Diverging is the right form because the data has a signed midpoint: a
 * contribution either pushes the session toward the predicted class or pulls it
 * away, and zero means neither. Two hues plus a neutral axis, never a ramp.
 *
 * The two poles were picked by running the palette validator, not by eye. Both
 * light and dark pass the lightness band, chroma floor, CVD separation
 * (ΔE 23 under protanopia), normal-vision floor and 3:1 contrast.
 */
export function ShapChart({ contributions = [], max = 8 }) {
  const rows = contributions.slice(0, max)
  if (!rows.length) return null
  const peak = Math.max(...rows.map((c) => Math.abs(c.contribution)), 0.0001)

  return (
    <figure className="m-0">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
        <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <span className="w-3 h-[9px] rounded-sm bg-shap-pos" aria-hidden="true" />
          pushes toward the verdict
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <span className="w-3 h-[9px] rounded-sm bg-shap-neg" aria-hidden="true" />
          pulls away from it
        </span>
      </figcaption>

      <div className="space-y-[7px]">
        {rows.map((c) => {
          const positive = c.contribution > 0
          const width = (Math.abs(c.contribution) / peak) * 50
          return (
            <div
              key={c.feature}
              className="grid grid-cols-[minmax(0,168px)_1fr_58px] gap-2.5 items-center"
              title={`${c.feature} = ${c.value} contributes ${c.contribution > 0 ? '+' : ''}${c.contribution}`}
            >
              <div className="font-mono text-[11px] text-ink-2 truncate" title={c.feature}>
                {c.feature}
                <span className="text-ink-3"> = {formatFeatureValue(c.value)}</span>
              </div>

              {/* Bars grow out from a shared centre line, so sign is spatial as
                  well as chromatic. Ends are rounded away from the axis only. */}
              <div className="relative h-[11px]">
                <span
                  className="absolute inset-y-[-3px] left-1/2 w-px bg-line-2"
                  aria-hidden="true"
                />
                <span
                  className={`absolute top-0 h-[11px] ${
                    positive
                      ? 'left-1/2 bg-shap-pos rounded-r-[4px]'
                      : 'right-1/2 bg-shap-neg rounded-l-[4px]'
                  }`}
                  style={{ width: `${width}%` }}
                />
              </div>

              <div className="font-mono text-[11px] tabular-nums text-right text-ink-2">
                {c.contribution > 0 ? '+' : ''}
                {Number(c.contribution).toFixed(3)}
              </div>
            </div>
          )
        })}
      </div>
    </figure>
  )
}

function formatFeatureValue(v) {
  if (v === -1) return 'not observable'
  if (typeof v === 'number') return Number.isInteger(v) ? v : v.toFixed(2)
  return String(v)
}

// ------------------------------------------------------------------ notices

export function Notice({ tone = 'warn', title, children }) {
  const tones = {
    warn: 'border-l-high bg-high-soft',
    crit: 'border-l-crit bg-crit-soft',
    ok: 'border-l-ok bg-ok-soft',
    info: 'border-l-info bg-info-soft',
  }
  const titleTone = {
    warn: 'text-high',
    crit: 'text-crit',
    ok: 'text-ok',
    info: 'text-info',
  }
  return (
    <div className={`border border-line border-l-[3px] rounded-r-md px-4 py-3 my-3 ${tones[tone]}`}>
      {title && <Label className={`mb-1 ${titleTone[tone]}`}>{title}</Label>}
      <div className="text-[14px] leading-relaxed">{children}</div>
    </div>
  )
}

export function Empty({ title, children }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="font-display text-lg font-semibold mb-1.5">{title}</div>
      <div className="text-ink-2 text-sm max-w-md mx-auto leading-relaxed">{children}</div>
    </div>
  )
}

export function Spinner({ label }) {
  return (
    <div className="flex items-center gap-3 text-ink-2 text-sm">
      <span
        className="w-4 h-4 rounded-full border-2 border-line-2 border-t-accent animate-spin"
        aria-hidden="true"
      />
      {label}
    </div>
  )
}

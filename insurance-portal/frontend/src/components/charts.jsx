/**
 * Small chart kit for the analytics pages — plain SVG/HTML, no chart library.
 * Kept identical in the hospital and insurance portals.
 *
 * Conventions: thin bars (≤24px) with a 4px rounded data-end and a square
 * baseline, 2px surface gaps between stacked segments, hairline gridlines,
 * text in ink colours (never the series colour), a legend whenever there is
 * more than one series, a hover tooltip on every mark, and a table view for the
 * column charts. Outcome colours were checked for colour-blind separation.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export const COLORS = {
  blue: '#2a78d6',
  good: '#0ca30c',
  flagged: '#eda100',
  critical: '#d03b3b',
  track: '#cde2fb',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  ink2: '#52514e',
  // ordinal blue steps for ordered stages (lightest still clears 2:1)
  ramp: ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'],
}

export const OUTCOME_SERIES = [
  { key: 'approved', label: 'Approved / paid', color: COLORS.good },
  { key: 'in_progress', label: 'In progress', color: COLORS.blue },
  { key: 'flagged', label: 'Flagged, awaiting review', color: COLORS.flagged },
  { key: 'rejected', label: 'Rejected', color: COLORS.critical },
]

export const BAND_COLORS = { approve: COLORS.good, review: COLORS.flagged, flag: COLORS.critical }

// ── Formatting ────────────────────────────────────────────────────────────────
export const fmtINR = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
export const fmtINRCompact = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(n)
export const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
export const fmtDuration = (ms) => {
  if (ms == null) return '—'
  if (ms < 60e3) return `${Math.max(1, Math.round(ms / 1000))} s`
  if (ms < 3600e3) return `${Math.round(ms / 60e3)} min`
  if (ms < 86400e3) return `${(ms / 3600e3).toFixed(1)} h`
  return `${(ms / 86400e3).toFixed(1)} days`
}
export const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

// ── Tooltip ───────────────────────────────────────────────────────────────────
export function useTooltip() {
  const [tip, setTip] = useState(null)
  const show = (e, content) => setTip({ x: e.clientX, y: e.clientY, content })
  const hide = () => setTip(null)
  const flip = tip && tip.x > window.innerWidth - 260
  const node = tip && (
    <div
      role="tooltip"
      className="fixed z-50 pointer-events-none bg-gray-900 text-white text-xs rounded-lg shadow-lg px-3 py-2 max-w-[240px]"
      style={{ left: flip ? tip.x - 252 : tip.x + 14, top: tip.y + 14 }}
    >
      {tip.content}
    </div>
  )
  return { show, hide, node }
}

function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    // Measure now; ResizeObserver callbacks are paused while a tab is hidden.
    setWidth(Math.floor(ref.current.clientWidth))
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

// ── Layout pieces ─────────────────────────────────────────────────────────────
export function KpiTile({ label, value, sub, hero = false }) {
  return (
    <div className="card p-5">
      <div className="text-[13px] font-medium text-gray-500">{label}</div>
      <div className={`${hero ? 'text-4xl' : 'text-2xl'} font-semibold text-gray-900 tracking-tight mt-1.5`}>{value ?? '—'}</div>
      {sub && <div className="text-xs text-gray-500 mt-1.5 leading-snug">{sub}</div>}
    </div>
  )
}

export function ChartCard({ title, subtitle, children, table, className = '', empty }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-900 text-[15px]">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{subtitle}</p>}
        </div>
        {table && !empty && (
          <button
            type="button"
            onClick={() => setAsTable(v => !v)}
            className="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-800 border border-gray-200 rounded-md px-2 py-1"
          >
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      {empty ? (
        <div className="py-8 text-center text-sm text-gray-400">{empty}</div>
      ) : asTable && table ? (
        <DataTable columns={table.columns} rows={table.rows} />
      ) : (
        children
      )}
    </div>
  )
}

export function Legend({ series }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
      {series.map(s => (
        <span key={s.key || s.label} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

export function DataTable({ columns, rows, empty = 'Nothing to show yet.' }) {
  if (!rows.length) return <div className="py-6 text-center text-sm text-gray-400">{empty}</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            {columns.map(c => (
              <th key={c.key} className={`py-2 pr-4 font-medium whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map(c => (
                <td key={c.key} className={`py-2 pr-4 text-gray-700 ${c.align === 'right' ? 'text-right whitespace-nowrap' : ''}`}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Column charts ─────────────────────────────────────────────────────────────
// Whole-number tick step (1, 2, 5 × 10ⁿ) giving about four intervals.
const niceScale = (v) => {
  const raw = Math.max(1, v) / 4
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / p
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p)
  const max = step * Math.max(1, Math.ceil(v / step))
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) }
}

// Rounded top (data end), square bottom (baseline).
const topRoundedRect = (x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

/**
 * bars: [{ label, segments: [{ value, color }], tip }] — segments stack from
 * the baseline up; only the top segment gets the rounded end.
 */
export function Columns({ bars, height = 190, capLabels = true, threshold }) {
  const [ref, width] = useWidth()
  const tt = useTooltip()
  const padL = 30, padB = 24, padT = 16
  const innerW = Math.max(0, width - padL)
  const innerH = height - padB - padT
  const totals = bars.map(b => b.segments.reduce((a, s) => a + s.value, 0))
  const { max, ticks } = niceScale(Math.max(1, ...totals))
  const band = bars.length ? innerW / bars.length : 0
  const barW = Math.min(24, band * 0.6)
  const y = (v) => padT + innerH - (v / max) * innerH
  const every = Math.max(1, Math.ceil(bars.length / 8))

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Column chart">
          {ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.axis : COLORS.grid} strokeWidth="1" />
              <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={COLORS.muted}>
                {t.toLocaleString('en-IN')}
              </text>
            </g>
          ))}
          {threshold && (
            <text x={width - 2} y={padT - 4} textAnchor="end" fontSize="10" fill={COLORS.ink2}>{threshold}</text>
          )}
          {bars.map((b, i) => {
            const cx = padL + band * i + band / 2
            const x = cx - barW / 2
            let cursor = y(0)
            const drawn = b.segments.filter(s => s.value > 0)
            return (
              <g key={i}>
                {drawn.map((s, j) => {
                  const h = (s.value / max) * innerH
                  const top = cursor - h
                  const isTop = j === drawn.length - 1
                  const gap = isTop ? 0 : 2
                  const el = (
                    <path key={j} d={topRoundedRect(x, top + (isTop ? 0 : gap), barW, Math.max(1, h - gap), isTop ? 4 : 0)} fill={s.color} />
                  )
                  cursor = top
                  return el
                })}
                {capLabels && totals[i] > 0 && (
                  <text x={cx} y={y(totals[i]) - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill={COLORS.ink2}>
                    {totals[i].toLocaleString('en-IN')}
                  </text>
                )}
                {i % every === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" fontSize="10" fill={COLORS.muted}>{b.label}</text>
                )}
                <rect
                  x={padL + band * i} y={padT} width={band} height={innerH}
                  fill="transparent"
                  onMouseMove={(e) => tt.show(e, b.tip)}
                  onMouseLeave={tt.hide}
                />
              </g>
            )
          })}
        </svg>
      )}
      {tt.node}
    </div>
  )
}

export function StackedDaily({ daily, series = OUTCOME_SERIES }) {
  const bars = daily.map(d => ({
    label: fmtDay(d.date),
    segments: series.map(s => ({ value: d[s.key] || 0, color: s.color })),
    tip: (
      <div>
        <div className="font-semibold mb-1">{fmtDay(d.date)}</div>
        {series.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="font-semibold ml-3">{d[s.key] || 0}</span>
          </div>
        ))}
      </div>
    ),
  }))
  return (
    <>
      <Legend series={series} />
      <Columns bars={bars} />
    </>
  )
}

export function ScoreHistogram({ bins }) {
  const series = [
    { key: 'approve', label: 'Below 50 — approve', color: BAND_COLORS.approve },
    { key: 'review', label: '50–74 — manual review', color: BAND_COLORS.review },
    { key: 'flag', label: '75+ — auto-flagged by the contract', color: BAND_COLORS.flag },
  ]
  const bars = bins.map(b => ({
    label: b.label,
    segments: [{ value: b.count, color: BAND_COLORS[b.band] }],
    tip: <div><span className="font-semibold">{b.count}</span> claim{b.count === 1 ? '' : 's'} scored {b.label}</div>,
  }))
  return (
    <>
      <Legend series={series} />
      <Columns bars={bars} height={170} />
    </>
  )
}

// ── Horizontal bars ───────────────────────────────────────────────────────────
/** rows: [{ label, value, display, color, sub, tip }] */
export function BarList({ rows, max, color = COLORS.blue, empty = 'Nothing to show yet.' }) {
  const tt = useTooltip()
  if (!rows.length) return <div className="py-6 text-center text-sm text-gray-400">{empty}</div>
  const top = max ?? Math.max(1, ...rows.map(r => r.value || 0))
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] items-center gap-3"
          onMouseMove={(e) => r.tip && tt.show(e, r.tip)}
          onMouseLeave={tt.hide}
        >
          <div className="min-w-0">
            <div className="text-[13px] text-gray-700 leading-snug break-words">{r.label}</div>
            {r.sub && <div className="text-[11px] text-gray-400 leading-snug">{r.sub}</div>}
          </div>
          <div className="h-3 bg-gray-100 rounded-sm">
            <div
              className="h-3"
              style={{
                width: `${Math.max(r.value > 0 ? 1.5 : 0, Math.min(100, ((r.value || 0) / top) * 100))}%`,
                background: r.color || color,
                borderRadius: '0 4px 4px 0',
              }}
            />
          </div>
          <div className="text-[13px] font-semibold text-gray-800 tabular-nums text-right whitespace-nowrap">{r.display ?? r.value}</div>
        </div>
      ))}
      {tt.node}
    </div>
  )
}

/** Part-of-whole bars: the track is the whole, the fill the part. */
export function MeterList({ rows, empty = 'Nothing to show yet.' }) {
  const tt = useTooltip()
  if (!rows.length) return <div className="py-6 text-center text-sm text-gray-400">{empty}</div>
  const top = Math.max(1, ...rows.map(r => r.total))
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i} onMouseMove={(e) => r.tip && tt.show(e, r.tip)} onMouseLeave={tt.hide}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-[13px] text-gray-700 leading-snug break-words min-w-0">{r.label}</span>
            <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{r.display}</span>
          </div>
          <div className="h-3 rounded-sm" style={{ width: `${(r.total / top) * 100}%`, background: COLORS.track }}>
            <div className="h-3" style={{ width: `${r.total ? Math.min(100, (r.part / r.total) * 100) : 0}%`, background: COLORS.blue, borderRadius: '0 4px 4px 0' }} />
          </div>
        </div>
      ))}
      {tt.node}
    </div>
  )
}

/** Refetch helper shared by the analytics pages. */
export function useAnalytics(fetcher) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = () => {
    setLoading(true)
    setError('')
    fetcher()
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])
  return { data, error, loading, reload: load }
}

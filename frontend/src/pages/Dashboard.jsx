import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  Card,
  Chip,
  Empty,
  GradeBadge,
  Label,
  Notice,
  SeverityPill,
  Spinner,
  StatTile,
} from '../components/ui'
import { useReport } from '../App'
import { adaptBackendCapture, getCapture } from '../lib/api'
import { bytes, datetime, sessionKind, shortHash, titleCase } from '../lib/format'

/**
 * Screen 03 — overall posture in one look.
 *
 * Ordered the way an analyst actually reads it: the headline grade, then how
 * much is broken, then which servers to fix in what order, then the sessions
 * that back all of it up.
 */
export default function Dashboard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { report, setReport } = useReport()
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(!report)

  // Deep links and refreshes have no context, so re-resolve from the route.
  useEffect(() => {
    if (report?.id && String(report.id) === String(id)) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const detail = await getCapture(id)
        if (!cancelled) setReport({ report: adaptBackendCapture(detail), id: detail.id })
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, report, setReport])

  if (loading) {
    return (
      <div className="py-24 flex justify-center">
        <Spinner label="Loading the analysis…" />
      </div>
    )
  }
  if (error) {
    return (
      <Empty title="That analysis could not be loaded">
        {error}{' '}
        <Link to="/" className="text-accent">
          Start again
        </Link>
        .
      </Empty>
    )
  }
  if (!report?.report) {
    return (
      <Empty title="Nothing loaded">
        <Link to="/" className="text-accent">
          Pick a capture
        </Link>{' '}
        to begin.
      </Empty>
    )
  }

  const r = report.report
  const c = r.capture || {}
  const counts = r.counts || {}

  return (
    <div>
      {/* -------------------------------------------------- headline */}
      <div className="flex items-start gap-3 justify-between flex-wrap mb-5">
        <div className="min-w-0">
          <Label className="text-accent mb-2">Cryptographic posture</Label>
          <h1 className="font-display text-[26px] font-semibold tracking-tight m-0 break-all">
            {c.filename}
          </h1>
          <div className="font-mono text-[11.5px] text-ink-3 mt-1.5 leading-relaxed break-all">
            {c.format} · {c.packet_count} packets · {bytes(c.bytes)} · captured{' '}
            {datetime(c.first_packet_time)}
            <br />
            SHA-256 {shortHash(c.sha256, 32)}
          </div>
        </div>
        <Link
          to={`/report/${id}/export`}
          className="font-mono text-[11px] tracking-[0.08em] uppercase px-3 py-2 rounded border border-line bg-surface text-ink-2 hover:text-ink no-underline shrink-0"
        >
          Export report
        </Link>
      </div>

      <div className="flex gap-6 items-center flex-wrap mb-6">
        <GradeBadge grade={r.overall_grade} size="lg" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 flex-1 min-w-[280px]">
          <StatTile label="Sessions" value={counts.sessions ?? 0} tone="accent" />
          <StatTile label="Servers" value={counts.assets ?? 0} tone="accent" />
          <StatTile label="Critical" value={counts.critical ?? 0} tone="critical" />
          <StatTile label="High" value={counts.high ?? 0} tone="high" />
          <StatTile label="Medium" value={counts.medium ?? 0} tone="medium" />
          <StatTile
            label="Creds exposed"
            value={counts.credentials_exposed ?? 0}
            tone={counts.credentials_exposed ? 'critical' : 'ok'}
          />
        </div>
      </div>

      {(r.warnings || []).map((w, i) => (
        <Notice key={i} tone="warn" title="Capture note">
          {w}
        </Notice>
      ))}

      {/* -------------------------------------------------- servers */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between mb-2.5">
          <h2 className="font-display text-[19px] font-semibold tracking-tight m-0">
            Servers, worst first
          </h2>
          <span className="text-[12px] text-ink-3">
            ranked by risk × how much traffic each carried
          </span>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[720px]">
            <thead>
              <tr className="bg-surface-2 border-b border-line-2">
                <Th>Server</Th>
                <Th>Protocol</Th>
                <Th>Role</Th>
                <Th>Grade</Th>
                <Th className="text-right">Weighted</Th>
                <Th>TLS observed</Th>
                <Th className="text-right">Sessions</Th>
                <Th className="text-right">Exposure</Th>
              </tr>
            </thead>
            <tbody>
              {(r.assets || []).map((a) => (
                <tr key={a.key} className="border-b border-line last:border-0">
                  <Td className="font-mono">{a.host}:{a.port}</Td>
                  <Td>{String(a.protocol || '').toUpperCase()}</Td>
                  <Td>
                    <Chip tone={a.role === 'mta_relay' ? 'muted' : 'accent'}>
                      {a.role === 'mta_relay' ? 'relay' : 'submission'}
                    </Chip>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <GradeBadge grade={a.grade?.letter} size="sm" />
                      {a.grade?.trusted === false && <Chip tone="warn">untrusted</Chip>}
                    </div>
                  </Td>
                  <Td className="text-right font-mono tabular-nums">
                    {a.grade?.raw_score ?? '—'}
                  </Td>
                  <Td className="font-mono text-[12px]">
                    {a.worst_tls
                      ? a.version_spread
                        ? `${a.worst_tls} → ${a.best_tls}`
                        : a.worst_tls
                      : 'none'}
                  </Td>
                  <Td className="text-right font-mono tabular-nums">{a.session_count}</Td>
                  <Td className="text-right font-mono tabular-nums">{a.exposure_score}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {/* -------------------------------------------------- remediation */}
      {(r.remediation || []).length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-[19px] font-semibold tracking-tight mb-2.5">
            Fix these, in this order
          </h2>
          <div className="grid gap-2">
            {r.remediation.map((m) => (
              <Card key={m.rule_id} className="px-4 py-3.5">
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="font-mono text-[12px] text-ink-3 tabular-nums pt-0.5">
                    {String(m.order).padStart(2, '0')}
                  </span>
                  <SeverityPill severity={m.severity} className="mt-0.5" />
                  <div className="flex-1 min-w-[240px]">
                    <div className="font-medium">{m.title}</div>
                    <div className="text-[13.5px] text-ink-2 mt-1 leading-relaxed">
                      {m.action}
                    </div>
                    <div className="font-mono text-[11px] text-ink-3 mt-1.5">
                      {m.rule_id} · {m.standard}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-ink-3 max-w-[220px] break-all">
                    {(m.affected_assets || []).join(', ')}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* -------------------------------------------------- sessions */}
      <section className="mt-8">
        <h2 className="font-display text-[19px] font-semibold tracking-tight mb-2.5">
          Sessions
        </h2>
        <div className="grid gap-2">
          {(r.sessions || []).map((s) => (
            <button
              key={s.tcp_stream}
              type="button"
              onClick={() => navigate(`/report/${id}/sessions/${s.tcp_stream}`)}
              className="text-left bg-surface border border-line rounded-md px-4 py-3.5 hover:border-line-2 transition-colors"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <GradeBadge grade={s.grade?.letter} size="sm" />
                <span className="font-medium">{sessionKind(s)}</span>
                <span className="font-mono text-[11.5px] text-ink-3">
                  {s.client?.ip}:{s.client?.port} → {s.server?.ip}:{s.server?.port}
                </span>
                {s.capability_mangled && <Chip tone="crit">downgrade evidence</Chip>}
                {s.cleartext_auth && <Chip tone="crit">credentials exposed</Chip>}
                {s.ml?.anomaly && <Chip tone="warn">anomalous</Chip>}
                {s.confidence === 'partial' && <Chip tone="muted">partial view</Chip>}
                <span className="ml-auto font-mono text-[11.5px] text-ink-3">
                  {(s.findings || []).filter((f) => f.severity !== 'info').length} finding(s)
                </span>
              </div>
              <div className="font-mono text-[11.5px] text-ink-2 mt-1.5">
                {s.tls_version ? `TLS ${s.tls_version}` : 'no encryption'}
                {s.cipher_suite ? ` · ${s.cipher_suite}` : ''}
                {s.grade?.capped_by ? ` · capped by ${s.grade.capped_by}` : ''}
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function Th({ children, className = '' }) {
  return (
    <th
      className={`font-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 text-left px-4 py-2.5 whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-2.5 align-top ${className}`}>{children}</td>
}

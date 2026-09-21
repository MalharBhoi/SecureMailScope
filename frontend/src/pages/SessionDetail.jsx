import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  Card,
  Chip,
  Empty,
  GradeBadge,
  Label,
  Notice,
  SeverityPill,
  ShapChart,
  Spinner,
} from '../components/ui'
import { Coverage } from '../components/Assessment'
import { useReport } from '../App'
import { adaptBackendCapture, getCapture } from '../lib/api'
import { dateOnly, sessionKind, titleCase, yesNo } from '../lib/format'

/**
 * Screens 04–06 in one view: the handshake, the certificate, the findings that
 * cite them, the downgrade evidence, and the model's reasoning.
 *
 * They belong together because an analyst checking one always wants the others
 * in the same glance — the handshake and the certificate are two independent
 * failure surfaces, and a finding is only worth anything next to the evidence
 * it came from.
 */
export default function SessionDetail() {
  const { id, stream } = useParams()
  const { report, setReport } = useReport()
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(!report)

  useEffect(() => {
    if (report?.id && String(report.id) === String(id)) {
      setLoading(false)
      return
    }
    let cancelled = false
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
        <Spinner label="Loading the session…" />
      </div>
    )
  }
  if (error) return <Empty title="Could not load that session">{error}</Empty>

  const s = (report?.report?.sessions || []).find(
    (x) => String(x.tcp_stream) === String(stream),
  )
  if (!s) {
    return (
      <Empty title="No such session in this capture">
        <Link to={`/report/${id}`} className="text-accent">
          Back to the dashboard
        </Link>
      </Empty>
    )
  }

  const leaf = (s.chain || [])[0]
  const findings = s.findings || []
  const real = findings.filter((f) => f.severity !== 'info')
  const info = findings.filter((f) => f.severity === 'info')

  return (
    <div>
      <Link
        to={`/report/${id}`}
        className="font-mono text-[11px] text-ink-3 hover:text-ink no-underline"
      >
        ← back to dashboard
      </Link>

      {/* -------------------------------------------------- header */}
      <div className="flex items-start gap-4 mt-3 mb-5 flex-wrap">
        <GradeBadge grade={s.grade?.letter} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[24px] font-semibold tracking-tight m-0">
            Session #{s.tcp_stream} · {sessionKind(s)}
          </h1>
          <div className="font-mono text-[11.5px] text-ink-3 mt-1.5 leading-relaxed">
            {s.client?.ip}:{s.client?.port} → {s.server?.ip}:{s.server?.port}
            {s.server_name ? ` (${s.server_name})` : ''} · frames {s.first_frame}–
            {s.last_frame} · role {s.role}
          </div>
          <div className="flex gap-1.5 mt-2.5 flex-wrap">
            {s.grade?.trusted === false && <Chip tone="warn">untrusted chain</Chip>}
            {s.confidence === 'partial' && <Chip tone="muted">partial view</Chip>}
            {s.ml?.anomaly && <Chip tone="warn">anomalous session</Chip>}
          </div>
        </div>
      </div>

      <Coverage coverage={s.coverage} />
      {/* -------------------------------------------------- score explanation */}
      <Card className="px-4 py-3 mb-5">
        <div className="font-mono text-[12px] text-ink-2 leading-relaxed">
          Weighted score <strong className="text-ink">{s.grade?.raw_score}</strong>
          {s.grade?.components && (
            <>
              {' '}(protocol {fmt(s.grade.components.protocol)} · key exchange{' '}
              {fmt(s.grade.components.key_exchange)} · cipher {fmt(s.grade.components.cipher)})
            </>
          )}
          {s.grade?.capped_by ? (
            <>
              , capped to <strong className="text-ink">{s.grade.letter}</strong> by{' '}
              <strong className="text-ink">{s.grade.capped_by}</strong>.
            </>
          ) : (
            '.'
          )}
          {s.grade?.zero_category && (
            <> A zero in {s.grade.zero_category} forces the score to 0.</>
          )}
        </div>
      </Card>

      {/* -------------------------------------------------- downgrade evidence */}
      {s.capability_mangled && (
        <Notice tone="crit" title="Downgrade evidence">
          The capability list contains <code className="font-mono">{s.mangled_token}</code>{' '}
          where the STARTTLS keyword belongs — an equal-length substitution that keeps packet
          sizes identical so nothing downstream notices. This exact attack was measured in the
          wild by Durumeric et al., IMC 2015.
        </Notice>
      )}

      {s.cleartext_auth && (
        <Notice tone="crit" title="Credentials exposed">
          {s.cleartext_auth.mechanism || 'Authentication'} credentials for{' '}
          <code className="font-mono">{s.cleartext_auth.username || 'an unknown user'}</code>{' '}
          were sent before any encryption existed
          {s.cleartext_auth.frame ? ` (frame ${s.cleartext_auth.frame})` : ''}. The password
          itself is never stored by this tool — only a SHA-256, so reuse can be correlated
          without the report becoming a second copy of the leak. Treat the credential as
          compromised.
        </Notice>
      )}

      {/* -------------------------------------------------- two failure surfaces */}
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        <Card className="p-4">
          <Label className="mb-3">TLS handshake</Label>
          <Row k="Version" v={s.tls_version || 'none — cleartext'} bad={!s.tls_version} />
          <Row k="Cipher suite" v={s.cipher_suite || '—'} />
          <Row
            k="Key exchange"
            v={s.kex ? `${s.kex}${s.kex_bits ? ` · ${s.kex_bits}-bit equivalent` : ''}` : '—'}
          />
          <Row
            k="Forward secrecy"
            v={yesNo(s.forward_secrecy)}
            bad={s.forward_secrecy === false}
          />
          <Row k="STARTTLS offered" v={yesNo(s.starttls_offered, 'no')} />
          <Row k="STARTTLS completed" v={yesNo(s.starttls_accepted, 'no')} />
          <Row k="JA4" v={s.ja4 || '—'} mono />
          <Row k="JA3" v={s.ja3 || '—'} mono />
        </Card>

        <Card className="p-4">
          <Label className="mb-3">X.509 certificate</Label>
          {s.cert_visibility === 'encrypted_tls13' ? (
            <div className="text-[13.5px] text-ink-2 leading-relaxed">
              TLS 1.3 encrypts the Certificate message (RFC 8446 §4.4), so a passive sensor
              cannot read it. No certificate findings apply to this session — that is a
              property of the protocol, not a gap in the analysis.
            </div>
          ) : leaf ? (
            <>
              <Row k="Subject" v={leaf.subject} />
              <Row k="Issuer" v={leaf.issuer} bad={leaf.self_signed} />
              <Row
                k="Valid until"
                v={
                  <span className="flex items-center gap-2 flex-wrap justify-end">
                    {dateOnly(leaf.not_after)}
                    {leaf.expired_at_capture ? (
                      <Chip tone="crit">expired at capture</Chip>
                    ) : (
                      <Chip tone="ok">valid at capture</Chip>
                    )}
                  </span>
                }
              />
              <Row
                k="Key / signature"
                v={`${leaf.key_algorithm || '?'} ${leaf.key_bits || '?'} · ${leaf.signature_hash || '?'}`}
                bad={leaf.key_bits && leaf.key_bits < 2048}
              />
              <Row k="Self-signed" v={yesNo(leaf.self_signed, 'no')} bad={leaf.self_signed} />
              <Row
                k="Chain valid"
                v={yesNo(s.chain_valid, 'not evaluated')}
                bad={s.chain_valid === false}
              />
              <Row k="Revocation" v={revocationText(s.revocation)} />
            </>
          ) : (
            <div className="text-[13.5px] text-ink-2">
              No certificate was presented — this session never negotiated TLS.
            </div>
          )}
        </Card>
      </div>

      {/* -------------------------------------------------- findings */}
      <section className="mb-6">
        <h2 className="font-display text-[19px] font-semibold tracking-tight mb-2.5">
          Findings
        </h2>
        {real.length === 0 && (
          <Card className="px-4 py-4 text-[13.5px] text-ink-2">
            Nothing above informational severity. This session met every rule the tool checks.
          </Card>
        )}
        <div className="grid gap-2">
          {real.map((f) => (
            <FindingCard key={f.rule_id} f={f} />
          ))}
          {info.map((f) => (
            <FindingCard key={f.rule_id} f={f} />
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- model */}
      {s.ml && (
        <section className="mb-6">
          <h2 className="font-display text-[19px] font-semibold tracking-tight mb-1">
            What the model thinks, and why
          </h2>
          <p className="text-[13.5px] text-ink-2 mb-3 max-w-[70ch] leading-relaxed">
            The model never decides a finding — every verdict above comes from the
            deterministic rule engine. It contributes an estimate of overall posture and a
            reason for it, which matters most on sessions where the rules have to abstain.
          </p>
          <Card className="p-4">
            <div className="flex gap-3 items-baseline flex-wrap mb-4">
              <Chip tone={s.ml.risk_class === 'critical' ? 'crit' : s.ml.risk_class === 'secure' ? 'ok' : 'warn'}>
                {s.ml.risk_class}
              </Chip>
              {/* Labelled as what it is. A bare "risk 0.0376" next to a chip
                  reading "weak" invites the reader to take it as the model's
                  confidence in that chip — it is the probability of the worst
                  class instead, which is a different question. */}
              <span className="font-mono text-[12px] text-ink-2">
                P(critical) {s.ml.risk_score} · anomaly {s.ml.anomaly ? 'yes' : 'no'}
                {s.ml.model_version ? ` · model ${s.ml.model_version}` : ''}
              </span>
            </div>
            {s.ml.explanation && (
              <p className="text-[14px] leading-relaxed mb-4">{s.ml.explanation}</p>
            )}
            <ShapChart contributions={s.ml.shap || []} />
          </Card>
        </section>
      )}

      {/* -------------------------------------------------- transcript */}
      {(s.command_transcript || []).length > 0 && (
        <section className="mb-6">
          <h2 className="font-display text-[19px] font-semibold tracking-tight mb-1">
            Reconstructed transcript
          </h2>
          <p className="text-[13.5px] text-ink-2 mb-2.5 max-w-[70ch] leading-relaxed">
            The cleartext phase of the conversation, rebuilt from the packets. Credential
            material is masked here — the evidence of exposure is the point, not a second
            copy of the secret.
          </p>
          <Card className="p-0 overflow-hidden">
            <pre className="font-mono text-[11.5px] leading-[1.6] p-4 overflow-x-auto m-0 bg-surface-2">
              {s.command_transcript.slice(0, 40).join('\n')}
            </pre>
          </Card>
        </section>
      )}

      {(s.notes || []).length > 0 && (
        <div className="text-[12.5px] text-ink-3 leading-relaxed">
          {s.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function FindingCard({ f }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <SeverityPill severity={f.severity} />
        <span className="font-mono text-[11.5px] text-ink-3">{f.rule_id}</span>
        <span className="font-medium flex-1 min-w-[220px]">{f.title}</span>
        {f.cap_grade && <Chip tone="warn">caps at {f.cap_grade}</Chip>}
      </div>
      {f.detail && (
        <div className="text-[13.5px] text-ink-2 mt-1.5 leading-relaxed">{f.detail}</div>
      )}
      <div className="text-[13.5px] mt-2 bg-surface-2 border border-line rounded px-3 py-2 leading-relaxed">
        <strong className="font-medium">Fix:</strong> {f.remediation}
      </div>
      <div className="font-mono text-[10.5px] text-ink-3 mt-2">
        {f.standard}
        {f.evidence?.frames?.length ? ` · frames ${f.evidence.frames.join(', ')}` : ''}
        {f.frames ? ` · frames ${f.frames}` : ''}
      </div>
    </Card>
  )
}

function Row({ k, v, bad = false, mono = false }) {
  return (
    <div className="flex justify-between gap-4 py-[7px] border-b border-line last:border-0 items-baseline">
      <span className="font-mono text-[11.5px] text-ink-3 shrink-0">{k}</span>
      <span
        className={`text-[13px] text-right break-all ${mono ? 'font-mono text-[11px]' : ''} ${
          bad ? 'text-crit font-medium' : ''
        }`}
      >
        {v}
      </span>
    </div>
  )
}

function fmt(n) {
  return n == null ? '—' : Math.round(n)
}

/**
 * Offline there is no responder to query, so "unknown" is the honest answer —
 * and it must not be mistaken for "good". Only a stapled OCSP response gives a
 * real verdict without touching the network.
 */
function revocationText(v) {
  switch (v) {
    case 'good':
      return 'not revoked (stapled OCSP)'
    case 'revoked':
      return 'REVOKED (stapled OCSP)'
    default:
      return 'not checked — no OCSP staple, and offline there is nothing to ask'
  }
}

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Card, GradeBadge, Label, Notice, Spinner } from '../components/ui'
import { useReport } from '../App'
import {
  adaptBackendCapture,
  analyseDemoCapture,
  getCapture,
  listDemoCaptures,
  listInvestigations,
  uploadCapture,
} from '../lib/api'

/**
 * Screen 01 — the only input the tool needs.
 *
 * One file, zero configuration. Protocols, ports and rules are all detected
 * from the capture itself, so there is nothing for an analyst to get wrong.
 *
 * The bundled captures below are analysed by the backend on click, exactly like
 * a file dropped here. They used to load pre-generated JSON instead, which made
 * the demo a different program from the product.
 */

export default function Upload() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const [investigations, setInvestigations] = useState([])
  const [investigationId, setInvestigationId] = useState(search.get('investigation') || '')
  useEffect(() => { listInvestigations().then(setInvestigations).catch(() => {}) }, [])
  const { setReport, health } = useReport()
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [demos, setDemos] = useState([])
  const inputRef = useRef(null)

  const ready = health?.status === 'UP'

  useEffect(() => {
    let cancelled = false
    if (!health?.reachable) return undefined
    listDemoCaptures()
      .then((list) => {
        if (!cancelled) setDemos(list)
      })
      .catch(() => {
        if (!cancelled) setDemos([])
      })
    return () => {
      cancelled = true
    }
  }, [health?.reachable])

  const show = useCallback(async (created) => {
    navigate(`/jobs/${created.id}`)
  }, [navigate])

  const handleFile = useCallback(
    async (file) => {
      if (!file) return
      setError(null)
      setBusy(`Analysing ${file.name}…`)
      try {
        await show(await uploadCapture(file, { investigationId }))
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy(null)
      }
    },
    [show, investigationId],
  )

  const runDemo = useCallback(
    async (name) => {
      setError(null)
      setBusy(`Analysing ${name}…`)
      try {
        await show(await analyseDemoCapture(name, investigationId))
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy(null)
      }
    },
    [show, investigationId],
  )

  return (
    <div className="max-w-[900px] mx-auto">
      <div className="mb-7">
        <Label className="text-accent mb-2.5">Email security assessment</Label>
        <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight m-0">
          Analyse a network capture
        </h1>
        <p className="text-ink-2 mt-2.5 max-w-[62ch] leading-relaxed">
          Review encryption, certificates and STARTTLS use in recorded email traffic.
          Upload a capture to see security grades, supporting evidence and recommended fixes.
        </p>
      </div>

      {/* The backend does the analysis, so say plainly when it cannot. */}
      {health && !health.reachable && (
        <Notice tone="warn" title="The API is not running">
          Start it with <code className="font-mono text-[12.5px]">docker compose up</code>, or{' '}
          <code className="font-mono text-[12.5px]">java -jar backend/target/securemailscope-1.0.0.jar</code>{' '}
          from the project root. This page will work as soon as it answers.
        </Notice>
      )}
      {health?.reachable && health.status !== 'UP' && (
        <Notice tone="warn" title="The API is running but cannot reach the analysis engine">
          {health.error || 'The engine could not be imported.'}
          {health.hint ? ` ${health.hint}` : ''}
        </Notice>
      )}

      <label className="block text-sm mb-4 mt-4">
        Investigation <span className="text-ink-3">(groups captures for history and comparison)</span>
        <select className="field mt-2" value={investigationId} onChange={e => setInvestigationId(e.target.value)} disabled={!!busy}>
          <option value="">Standalone analysis</option>
          {investigations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </label>
      {/* -------------------------------------------------- drop zone */}
      <Card
        className={`capture-dropzone p-6 sm:p-10 text-center transition-colors mt-4 ${dragging ? 'is-dragging' : ''}`}
        aria-busy={!!busy}
        onDragOver={(e) => {
          e.preventDefault()
          if (ready && !busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (ready && !busy) handleFile(e.dataTransfer.files?.[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pcap,.pcapng,.cap,.gz"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {busy ? (
          <div className="flex justify-center py-2">
            <Spinner label={busy} />
          </div>
        ) : (
          <>
            <svg aria-hidden="true" className="mx-auto mb-4 text-accent" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
            </svg>
            <h2 className="font-display text-[23px] sm:text-[28px] leading-relaxed font-semibold mb-2">
              Drop a <span className="capture-format">.pcap</span> or <span className="capture-format">.pcapng</span> file here
            </h2>
            <p className="text-ink-2 text-sm mb-5">Up to 2 GB · .cap and .gz files also supported</p>
            <button
              type="button"
              disabled={!ready}
              onClick={() => inputRef.current?.click()}
              className="capture-choose mb-5"
            >
              Choose a file
            </button>
            <div className="font-mono text-[11px] text-ink-3">
              Each report includes the capture’s SHA-256 hash for evidence tracking.
            </div>
          </>
        )}
      </Card>

      {error && (
        <Notice tone="warn" title="Could not analyse that">
          {error}
        </Notice>
      )}

      {/* -------------------------------------------------- bundled captures */}
      {demos.length > 0 && (
        <div className="mt-8">
          <Label className="mb-1.5">Sample captures</Label>
          <p className="text-[13.5px] text-ink-2 mb-3 max-w-[70ch] leading-relaxed">
            Choose a sample to try the workflow. Each includes a known security issue or a
            correctly encrypted session; the expected grade is shown alongside it.
          </p>
          <div className="grid gap-2.5">
            {demos.map((d) => (
              <button
                key={d.name}
                type="button"
                disabled={!ready || !!busy}
                onClick={() => runDemo(d.name)}
                className="flex items-start gap-3.5 text-left bg-surface border border-line rounded-md px-4 py-3.5 hover:border-line-2 transition-colors disabled:opacity-50 disabled:hover:border-line"
              >
                <GradeBadge grade={d.grade} size="sm" title={`Grades ${d.grade}`} />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="font-medium">{d.title}</span>
                    <span className="font-mono text-[11px] text-ink-3">{d.name}</span>
                  </span>
                  <span className="block text-[13.5px] text-ink-2 mt-1 leading-snug">
                    {d.note}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="text-[12.5px] text-ink-3 mt-3 leading-relaxed">
            Samples are processed by the same analysis engine as your uploaded captures.
          </p>
        </div>
      )}
    </div>
  )
}

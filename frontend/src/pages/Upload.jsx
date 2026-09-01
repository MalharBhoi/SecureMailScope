import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Card, GradeBadge, Label, Notice, Spinner } from '../components/ui'
import { useReport } from '../App'
import {
  adaptBackendCapture,
  analyseDemoCapture,
  getCapture,
  listDemoCaptures,
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

  const show = useCallback(
    async (created) => {
      const detail = await getCapture(created.id)
      if (detail.status === 'FAILED') {
        setError(detail.errorMessage || 'The engine could not analyse that capture.')
        return
      }
      setReport({ report: adaptBackendCapture(detail), id: detail.id })
      navigate(`/report/${detail.id}`)
    },
    [navigate, setReport],
  )

  const handleFile = useCallback(
    async (file) => {
      if (!file) return
      setError(null)
      setBusy(`Analysing ${file.name}…`)
      try {
        await show(await uploadCapture(file, { sync: true }))
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy(null)
      }
    },
    [show],
  )

  const runDemo = useCallback(
    async (name) => {
      setError(null)
      setBusy(`Analysing ${name}…`)
      try {
        await show(await analyseDemoCapture(name))
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy(null)
      }
    },
    [show],
  )

  return (
    <div className="max-w-[900px] mx-auto">
      <div className="mb-7">
        <Label className="text-accent mb-2.5">New analysis</Label>
        <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight m-0">
          Give it a capture. Get back a grade, the evidence, and a fix list.
        </h1>
        <p className="text-ink-2 mt-2.5 max-w-[62ch] leading-relaxed">
          SecureMailScope reads a recorded network file, finds every SMTP, IMAP and POP3
          conversation inside it, and judges how well each one was encrypted. Nothing is
          sent anywhere — the analysis happens entirely on this machine.
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

      {/* -------------------------------------------------- drop zone */}
      <Card
        className={`p-10 text-center transition-colors mt-4 ${
          dragging ? 'border-accent bg-accent-soft' : 'border-dashed border-line-2'
        } ${ready ? '' : 'opacity-60'}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (ready) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (ready) handleFile(e.dataTransfer.files?.[0])
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
            <div className="font-display text-lg font-semibold mb-1.5">
              Drop a .pcap or .pcapng file here
            </div>
            <div className="text-ink-2 text-sm mb-5">
              or{' '}
              <button
                type="button"
                disabled={!ready}
                onClick={() => inputRef.current?.click()}
                className="text-accent underline underline-offset-2 disabled:no-underline disabled:text-ink-3"
              >
                choose a file
              </button>
              {' · '}up to 2 GB{' · '}.gz archives are read directly
            </div>
            <div className="font-mono text-[11px] text-ink-3">
              A SHA-256 hash is taken the moment the file arrives, so the findings can be
              tied back to this exact piece of evidence.
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
          <Label className="mb-1.5">Or analyse a bundled capture</Label>
          <p className="text-[13.5px] text-ink-2 mb-3 max-w-[70ch] leading-relaxed">
            Five captures, worst first, so the whole scale is visible in one sitting. The
            grade shown is the one each earns — a tool that only ever returns failures gives
            you no way to tell a strict grader from a broken one.
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
            These run through the same upload, hash, engine and storage path as a file you
            drop above — a demo of the product, not a recording of one.
          </p>
        </div>
      )}
    </div>
  )
}

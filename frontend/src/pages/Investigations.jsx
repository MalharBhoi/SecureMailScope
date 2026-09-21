import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { listInvestigations, createInvestigation, getInvestigation, compareRuns, listCaptures, saveRemediation } from '../lib/api'
import { Card, Notice } from '../components/ui'
export default function Investigations() {
  const { investigationId } = useParams()
  const [items, setItems] = useState([]), [detail, setDetail] = useState(null), [runs, setRuns] = useState([])
  const [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [before, setBefore] = useState(''), [after, setAfter] = useState(''), [comparison, setComparison] = useState(null)
  async function load() {
    if (investigationId) setDetail(await getInvestigation(investigationId))
    else { const [i, r] = await Promise.all([listInvestigations(), listCaptures()]); setItems(i); setRuns(r) }
  }
  useEffect(() => {
    let alive = true
    setDetail(null); setComparison(null); setBefore(''); setAfter(''); setError('')
    const request = investigationId ? getInvestigation(investigationId) : Promise.all([listInvestigations(), listCaptures()])
    request.then(data => { if (!alive) return; if (investigationId) setDetail(data); else { setItems(data[0]); setRuns(data[1]) } }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [investigationId])
  async function perform(fn) { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  const shownRuns = detail?.runs || runs
  const complete = shownRuns.filter(r => r.status === 'COMPLETED')
  return <div>
    <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
      <div><h1 className="text-2xl font-semibold">{detail?.investigation.name || (investigationId ? 'Loading investigation…' : 'Investigations & analysis history')}</h1><p className="text-sm text-ink-2 mt-2">Keep evidence together, review changes and track remediation.</p></div>
      <Link className="action" to={investigationId ? `/?investigation=${investigationId}` : '/'}>Upload capture</Link>
    </div>
    {error && <Notice tone="warn" title="Request failed">{error}</Notice>}
    {!investigationId && <>
      <form className="flex flex-wrap gap-3 items-end mb-6" onSubmit={e => { e.preventDefault(); perform(async () => { await createInvestigation(name); setName(''); await load() }) }}>
        <label className="text-sm flex-1">New investigation name<input required maxLength={160} className="field mt-2" value={name} onChange={e => setName(e.target.value)} placeholder="Mail infrastructure review" /></label>
        <button className="action" disabled={busy || !name.trim()}>Create investigation</button>
      </form>
      <div className="grid sm:grid-cols-2 gap-3 mb-8">{items.map(i => <Link key={i.id} to={`/investigations/${i.id}`} className="block border border-line bg-surface p-4 rounded text-accent font-medium">{i.name} →</Link>)}</div>
    </>}
    <h2 className="text-lg font-semibold mb-3">Analysis runs</h2>
    <div className="overflow-x-auto mb-6"><table className="w-full text-sm text-left"><thead><tr className="border-b border-line"><th className="p-3">Run / capture</th><th>Status</th><th>Grade</th><th>Uploaded</th><th>Open</th></tr></thead><tbody>
      {shownRuns.map(r => <tr key={r.id} className="border-b border-line"><td className="p-3">#{r.id} · {r.filename}{r.sourceCaptureId && <small className="block text-ink-3">New run from #{r.sourceCaptureId}</small>}</td><td>{r.status.toLowerCase()}</td><td>{r.overallGrade || '—'}</td><td>{new Date(r.uploadedAt).toLocaleString()}</td><td><Link className="text-accent" to={r.status === 'COMPLETED' ? `/report/${r.id}` : `/jobs/${r.id}`}>View →</Link></td></tr>)}
    </tbody></table>{!shownRuns.length && <p className="p-4 text-ink-3">No captures yet. Upload one to start.</p>}</div>
    <button className="action mb-6" disabled={busy} onClick={() => perform(load)}>Refresh history</button>
    {investigationId && <>
      <h2 className="text-lg font-semibold mb-3">Compare captures</h2>
      <form className="flex flex-wrap gap-3 items-end mb-4" onSubmit={e => { e.preventDefault(); perform(async () => setComparison(await compareRuns(investigationId, before, after))) }}>
        {[['Before', before, setBefore], ['After', after, setAfter]].map(([label, value, set]) => <label key={label} className="text-sm flex-1 min-w-[180px]">{label}<select required className="field mt-2" value={value} onChange={e => { set(e.target.value); setComparison(null) }}><option value="">Select completed run</option>{complete.map(r => <option key={r.id} value={r.id}>#{r.id} · {r.filename}</option>)}</select></label>)}
        <button className="action" disabled={busy || !before || !after || before === after}>Compare</button>
      </form>
      {comparison && <div>
        {comparison.caveats.map(c => <p key={c} className="text-sm text-ink-2 mb-2">{c}</p>)}
        <Card className="p-4 my-4"><strong>Coverage comparison</strong><p className="text-sm mt-2">Before: {comparison.beforeCoverage.assessed_checks ?? 'unknown'}/{comparison.beforeCoverage.applicable_checks ?? 'unknown'} checks assessed · After: {comparison.afterCoverage.assessed_checks ?? 'unknown'}/{comparison.afterCoverage.applicable_checks ?? 'unknown'} checks assessed.</p></Card>
        <h3 className="font-medium my-3">Findings & remediation</h3>
        {!comparison.findings.length && <p className="text-sm text-ink-3">No non-informational findings in either run.</p>}
        {comparison.findings.map(f => <Card key={f.key} className="p-4 mb-3"><p className="text-xs text-accent mb-1">{f.state.replaceAll('_', ' ')}</p><h4 className="font-medium">{f.rule} · {f.title}</h4><p className="text-xs text-ink-3 break-all mt-1">{f.key}</p><p className="text-sm text-ink-2 my-2">{f.remediation}</p>
          <label className="text-sm">Analyst status <select className="field mt-2" disabled={busy} value={detail?.remediation.find(r => r.finding_key === f.key)?.status || 'open'} onChange={e => perform(async () => { await saveRemediation(investigationId, f.key, e.target.value); await load() })}><option value="open">Open</option><option value="in_progress">In progress</option><option value="fix_reported">Fix reported by analyst (not verified)</option></select></label>
        </Card>)}
        <h3 className="font-medium my-4">Observed server changes</h3>
        {comparison.servers.map(s => <Card key={s.identity} className="p-4 mb-3"><p className="font-mono text-xs break-all">{s.identity}</p><p className="text-xs text-ink-3 mt-1">{s.match.replaceAll('_', ' ')}</p><div className="grid sm:grid-cols-2 gap-4 mt-3">{[['Before', s.before], ['After', s.after]].map(([label, values]) => <div key={label}><strong className="text-sm">{label}</strong>{Object.entries(values).map(([key, value]) => <p key={key} className="text-xs break-all mt-2"><span className="text-ink-2">{key}: </span>{value.join(', ')}</p>)}{!Object.keys(values).length && <p className="text-sm">Server not observed</p>}</div>)}</div></Card>)}
      </div>}
      <h2 className="text-lg font-semibold mt-8 mb-3">Server observation history</h2>
      <p className="text-sm text-ink-2 mb-3">Latest analysed run per observed identity. Open a report to inspect its historical baseline and supporting evidence.</p>
      {detail?.servers.map(s => <Card key={s.assessment.identity} className="p-4 mb-2"><div className="flex justify-between gap-3 flex-wrap"><strong>{s.assessment.host}:{s.assessment.port}</strong><Link className="text-accent text-sm" to={`/report/${s.captureId}`}>Run #{s.captureId} →</Link></div><p className="text-sm text-ink-2 mt-2">{s.assessment.status.replaceAll('_', ' ')} · {s.assessment.prior_sessions} prior sessions · {s.assessment.prior_captures} prior captures</p><p className="text-xs text-ink-3 mt-1">{s.assessment.identity_confidence.replaceAll('_', ' ')}</p></Card>)}
      <Link className="text-accent inline-block mt-6" to="/investigations">← All investigations</Link>
    </>}
  </div>
}

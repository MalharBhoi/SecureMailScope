# SecureMailScope

**Passive, offline cryptographic posture assessment for SMTP, IMAP and POP3.**

Smart India Hackathon 2026 · Problem Statement **26159** · NTRO

Give it a recorded network capture. It finds every email conversation inside,
judges how well each one was encrypted, grades the servers A–F against published
standards, explains every verdict, and hands you an ordered list of what to fix.

No packet is ever transmitted. No server is ever contacted. It works on archived
evidence and inside an air-gapped facility.

---

## Contents

- [Why this exists](#why-this-exists)
- [Quick start](#quick-start)
- [What it finds](#what-it-finds)
- [Using it](#using-it)
- [How it works, in plain terms](#how-it-works-in-plain-terms)
- [Architecture](#architecture)
- [The analysis, stage by stage](#the-analysis-stage-by-stage)
  - [Reading captures and the capture clock](#reading-captures-and-the-capture-clock)
  - [TCP reassembly](#tcp-reassembly)
  - [Classification and STARTTLS](#classification-and-starttls)
  - [TLS parsing, JA3 and JA4](#tls-parsing-ja3-and-ja4)
  - [Certificates](#certificates)
  - [The rule engine](#the-rule-engine)
  - [Grading — the formulas](#grading--the-formulas)
  - [Server rollup and the fix queue](#server-rollup-and-the-fix-queue)
  - [The model](#the-model)
- [Reporting, API and dashboard](#reporting-api-and-dashboard)
- [Testing](#testing)
- [Bugs worth knowing about](#bugs-worth-knowing-about)
- [What it deliberately does not claim](#what-it-deliberately-does-not-claim)
- [Standards the rules cite](#standards-the-rules-cite)
- [More captures to test with](#more-captures-to-test-with)
- [Troubleshooting](#troubleshooting)

---

## Why this exists

Wireshark shows you packets. It will never tell an administrator *"this cipher is
broken — fix this server first."* Qualys SSL Labs will grade a server, but it has
to connect to it, so it cannot touch a capture file and it knows nothing about
email. Zeek extracts beautiful TLS metadata and has no opinion about any of it.

The gap is an **offline, email-protocol-aware grader**, and that is what this is.

| | SSL Labs / testssl.sh | Zeek / Suricata | **SecureMailScope** |
|---|---|---|---|
| Works from a capture file | ✗ | ✓ | **✓** |
| Grades cryptographic posture | ✓ | ✗ | **✓** |
| Understands STARTTLS | partial | partial | **✓** |
| Detects downgrade attacks | ✗ | ✗ | **✓** |
| Runs air-gapped | ✗ | ✓ | **✓** |

---

## Quick start

One command, if you have Docker:

```bash
docker compose up --build          # http://localhost:8080
```

Or without it:

```bash
./scripts/setup.sh                             # the engine, into .venv
export SMS_PYTHON="$PWD/.venv/bin/python"

cd frontend && npm install && npm run build && cd ..
mvn -f backend/pom.xml -DskipTests package
java -jar backend/target/securemailscope-1.0.0.jar      # http://localhost:8080
```

Then open the page and drop a capture on it, or click one of the bundled ones.
**The web UI is the only interface** — there is no command-line tool to learn and
no separate demo mode to get out of sync with the product.

`scripts/setup.sh` is the same script the Docker image runs, so the two ways of
starting cannot drift apart. The only setting either has is `SMS_PYTHON`, the
interpreter the engine is installed into. There is no engine path and no
`PYTHONPATH`: the engine is an installed package, found by import, so exactly one
copy of it can ever run.

> The `npm run build` matters. Without it the jar has no dashboard in it and
> `:8080` serves nothing; Maven's `bundled-ui` profile activates by itself when
> `frontend/dist/index.html` exists, so there is no flag to remember.

**While changing the dashboard**, run Vite instead of rebuilding the jar each
time:

```bash
java -jar backend/target/securemailscope-1.0.0.jar     # terminal 1
cd frontend && npm run dev                             # terminal 2 → :5173
```

`:5173` proxies the API to `:8080`. Same application; the dev server just
rebuilds as you type.

### Prove it is offline

```bash
docker compose run --rm --no-deps --network none -p 8080:8080 app
```

Use the application normally with no network at all. The cipher registry, rule
base, CA bundle and trained model are baked into the image. There is no runtime
network call to remove, because there was never one to add — the dashboard does
not even load a webfont.

---

## What it finds

Against the six captures in `demo-pcaps/`:

| Capture | Verdict | Why |
|---|---|---|
| `smtp.pcap` | **F** | The server advertised `250-STARTTLS`; the client ignored it and sent `AUTH LOGIN` in the clear anyway |
| `imap.cap` | **F** | Cleartext IMAP `LOGIN` on port 143. STARTTLS was never advertised at all |
| `sample-imf.pcap.gz` | **F** | SMTP submission on port 587 with no TLS and cleartext credentials — an RFC 8314 violation |
| `pop-ssl.pcapng` | **C** | A clean TLS 1.2 STARTTLS upgrade with forward secrecy and AES-256-GCM, capped by a self-signed certificate |
| `smtp-ssl.pcapng` | **C** | Encrypted, but a CBC suite that is not IANA-recommended, and a self-signed certificate |
| `synthetic-imaps-tls13.pcap` | **A+** | IMAPS on 993 with TLS 1.3, X25519 and AES-256-GCM — nothing to fix |

Five are offered as one-click buttons on the front page, worst first — two
failures, two partial passes and one clean result, so the whole scale is visible
in one sitting. A tool that only ever returns failures gives a viewer no way to
tell a strict grader from a broken one. (`sample-imf.pcap.gz` stays in the folder
as a gzip test fixture; it is a third cleartext-SMTP failure saying much the same
thing as `smtp.pcap`.) The grade shown on each button is asserted against the
real analysis by the end-to-end suite, so a button cannot come to disagree with
the engine behind it.

These are real findings from real files — `smtp.pcap` genuinely exposes a working
credential. The last is synthetic and says so, because a passive capture of a
*correctly configured* mail server is the one file nobody publishes; without it
the tool could only ever be demonstrated failing. It is built by
`scripts/make_demo_capture.py`, and its TLS records, handshake messages and
extensions are byte-accurate — the engine parses it exactly as it parses the real
ones.

---

## Using it

Everything happens in the browser.

**Analyse something** — drop a `.pcap`, `.pcapng` or `.pcap.gz` on the front
page, or click a bundled capture. Each button runs the same upload, hash, engine
and storage path as a file you drop in; a SHA-256 is taken on arrival and every
finding is tied to it.

**Dashboard** — the big letter is the worst grade in the capture; the tiles count
what is broken. Below them:

- **Servers, worst first** — ranked by *risk × how much traffic each carried*, so
  the top row is what to fix on Monday, not merely what scored lowest.
- **Fix these, in this order** — grouped by rule, so you see "fix this one thing
  on these four servers" rather than the same advice repeated per session.
- **Sessions** — click any row for detail.

**Session detail** — the two independent failure surfaces side by side: the TLS
handshake (version, cipher, key exchange, forward secrecy, JA3/JA4) and the X.509
certificate (subject, issuer, validity, key, signature). Then every finding with
the NIST or RFC clause it enforces and the frames it came from, the model's
estimate with its TreeSHAP reasoning, and the reconstructed cleartext transcript
with credentials masked.

**Export** — JSON and HTML, both rendered from the stored analysis so they agree.
**Save as PDF** opens the report with `?print=1`, which hands it to the browser's
print dialogue; the page breaks live in the report's own stylesheet, so the result
is the same document on any machine with nothing installed.

### Reading a grade

The letter is rarely the weighted score. `pop-ssl.pcapng` scores **100** on
cryptography and still grades **C**, because a self-signed certificate caps it —
the page says exactly that: *"capped to C by SMS-CERT-003"*. Caps decide grades;
the score is the tiebreaker.

### Three things worth pointing at

- **`smtp.pcap`** — the server offered STARTTLS, the client ignored it, and a real
  password went across in clear. `SMS-STRIP-002` + `SMS-AUTH-001`.
- **`pop-ssl.pcapng`** — the certificate expired in 2025 but the traffic is from
  2015, and the page says **"valid at capture"**. Validity is judged against the
  capture's clock, not today's. A tool that got this wrong would report a
  catastrophe that never happened.
- **`synthetic-imaps-tls13.pcap`** — the one that passes: **A+**. Note what it
  says about the certificate: TLS 1.3 encrypts it, so the rules abstain and say
  so rather than guessing.

---

## How it works, in plain terms

Email moves between programs before it reaches a person, and each hop either
encrypts the conversation or does not. When it does not, everything in the
message — and often the password used to send it — crosses the network in
readable text.

This reads a **recording** of that traffic rather than touching a live server.
Four steps:

1. **Rebuild the conversations.** A capture is a pile of packets; the tool
   reassembles them back into the byte streams the two programs actually
   exchanged.
2. **Work out what each conversation was.** Which email protocol, whether it was
   a person collecting mail or a server relaying it, and whether encryption was
   ever turned on.
3. **Judge the encryption.** Which version, which cipher, whose certificate,
   whether the certificate was trustworthy *at the time the traffic happened*.
4. **Rank what to fix.** Servers ordered by how much damage the weakness could do,
   not alphabetically.

Two things it looks for that a general packet tool will not:

**Encryption that was offered and skipped.** Email usually starts unencrypted and
upgrades with a command called STARTTLS. If a server offers the upgrade and the
client ignores it, everything after is readable — and nothing is technically
"broken", so nothing alerts.

**Encryption that was removed on purpose.** An attacker in the middle can delete
the offer, so neither side knows it was ever available. Because deleting text
changes packet sizes and might be noticed, real attacks *replace* the keyword
with the same number of harmless characters. The tool looks for that shape.

---

## Architecture

```
securemailscope/
├── engine/            Python — all analysis and ML.  145 tests.
│   ├── securemailscope/
│   │   ├── models.py          the frozen data contract
│   │   ├── pcap/              PCAP/PCAPNG readers, link-layer decoding
│   │   ├── net/               TCP reassembly
│   │   ├── classify.py        protocol, role and TLS-mode detection
│   │   ├── analyze/           STARTTLS · TLS · X.509 · ciphers · DNS policy
│   │   ├── features.py        the 18 + 8 feature vector
│   │   ├── scoring/           rule engine · grading · asset rollup
│   │   ├── ml/                dataset · training · prediction · SHAP
│   │   ├── report/            JSON and HTML output
│   │   ├── kb/                rules.yaml, cipher_suites.json  (vendored)
│   │   └── cli.py             the process boundary the backend speaks across
│   └── tests/
├── backend/           Java 17 · Spring Boot 3 · PostgreSQL — API and storage
├── frontend/          React · Vite · Tailwind — the analyst dashboard
├── demo-pcaps/        six captures; five offered as demo buttons (2 F, 2 C, 1 A+)
├── scripts/           setup.sh · verify-e2e.sh · make_demo_capture.py
├── Dockerfile         one image: JVM + engine + dashboard
└── docker-compose.yml
```

### The pipeline

```
capture file
   │
   ├─ ingest ......... SHA-256, format detection, capture clock
   ├─ parse .......... PCAP/PCAPNG → packets → IP/TCP segments
   ├─ reassemble ..... segments → per-direction byte streams + frame index
   ├─ classify ....... protocol · role · TLS mode
   ├─ analyse ........ STARTTLS · TLS handshake · X.509 · DNS policy
   ├─ features ....... 18 core + 8 auxiliary
   ├─ rules .......... clause-traceable findings
   ├─ grade .......... weighted components, then caps
   ├─ ml ............. posture estimate · anomaly · SHAP
   ├─ aggregate ...... sessions → servers → fix queue
   └─ report ......... JSON · HTML (prints to PDF)
```

Everything is a `Session` (`models.py`), and one rule makes the whole thing
testable:

> The **parser** fills observation fields. The **rule engine** fills `findings`
> and `grade`. The **model** fills `ml`. No stage writes another stage's fields.

Each stage is therefore a pure function over a JSON fixture, and no test needs a
packet capture unless it is testing the parser.

Every observation field is optional on purpose. Passive observation is lossy, and
a schema that cannot express *"we could not see this"* forces a lie somewhere.
`cert_visibility` is `observed | encrypted_tls13 | absent`, never a guess.

### Why two languages

The analysis is subtle, bug-prone work that benefits from an exhaustive test
suite and mature cryptographic libraries, so it is Python. The API, persistence
and job handling are ordinary web-application work, so they are Spring Boot. They
meet across exactly one JSON contract — the backend runs

```bash
$SMS_PYTHON -m securemailscope.cli analyse <capture> --json - --compact
```

and parses the single document on stdout; diagnostics go to stderr so stdout
stays machine-clean. Neither half can break the other by changing internals.
Running the analysis out-of-process also contains it: a malformed capture that
crashes a parser takes down a subprocess, not the API.

`securemailscope.cli` is that process boundary, not a user interface — three
commands (`analyse`, `render`, `train`), all of them things the API does.

---

## The analysis, stage by stage

### Reading captures and the capture clock

`pcap/reader.py`, `pcap/layers.py`. Both container formats are implemented
directly — no native dependency, and full control over timestamps.

**Classic PCAP.** The 32-bit magic is `0xa1b2c3d4` written in the *writer's* byte
order, so reading it little-endian tells you both the order and the resolution:

| Bytes read as LE | Meaning |
|---|---|
| `0xa1b2c3d4` | little-endian file, microsecond |
| `0xa1b23c4d` | little-endian file, nanosecond |
| `0xd4c3b2a1` | big-endian file, microsecond |
| `0x4d3cb2a1` | big-endian file, nanosecond |

**PCAPNG.** Block-structured. The per-interface `if_tsresol` option (code 9) gives
the timestamp divisor: with the high bit set the resolution is `2^(v & 0x7f)`,
otherwise `10^v`, defaulting to `10^6`. A reader that assumes microseconds
silently produces wrong times on a nanosecond capture.

```
timestamp = ((ts_high << 32) | ts_low) / divisor
```

**The capture clock** matters more than it looks, because certificate validity is
judged against it. Real captures contain corrupt timestamps — **both pcapng files
in `demo-pcaps/` carry a frame dated 2063.** Taking `max(timestamp)` as the
capture time would place the analysis 37 years in the future and expire every
certificate in it. So the reader takes a **median** and treats anything more than
a year away as corrupt:

```
median      = median(all packet timestamps)
suspect(t)  = |t − median| > 31 536 000 s
first, last = min, max over the non-suspect packets
```

A session whose own first frame is suspect falls back to the median and is
flagged `capture_time_suspect`, which surfaces as a warning in the report.

**Link layer.** DLT 0 (loopback), 1 (Ethernet, with arbitrarily stacked 802.1Q /
QinQ tags), 12/101 (raw IP), 113 (Linux SLL), 276 (SLL2), 228/229 (IPv4/IPv6).
IPv6 extension headers are walked to reach TCP. Non-first fragments are skipped —
they carry no TCP header. ICMP-encapsulated TCP headers are *not* segments and
are never reassembled; `smtp.pcap` contains four, and a reader that took them
would corrupt the stream.

### TCP reassembly

`net/reassembly.py`. Streams are keyed by the sorted endpoint pair. The client is
whoever sent the SYN without ACK; failing that (a capture beginning mid-session)
the first talker.

Sequence arithmetic is done in signed 32-bit modular space, so wraparound is not
a special case:

```
seq_delta(a, b) = ((a − b) mod 2³²) − 2³²   if that value ≥ 2³¹
                  (a − b) mod 2³²           otherwise
```

Each direction assembles into a flat buffer:

- `offset = seq_delta(segment.seq, base_seq)`, where `base_seq` is the SYN's
  sequence number + 1 (SYN consumes one number), or the lowest sequence seen.
- A negative offset means the capture began mid-stream; the base is **re-based**
  backwards and all placed chunks shift.
- **First write wins** on overlap, matching how most stacks behave, so a
  retransmission with different content cannot rewrite history.
- Unfilled ranges are recorded as `gaps`, so a downstream stage knows the stream
  is incomplete instead of reading zero bytes as data.

Alongside the bytes, a **frame index** maps byte offsets back to packet numbers.
That is what lets every finding cite frames — a claim in the report always points
at packets in the evidence.

### Classification and STARTTLS

`classify.py`, `analyze/starttls.py`.

**Protocol** comes from payload signatures first and the port only as a fallback
for sessions with no readable cleartext. Ports are a hint, never the decision:
`imap.cap` contains two DCE/RPC conversations on port 1065 which must not be
graded as email, and they are correctly excluded.

**Role** decides which rulebook applies, and is the nuance most tools miss:

| Role | Ports | Rulebook |
|---|---|---|
| `submission_access` | 587, 465, 143, 993, 110, 995 | RFC 8314 — cleartext is obsolete, graded strictly |
| `mta_relay` | 25 | RFC 7435 — opportunistic TLS is correct; cleartext is an *exposure*, not a misconfiguration |

Grading a port-25 relay hop as a critical failure for cleartext is technically
wrong, and a reviewer will know it. The same observation therefore yields
`SMS-PROTO-003` (critical) on submission and `SMS-PROTO-004` (high) on relay.

**Capability parsing.** SMTP's EHLO reply is a run of `250-KEYWORD` lines closed
by `250 KEYWORD`; per RFC 5321 §4.1.1.1 the *first* line is the server's domain
greeting, not a keyword, and counting it would enter `MAIL.EXAMPLE.COM` into the
capability list. IMAP uses `* CAPABILITY …` or a `[CAPABILITY …]` response code.
POP3 uses the CAPA listing, terminated by a lone `.`.

The line budget is applied **per direction**. It was originally shared, and a
14 KB message body on the client side consumed the whole allowance before the
server's `250-STARTTLS` line was reached — so a server that *did* advertise
STARTTLS was reported as not advertising it.

**Downgrade detection.** An attacker who removes STARTTLS wants packet sizes
unchanged, so the keyword is replaced with a string of the same length. Detection
is deliberately conservative: a capability token is only called mangled when it
occupies the STARTTLS slot, has the same length, and is not a plausible keyword.
`imap.cap` contains `LITERAL+`, a real IMAP capability, and an earlier version
flagged it as an attack — the predicate now allows `=+./*` in keywords and keeps
a list of substitutions observed in the wild (`XXXXXXXX`, `STAR`, `TTLS`), with a
regression test pinning it.

### TLS parsing, JA3 and JA4

`analyze/tls.py`.

**Finding the handshake.** For STARTTLS the records begin partway through the
stream. `find_tls_start()` scans for a plausible record header — content type in
20–23, version in `0x0300`–`0x0304`, sane length — and requires **two chained
records** before accepting it. A single-header match would fire on random bytes
inside a MIME attachment.

**Defragmentation.** Handshake messages are reassembled across records, stopping
at the first ChangeCipherSpec: everything after it is ciphertext. An earlier
version parsed those encrypted records as alerts and reported "alert level 143",
which is not a value that exists.

**Key-exchange strength.** For ECDHE the named group is read from the
ServerKeyExchange and mapped to a symmetric-equivalent strength per NIST SP
800-57 Part 1 Rev 5 Table 2 (`secp256r1`/`x25519` → 3072, `secp384r1` → 7680,
`secp521r1` → 15360). For plain DHE the prime's length is measured from the wire.
Failing both, the certificate's key size stands in.

**TLS 1.3 sends no ServerKeyExchange**, so the agreed group appears only in the
ServerHello's `key_share` extension. Both shapes of that extension start with the
group (ServerHello sends `{group, length, key_exchange}`; HelloRetryRequest names
the group alone), so reading the first two bytes covers both.

**Cipher properties are derived, not tabulated.** Only the IANA id → name map is
vendored (`kb/cipher_suites.json`); key exchange, authentication, bulk cipher, key
size, mode, AEAD status and forward secrecy are parsed out of the name, which is
fully self-describing. That keeps the knowledge base small and removes a class of
transcription error. 3DES is recorded at its **effective** 112-bit strength, not
its nominal 168.

**JA3** — `MD5(version,ciphers,extensions,groups,ec_point_formats)` with GREASE
values (RFC 8701) excluded.

**JA4** — `q|t · version · d|i · ciphercount · extcount · alpn _ sha256(sorted
ciphers)[:12] _ sha256(sorted extensions + sigalgs)[:12]`. Sorting is the point:
it is what makes JA4 resistant to the extension-order randomisation that made JA3
evadable. SNI and ALPN are excluded from the extension hash by spec.

### Certificates

`analyze/certs.py`. **The single most consequential correctness decision in the
tool.**

A forensic analyser works on old evidence. Comparing `not_valid_after` against
`datetime.now()` reports every certificate in a 2015 capture as expired, makes
every finding wrong, and destroys the tool's value for exactly the archival work
that justifies it. So validity is judged against the frame that carried the
handshake:

```
expired_at_capture   = capture_time > not_valid_after
not_yet_valid        = capture_time < not_valid_before
days_to_expiry       = (not_valid_after − capture_time).days     # signed
expired_now          = now() > not_valid_after                   # reported separately
```

Both are reported, because they are different findings:

- `expired_at_capture` — the operator was serving a dead certificate. **An incident.**
- `expired_now` — it has lapsed since. **Housekeeping.**

Both certificates in the demo captures were valid when recorded in 2015 and have
expired since. A naive tool emits two false criticals there; this one emits none,
and a test pins that.

**Chain building.** Self-signed is detected structurally *and* cryptographically
(issuer == subject **and** the signature verifies with its own key). Otherwise the
path is built from the presented intermediates, then the trust store (`certifi`,
a vendored Mozilla root bundle — no network), verifying each signature in turn.
Failure modes are distinguished: a missing issuer, a signature mismatch, an
untrusted root and a genuine loop produce different messages, because "the server
did not send its intermediate" and "this certificate is forged" are not the same
problem.

**Hostname matching** follows RFC 6125 §6.4.3: a wildcard matches exactly one
left-most label, so `*.example.com` matches `mail.example.com` but not
`a.b.example.com`. With no SNI and no DNS name available, `name_match` is `None` —
unknown, never reported as a failure.

**Revocation.** Offline there is no responder to query. If the server stapled an
OCSP response into the handshake, the answer is already in the capture and is
parsed. Otherwise `unknown_offline` — never assumed good.

### The rule engine

`scoring/rules.py`, `kb/rules.yaml`. **32 rules, 27 of them carrying a grade cap.**

Rules are data, not code. Each names the clause it enforces, the severity, the
remediation and an optional cap:

```yaml
- id: SMS-CIPH-002
  title: "Broken bulk cipher negotiated"
  severity: critical
  cap_grade: F
  standard: "NIST SP 800-52r2 §3.3.1; RFC 7465 (RC4 prohibited)"
  remediation: "Remove RC4, DES, IDEA and RC2 from the server's cipher list."
  applies_to: [submission_access, mta_relay]
  condition:
    all:
      - {field: encrypted, eq: true}
      - {field: cipher_broken, eq: true}
```

A `Session` is flattened into a namespace of ~40 facts, and the condition
language is deliberately tiny — `all` / `any` / `not` over field predicates
(`eq`, `in`, `lt`, `gt`, `lte`, `gte`). It is not a general expression language
and it never evaluates arbitrary code, so the rule base stays inspectable data
rather than becoming a plugin system.

By construction these findings have **no false positives**: "TLS 1.0 was
negotiated" is a direct read of an observed field, not a prediction. If a rule
fires, the condition was true in the capture.

### Grading — the formulas

`scoring/grade.py`, adapted from the published Qualys SSL Server Rating Guide.

**Protocol** (the version actually negotiated):

| Version | Score |
|---|---|
| SSL 2.0 | 0 |
| SSL 3.0 | 80 |
| TLS 1.0 | 90 |
| TLS 1.1 | 95 |
| TLS 1.2 | 100 |
| TLS 1.3 | 100 |

**Key exchange** (bits, or symmetric-equivalent for elliptic curves):

| Condition | Score |
|---|---|
| anonymous or export-grade | 0 |
| < 512 | 20 |
| < 1024 | 40 |
| < 2048 | 80 |
| < 4096 | 90 |
| ≥ 4096 | 100 |

**Cipher strength** (symmetric key size):

| Bits | Score |
|---|---|
| 0 | 0 |
| < 128 | 20 |
| < 256 | 80 |
| ≥ 256 | 100 |

The weighted score:

```
raw = 0.30 × protocol + 0.30 × key_exchange + 0.40 × cipher
```

with one override from the rating guide — **a zero in any category forces the
whole score to zero**:

```
if protocol == 0 or key_exchange == 0 or cipher == 0:
    raw = 0
```

Bands: `A ≥ 80`, `B ≥ 65`, `C ≥ 50`, `D ≥ 35`, `E ≥ 20`, `F` below.

#### The caps are what actually decide the grade

Work the example. TLS 1.0, `RSA_WITH_RC4_128_SHA`, self-signed RSA-1024 with a
SHA-1 signature, expired:

```
protocol      TLS 1.0    →  90 × 0.30 = 27.0
key exchange  RSA-1024   →  80 × 0.30 = 24.0     (band "< 2048")
cipher        RC4-128    →  80 × 0.40 = 32.0     (band "< 256")
                                  raw = 83  →  band "A"
```

**An expired, self-signed, RC4-over-TLS-1.0 session comes out of the weighted
average as an A.** That is not a defect in this implementation — it is how the
published methodology behaves, which is why the rating guide spends more space on
caps than on the tables.

Each fired finding may impose a ceiling; the **lowest ceiling wins**:

```
letter = band_for(raw)
for finding in findings:
    if finding.cap_grade < letter:      # ladder: F < E < D < C < B < A < A+
        letter    = finding.cap_grade
        capped_by = finding.rule_id
```

Here six rules fire and the session lands at **F**, capped by `SMS-CIPH-002`.
Both numbers are reported. A reviewer who knows SSL Labs will ask how an F
session scores 83; answering *"because caps override the average — here is the
cap that fired and the clause behind it"* shows the methodology was implemented
rather than copied. There is a test asserting exactly this arithmetic.

Selected caps:

| Rule | Condition | Cap |
|---|---|---|
| `SMS-STRIP-001` | STARTTLS capability stripped | F |
| `SMS-AUTH-001` | credentials in cleartext | F |
| `SMS-CIPH-002` | RC4 / DES / RC2 / IDEA | F |
| `SMS-CIPH-003` | export-grade suite | F |
| `SMS-CERT-001` | expired **at capture time** | F |
| `SMS-KEY-001` | key < 1024 bits | F |
| `SMS-POL-001` | MTA-STS published, session cleartext | F |
| `SMS-PROTO-001` | TLS 1.0 / 1.1 | C |
| `SMS-CERT-003` | self-signed | C |
| `SMS-CERT-005` | SHA-1 signature | C |
| `SMS-KEY-002` | key 1024–2047 bits | C |
| `SMS-CIPH-004` | 64-bit block cipher (Sweet32) | C |
| `SMS-FS-001` | no forward secrecy | B |
| `SMS-CIPH-005` | non-AEAD mode | B |

**A+** requires a trusted chain, TLS 1.2 or 1.3, forward secrecy, an AEAD cipher
that IANA recommends, and nothing at medium severity or above.

**Trust** is tracked separately from the letter. SSL Labs collapses a chain
problem into `T`; this keeps the letter and exposes `trusted: false` alongside,
because "the crypto is strong but nobody vouches for this server" is more useful
in a report than one overloaded symbol.

### Server rollup and the fix queue

`scoring/aggregate.py`. The problem statement asks for the posture of an *email
infrastructure*, not a list of connections. A capture with 400 connections to one
server produces 400 identical rows, and nobody can act on that.

Sessions group by `server:port`. Protocol score uses the published SSL Labs rule
for multiple observations; key exchange and cipher take the worst seen, because a
server that will negotiate a weak suite with anyone is as weak as that suite:

```
protocol     = (best_observed + worst_observed) / 2
key_exchange = min over sessions
cipher       = min over sessions
```

Grouping also surfaces a finding no single session can express: a server that
negotiated TLS 1.3 with one client and TLS 1.0 with another is permissively
configured, and that spread is a downgrade opportunity (`version_spread`).

Two servers can both grade F; the one carrying 400 authenticated submissions is
the one to fix on Monday:

```
risk     = Σ severity_weight(finding)    critical 40 · high 15 · medium 5 · low 1
reach    = 1 + 0.25 × (sessions − 1) + 0.5 × (distinct_clients − 1)
exposure = risk × reach + (50 if credentials_exposed else 0)
```

The remediation plan groups by rule, ordered by severity then summed exposure.

### The model

`features.py`, `ml/`. **The model never decides a verdict.** Every finding and
every grade comes from the deterministic rule engine; the model adds an estimate
where the rules must abstain, plus anomaly surfacing and an explanation.

**Missingness is encoded, never imputed.** `-1` means "a passive observer could
not see this", and that is one of the most informative signals available.
Imputing a plausible value destroys it.

**Seven of the eighteen core features vanish on TLS 1.3** — `cert_key_bits`,
`cert_key_algo`, `cert_sig_hash`, `cert_days_to_expiry`, `cert_self_signed`,
`chain_valid`, `name_match`. That table *is* the argument for having a model at
all: the rules need those fields and correctly abstain without them, while a
model trained across configurations can still estimate posture from handshake
metadata alone.

**Labels come from the generating server configuration, never from the rule
engine.** A model trained on rule output would be an expensive re-implementation
of the rules that agrees with them by construction and proves nothing. A test
asserts the dataset module never imports the scoring package.

**Evaluation** uses `GroupKFold` with the configuration as the group, so no
session from a configuration appears on both sides of a split. A plain random
split leaks and produces the fake 99% that makes a reviewer stop believing the
rest of the report.

Current figures (2 080 samples, 260 configurations, 5 folds):

```
macro-F1  0.804 ± 0.046          accuracy  0.852      (majority baseline 0.561)

                 precision  recall     F1   support
  critical           0.970   0.866  0.915      1168
  vulnerable         0.804   0.798  0.801       272
  weak               0.678   0.649  0.663       208
  secure             0.720   0.947  0.818       432
```

**The split that carries the argument:**

| | accuracy | macro-F1 | baseline | n |
|---|---|---|---|---|
| certificate visible | **0.928** | 0.871 | 0.591 | 1 536 |
| certificate masked (TLS 1.3) | **0.640** | 0.629 | 0.480 | 544 |

That gap is not a weakness to hide — it *quantifies what a passive sensor loses
on modern traffic*. The model beats the majority baseline in both regimes, and
the masked column is precisely the population where the rule engine abstains.
Anything near 1.00 would mean a leak, not a triumph.

**Anomaly detection** is an IsolationForest refit **per capture** on that
capture's own sessions, so "unusual" means unusual *here*. It answers a question
the rules cannot phrase: *"23 sessions to this server negotiated TLS 1.3 and one
negotiated TLS 1.0 — why?"* It is suppressed below 8 sessions: one session is not
a population, and calling it an outlier would be meaningless.

**Attribution** is TreeSHAP, exact per-feature contributions toward the predicted
class, rendered as a diverging bar chart with a colourblind-safe pair. A forensic
verdict that cannot be explained is worthless in an investigation.

`MLVerdict` carries two numbers that answer different questions:
`class_probabilities[risk_class]` is how sure the model is of the class it named;
`risk_score` is **P(critical)** whatever class was predicted. They can be far
apart — on `pop-ssl.pcapng` the model says weak with probability 0.73 while
P(critical) is 0.038.

**Honest limitation.** The training data is synthesised at the *feature* level
rather than captured from live Postfix/Dovecot instances, so it does not
reproduce correlations that only emerge from real server behaviour. Retraining on
real captures is a drop-in replacement.

---

## Reporting, API and dashboard

One Jinja2 template produces the self-contained HTML report; JSON comes from the
same objects. Writing the layout once is why they stay consistent.

```
GET /api/health                              status, engine, python, interpreter
GET /api/demo-captures                       the bundled set, with expected grades
POST /api/captures            multipart      upload and analyse
POST /api/captures/demo/{name}               analyse a bundled capture
GET /api/captures/{id}                       full detail for the dashboard
GET /api/captures/{id}/report.json           stored document, byte-for-byte
GET /api/captures/{id}/report.html           rendered from that stored document
GET /api/captures/{id}/report.html?print=1   the same page, printing itself
```

The rendered HTML comes from the **persisted** report rather than a re-analysis.
Re-running the engine would be easy and wrong: a newer engine can produce
different findings from the same evidence, so a document handed to someone could
disagree with the JSON on record.

The full engine document is stored verbatim in `report_json`, with normalised
`capture` / `mail_session` / `finding` / `asset` tables beside it so the dashboard
can sort and filter in SQL. Flyway owns the schema in portable ANSI SQL, so the
same migration runs on PostgreSQL and on H2 in PostgreSQL-compatibility mode —
tests exercise the real schema, not an ORM-generated approximation.

The dashboard loads **no webfont and no CDN asset**. A stylesheet link to a font
host is an outbound request like any other; it would make the air-gapped claim
untrue. Severity is never encoded by colour alone — every status colour ships
with its name, and the SHAP chart's diverging pair passes lightness-band,
chroma-floor, CVD-separation (ΔE 23 under protanopia) and 3:1 contrast checks in
both themes.

---

## Testing

**145 engine tests**, about 9 seconds, no network, no database.

| File | Covers |
|---|---|
| `test_capture_reading.py` | PCAP/PCAPNG/gzip parsing, packet counts against tshark ground truth, corrupt-timestamp handling, ICMP exclusion, reassembly (out-of-order, retransmission, overlap, gaps, wraparound), frame index, link-layer edge cases |
| `test_starttls_and_tls.py` | Capability parsing, downgrade variants, the `LITERAL+` false-positive regression, credential extraction and redaction, TLS record/handshake parsing, JA3/JA4, cipher property derivation |
| `test_certificates.py` | Capture-clock validity, self-signed detection, chain failure modes, wildcard matching per RFC 6125, revocation defaults, a real SHA-1/RSA-1024 fixture |
| `test_grading.py` | Every component table value, the 83 → F worked example, lowest-cap-wins, zero-category, A+ conditions |
| `test_ml.py` | Label ladder, that the dataset never imports the rule engine, TLS 1.3 masking, feature encoding, that grouped CV scores below a random split, that the model never mutates a verdict, and that a scikit-learn version mismatch is refused rather than silently used |
| `test_end_to_end.py` | Golden expectations for all six demo captures, that the knowledge base is a regular package and not a namespace one, evidence completeness, report rendering, and that no password appears in rendered output |
| `test_cli_subprocess.py` | The engine's process boundary in a clean interpreter — the exact invocations the backend makes, including that it exposes nothing beyond them |

```bash
export SMS_PYTHON="$PWD/.venv/bin/python"

"$SMS_PYTHON" -m pytest engine/tests -q     # 145 engine tests
mvn -f backend/pom.xml test                 # backend integration tests
./scripts/verify-e2e.sh                     # 61 checks against the real stack
```

`verify-e2e.sh` starts the packaged jar, pushes every bundled capture through the
REST API and asserts the persisted results — grades, cap rules, role
classification, capture-clock certificate validity, gzip handling, non-email
exclusion, static routing, export rendering and credential redaction. **Nothing
is mocked**: the Java half runs the Python engine as a subprocess exactly as it
does in production, so it is the check that proves the two halves agree about the
contract between them.

### Why `test_cli_subprocess.py` exists

Every other test imports the engine into the pytest process, and that hid a whole
class of bug. `certs.py` once reached a submodule through
`__import__("cryptography").hazmat.primitives.serialization`, which only resolves
if something else has already imported that submodule. Under pytest something
always had — `test_certificates.py` imports `serialization` itself — so **the
suite passed while a bare `securemailscope.cli` run crashed on every capture
containing a certificate.** The tests were green for the wrong reason.

---

## Bugs worth knowing about

Kept here because each one changed a design decision, and because they are the
honest record of how the thing was built.

**A perfect TLS 1.3 session graded F.** TLS 1.3 sends no ServerKeyExchange, so
the negotiated group lives only in the ServerHello `key_share` extension — which
went unparsed. `kex_bits` stayed `None`, the key-exchange component scored 0, and
the zero-in-any-category rule drove raw to 0.0. X25519, AES-256-GCM, forward
secrecy, not one finding above `info`, graded the same as cleartext with a
password in it. It failed through the *scoring* path rather than the rule path,
so there was no finding to explain it, and no demo capture exercised the passing
path — which is why `synthetic-imaps-tls13.pcap` now exists.

**The engine died on Python 3.9 only.** `securemailscope/kb/` had no
`__init__.py`, making it a *namespace* package whose spec has `origin is None`.
Python 3.9 resolves `importlib.resources.files(pkg)` as
`pathlib.Path(spec.origin).parent` → `TypeError: expected str, bytes or
os.PathLike object, not NoneType`. Python 3.10+ handles it, so the container was
fine and a Mac was not, on byte-identical code. The knowledge base is a regular
package now and its files are located relative to `__file__`; `/api/health`
reports the Python version for exactly this reason.

**Two copies of the engine.** `sms.engine.path` was pushed onto `PYTHONPATH` and
used as the subprocess working directory so the engine could run "straight from a
checkout". The Docker image then carried the engine twice — once installed in a
virtualenv, once on `PYTHONPATH` — and which copy executed depended on the
working directory. A model trained into one was invisible to the other. There is
now one installation procedure, `scripts/setup.sh`, which the Docker image runs.

**A demo that was a different program.** The dashboard used to fall back to
pre-generated JSON in `public/samples/` when no backend was reachable. Two code
paths through the same screens, and they drifted: exports worked in one and not
the other. A demo that does not exercise the real path is not a demo of the
product.

**A PDF button that could never work.** `GET /report.pdf` rendered through
WeasyPrint, which needs Pango and cairo — native libraries `apt-get` installs in
a container and a Mac generally does not have. `setup.sh` never installed the
extra in either mode, so **no deployment ever had it**, and the button was
`<a href="…" download>`, which makes the browser discard the response body: the
carefully written 501 explanation was thrown away and Chrome said *"this site
can't be reached"*. Worse, the end-to-end check asserted the server returned
helpful text — which it did — while missing that a human clicking the button saw
nothing. A test that confirms an error path returns good text is not a test that
the text reaches anybody. PDF is now the browser printing the report.

**SPA routing swallowing real files.** Deep linking was a view controller
forwarding every dotless path to `index.html`. View-controller mappings sit at
order 1 and static resource handling at `Integer.MAX_VALUE - 1`, so the forward
won against files that existed. `/samples/smtp.json` came back as **HTTP 200 with
an HTML document**, and the 200 defeated every `res.ok` check on the client.
Routing is now a `PathResourceResolver` that serves a real file when it exists and
404s a missing one.

---

## What it deliberately does not claim

- **Grades describe observed sessions, not server capability.** An active scanner
  probes every option a server supports; a passive tool sees only what was
  negotiated. Server grades combine the best and worst observation, following the
  published Qualys methodology, but they do not describe the full capability
  surface.
- **TLS 1.3 hides certificates.** RFC 8446 §4.4 encrypts the Certificate message,
  so certificate checks cannot run on a TLS 1.3 session. Those are marked
  `encrypted_tls13` and carry no certificate findings — a property of the
  protocol, not a gap in the tool.
- **Revocation is only checked when stapled.** Offline there is no responder to
  ask. Unchecked is reported as `unknown_offline`, never assumed good.
- **The model never decides a verdict.** Every finding comes from the
  deterministic rule engine.
- **Reassembly is forensic, not IDS-grade.** It handles what real captures
  contain; it does not model OS-specific overlap policies, which only matter
  against an attacker actively trying to desynchronise a monitor.
- **Credentials are never stored.** An exposed password is recorded as a SHA-256
  so reuse can be correlated without the report becoming a second copy of the
  leak; usernames are masked and transcripts redacted. A test asserts no password
  appears in rendered output.

---

## Standards the rules cite

Every finding names the clause it enforces.

| Standard | Used for |
|---|---|
| NIST SP 800-52r2 | TLS version and cipher requirements |
| NIST SP 800-57 Part 1 Rev 5 | Key-strength equivalences |
| RFC 8446 | TLS 1.3, including why certificates are unreadable |
| RFC 8314 | TLS for submission and access — cleartext is obsolete |
| RFC 7435 | Opportunistic security for relay hops |
| RFC 7465 | RC4 prohibited |
| RFC 6125 | Hostname verification and wildcard matching |
| RFC 5280 | Certificate validity and path building |
| RFC 8461 / 8460 | MTA-STS and TLS-RPT policy cross-reference |
| RFC 6698 | DANE / TLSA |
| RFC 8701 | GREASE, excluded from fingerprints |
| Qualys SSL Server Rating Guide | The grading methodology and its caps |
| Durumeric et al., IMC 2015 | Measured STARTTLS stripping in the wild |

---

## More captures to test with

**Wireshark's sample captures** — the canonical set, and where three of the
bundled captures came from:

```bash
B=https://wiki.wireshark.org/uploads/__moin_import__/attachments/SampleCaptures
curl -fLO $B/sample-TNEF.pcap.gz        # TNEF attachments over SMTP/IMF
```

The wiki also carries plenty of non-email TLS captures. Those are worth running
too — the tool should find **nothing** in them and say so, rather than inventing
findings.

| Source | URL | Good for |
|---|---|---|
| The Ultimate PCAP | <https://weberblog.net/the-ultimate-pcap/> | 80+ protocols in one file — mostly *not* email, so it tests correct exclusion |
| Malware-Traffic-Analysis | <https://www.malware-traffic-analysis.net/training-exercises.html> | Real intrusion traffic with an email stage. ZIPs, password `infected` |
| Netresec index | <https://www.netresec.com/?page=PcapFiles> | A curated index of nearly every public collection |
| Chris Sanders | <https://github.com/chrissanders/packets> | Small, clean, protocol-per-file |

**Recording your own** is the most useful, because you control the server
configuration and therefore know the right answer in advance:

```bash
sudo tcpdump -i any -s 0 -w mine.pcap \
  'tcp port 25 or 465 or 587 or 110 or 143 or 993 or 995'

openssl s_client -connect imap.gmail.com:993 -servername imap.gmail.com
openssl s_client -starttls smtp -connect smtp.gmail.com:587
openssl s_client -tls1_2 -cipher 'ECDHE-RSA-AES128-SHA' -connect imap.gmail.com:993
```

On macOS use `-i en0` rather than `-i any`. Stop with Ctrl-C, then drop
`mine.pcap` on the front page.

**Building the A+ capture yourself.** `scripts/make_demo_capture.py` regenerates
`synthetic-imaps-tls13.pcap` with no network at all (`--no-fetch`). It can also
produce a TLS 1.2 capture carrying a **real public certificate chain**, fetched
live from the host you name — the only way to exercise chain building all the way
to a Mozilla root, since both bundled encrypted captures use self-signed
certificates. That needs a network without TLS interception; the script validates
the chain with the engine's own validator and **refuses to write the file** if it
does not reach a public root, rather than shipping a "well-configured server"
demo whose chain does not validate.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| The page says **The API is not running** | Start it: `docker compose up`, or `java -jar backend/target/securemailscope-1.0.0.jar` from the project root |
| The page says **cannot reach the analysis engine** | The engine is not installed in the interpreter the service uses. `./scripts/setup.sh`, then `export SMS_PYTHON="$PWD/.venv/bin/python"` and restart. The on-screen message carries the same instruction |
| `/api/health` says `DEGRADED` | Same cause; its `error` and `hint` fields name it exactly |
| `:8080` shows nothing | The jar has no dashboard in it. `cd frontend && npm run build`, then rebuild the jar — the `bundled-ui` Maven profile picks it up automatically |
| One run mode works and the other does not | `curl -s localhost:8080/api/health` reports `python` and `interpreter`. Docker uses Python 3.10; a Mac may hand you 3.9, and that difference is usually the answer |
| **Save as PDF** does nothing | Your browser blocked the pop-up. Allow pop-ups for this site, or use **Open HTML** and press Ctrl-P / Cmd-P — same result |
| *"Model stage skipped"* in a report | Not a bug. Grades and findings are complete; only the advisory model estimate is missing. Re-run `./scripts/setup.sh` without `--no-ml` |
| `scikit-learn` / `shap` will not build | Python 3.9 is too old for current wheels. `./scripts/setup.sh --no-ml` — everything except the advisory model still works — or install a newer Python |
| `mvn` cannot reach the network | Use a local cache: `mvn -o -Dmaven.repo.local=$PWD/.m2repo …` |
| Port already in use | `--server.port=8081` |

---

## Licence

Apache-2.0. The vendored knowledge base (`engine/securemailscope/kb/`) is derived
from the IANA TLS Cipher Suite registry; the CA bundle comes from `certifi`.

"""
The analysis pipeline: capture file in, Report out.

Stage order mirrors the architecture exactly, and each stage only writes the
fields it owns:

    ingest -> parse -> reassemble -> classify -> analyse -> features
           -> rules -> grade -> ml -> aggregate -> report
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import Optional

from .analyze import certs as certmod
from .analyze import dnspolicy, starttls, tls
from .analyze.ciphers import group_strength_bits, properties, suite_name
from .classify import classify_mode, classify_protocol, classify_role, is_email_stream
from .features import extract as extract_features
from .models import (
    CaptureInfo,
    CertVisibility,
    Confidence,
    Endpoint,
    Protocol,
    Report,
    Session,
    Severity,
    TlsMode,
)
from .net.reassembly import TcpStream, reassemble
from .pcap.reader import CaptureReader, epoch_to_datetime
from .scoring.aggregate import build_assets, overall, remediation_plan
from .scoring.grade import grade_session
from .scoring.rules import apply_rules


def file_sha256(path: str, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def analyse_capture(
    path: str,
    run_ml: bool = True,
    model_path: Optional[str] = None,
) -> Report:
    reader = CaptureReader(path)
    meta = reader.meta

    capture = CaptureInfo(
        filename=os.path.basename(path),
        sha256=file_sha256(path),
        bytes=os.path.getsize(path),
        format=meta.format,
        packet_count=meta.packet_count,
        first_packet_time=epoch_to_datetime(meta.first_time),
        last_packet_time=epoch_to_datetime(meta.last_time),
        median_packet_time=epoch_to_datetime(meta.median_time),
        suspect_timestamps=meta.suspect_timestamps,
        link_types=[str(t) for t in meta.link_types],
        truncated_packets=meta.truncated_packets,
    )

    warnings: list[str] = []
    if meta.suspect_timestamps:
        warnings.append(
            f"{meta.suspect_timestamps} packet(s) carry a timestamp far outside the "
            f"capture's range and were excluded from the capture clock. Certificate "
            f"validity was judged against the median capture time."
        )
    if meta.truncated_packets:
        warnings.append(
            f"{meta.truncated_packets} packet(s) were truncated by the capture "
            f"snaplen; some payload was not recorded."
        )

    policy = dnspolicy.collect(reader.udp_datagrams())
    streams = reassemble(reader.tcp_segments())

    sessions: list[Session] = []
    for st in streams:
        session = _build_session(st, reader, capture.sha256, policy)
        if session is None:
            continue
        sessions.append(session)

    # --- deterministic scoring ------------------------------------------
    for s in sessions:
        s.features = extract_features(s)
        s.findings = apply_rules(s)
        s.grade = grade_session(s, s.findings)

    # --- ML layer (optional, never decides a verdict) --------------------
    if run_ml and sessions:
        try:
            from .ml.predict import annotate

            annotate(sessions, model_path=model_path)
        except ImportError as exc:
            warnings.append(
                f"Model stage skipped — {exc}. Install the optional model layer with "
                f"`pip install 'securemailscope[ml]'`. Every finding and grade above "
                f"comes from the rule engine and is unaffected."
            )
        except Exception as exc:  # advisory only; never fail the analysis
            warnings.append(f"Model stage skipped — {exc}")

    assets = build_assets(sessions)
    letter, score = overall(assets)

    counts = {
        "sessions": len(sessions),
        "assets": len(assets),
        "critical": sum(1 for s in sessions for f in s.findings if f.severity == Severity.CRITICAL),
        "high": sum(1 for s in sessions for f in s.findings if f.severity == Severity.HIGH),
        "medium": sum(1 for s in sessions for f in s.findings if f.severity == Severity.MEDIUM),
        "low": sum(1 for s in sessions for f in s.findings if f.severity == Severity.LOW),
        "encrypted_sessions": sum(1 for s in sessions if s.encrypted),
        "cleartext_sessions": sum(1 for s in sessions if not s.encrypted),
        "credentials_exposed": sum(1 for s in sessions if s.cleartext_auth),
        "anomalies": sum(1 for s in sessions if s.ml and s.ml.anomaly),
    }

    return Report(
        capture=capture,
        sessions=sessions,
        assets=assets,
        overall_grade=letter,
        overall_score=score,
        counts=counts,
        remediation=remediation_plan(assets),
        warnings=warnings,
    )


# --------------------------------------------------------------------------

def _build_session(
    st: TcpStream,
    reader: CaptureReader,
    capture_hash: str,
    policy: dnspolicy.DnsPolicy,
) -> Optional[Session]:
    c_data = st.client_to_server.data
    s_data = st.server_to_client.data

    tls_c = tls.find_tls_start(c_data)
    tls_s = tls.find_tls_start(s_data)

    protocol = classify_protocol(st, tls_s)
    if not is_email_stream(protocol, st):
        return None

    # Cleartext phase is everything before the handshake begins.
    c_clear = c_data[:tls_c] if tls_c is not None else c_data
    s_clear = s_data[:tls_s] if tls_s is not None else s_data

    lines = starttls.build_dialogue(
        c_clear, s_clear, st.client_to_server, st.server_to_client
    )
    stls = starttls.analyse(protocol, lines, tls_started=tls_c is not None)

    mode = classify_mode(st, protocol, tls_c, stls.accepted)
    role = classify_role(protocol, st.server_port)

    # Capture clock, sanitised against the capture median so one corrupt
    # timestamp cannot invalidate certificate validity for the whole session.
    raw_time = st.first_time
    suspect = reader.is_suspect_time(raw_time)
    capture_time = epoch_to_datetime(reader.sane_time(raw_time))

    session = Session(
        session_id=f"{capture_hash[:8]}-{st.stream_id}",
        tcp_stream=st.stream_id,
        client=Endpoint(st.client_ip, st.client_port),
        server=Endpoint(st.server_ip, st.server_port),
        first_frame=st.first_frame,
        last_frame=st.last_frame,
        capture_time=capture_time,
        capture_time_suspect=suspect,
        duration_seconds=round(st.duration, 3),
        packets=st.packets,
        bytes_client_to_server=len(c_data),
        bytes_server_to_client=len(s_data),
        protocol=protocol,
        role=role,
        tls_mode=mode,
        banner=stls.banner,
        capability_line=stls.capability_line,
        starttls_offered=stls.offered,
        starttls_requested=stls.requested,
        starttls_accepted=stls.accepted,
        capability_mangled=stls.mangled,
        mangled_token=stls.mangled_token,
        cleartext_auth=stls.auth,
        command_transcript=stls.transcript,
    )

    # ---- TLS ------------------------------------------------------------
    if tls_c is not None or tls_s is not None:
        hs = tls.analyse_handshake(c_data, s_data)
        session.tls_version_raw = hs.negotiated_version
        session.tls_version = tls.version_name(hs.negotiated_version)
        session.handshake_complete = hs.complete
        session.resumed = hs.resumed
        session.ja3 = hs.ja3
        session.ja3_string = hs.ja3_string
        session.ja4 = hs.ja4
        session.alpn = hs.alpn
        session.server_name = hs.server_name
        if hs.client_hello:
            session.offered_ciphers = hs.client_hello.cipher_suites
            session.extensions = hs.client_hello.extensions

        if hs.cipher_suite is not None:
            props = properties(hs.cipher_suite)
            session.cipher_suite_id = hs.cipher_suite
            session.cipher_suite = props.name
            session.kex = props.kex
            session.cipher_bits = props.key_bits
            session.cipher_mode = props.mode
            session.forward_secrecy = props.forward_secrecy

        # Effective key-exchange strength.
        if hs.named_group:
            session.kex_bits = group_strength_bits(hs.named_group) or None
        elif hs.dhe_bits:
            session.kex_bits = hs.dhe_bits

        # ---- certificates ----------------------------------------------
        if hs.certificates:
            session.cert_visibility = CertVisibility.OBSERVED
            analysis = certmod.analyse(
                hs.certificates, capture_time, session.server_name, hs.ocsp_response
            )
            session.chain = analysis.chain
            session.chain_valid = analysis.chain_valid
            session.chain_error = analysis.chain_error
            session.name_match = analysis.name_match
            session.revocation = analysis.revocation
            if session.kex_bits is None and analysis.smallest_key_bits:
                session.kex_bits = analysis.smallest_key_bits
        elif hs.negotiated_version == 0x0304:
            session.cert_visibility = CertVisibility.ENCRYPTED_TLS13
            session.confidence = Confidence.PARTIAL
        else:
            session.cert_visibility = CertVisibility.ABSENT
            if session.tls_version:
                session.confidence = Confidence.PARTIAL

    # ---- DNS policy cross-reference ------------------------------------
    mta, tlsa, rpt = policy.policy_for_ip(st.server_ip)
    session.mta_sts_published = mta
    session.tlsa_records = tlsa
    session.tls_rpt_published = rpt
    if not session.server_name:
        session.server_name = policy.ip_to_host.get(st.server_ip)

    if session.capture_time_suspect:
        session.notes.append(
            "This session's first packet carries an implausible timestamp; the "
            "capture median was used as the reference clock."
        )
    if st.client_to_server.gaps or st.server_to_client.gaps:
        session.notes.append("Reassembled stream contains gaps; some bytes were not captured.")
        session.confidence = Confidence.PARTIAL

    return session

package in.gov.ntro.sih.sms.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The single point of contact with the Python analysis engine.
 *
 * <p>The engine is invoked as a subprocess and speaks exactly one JSON document
 * on stdout. Diagnostics go to stderr, so stdout stays machine-clean. That one
 * contract is the whole interface between the two halves of the system —
 * neither side can break the other by changing internals.
 *
 * <p>Running the analysis out-of-process also contains it: a malformed capture
 * that crashes a parser takes down a subprocess, not the API.
 */
@Component
public class EngineClient {

    private static final Logger log = LoggerFactory.getLogger(EngineClient.class);

    private final EngineProperties properties;
    private final ObjectMapper mapper = new ObjectMapper();

    public EngineClient(EngineProperties properties) {
        this.properties = properties;
    }

    /** Thrown when the engine cannot produce a report for a capture. */
    public static class EngineException extends RuntimeException {
        public EngineException(String message) { super(message); }
        public EngineException(String message, Throwable cause) { super(message, cause); }
    }

    /**
     * Analyse a capture file and return the engine's JSON report.
     *
     * @param pcap path to the capture on disk
     */
    public JsonNode analyse(Path pcap) {
        List<String> command = new ArrayList<>(properties.pythonCommand());
        command.add("-m");
        command.add("securemailscope.cli");
        command.add("analyse");
        command.add(pcap.toAbsolutePath().toString());
        command.add("--json");
        command.add("-");
        command.add("--compact");
        if (!properties.isMlEnabled()) {
            command.add("--no-ml");
        }

        log.info("running engine: {}", String.join(" ", command));

        ProcessBuilder pb = new ProcessBuilder(command);

        Process process;
        try {
            process = pb.start();
        } catch (IOException e) {
            throw new EngineException(
                    "could not start the analysis engine. Does sms.engine.python point at an "
                            + "interpreter with the engine installed? Run ./scripts/setup.sh "
                            + "and export SMS_PYTHON. (tried: " + String.join(" ", command) + ")", e);
        }

        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        Thread errPump = new Thread(() -> drain(process, stderr, true));
        errPump.setDaemon(true);
        errPump.start();

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            char[] buffer = new char[8192];
            int n;
            while ((n = reader.read(buffer)) != -1) {
                stdout.append(buffer, 0, n);
            }
        } catch (IOException e) {
            process.destroyForcibly();
            throw new EngineException("failed reading engine output", e);
        }

        boolean finished;
        try {
            finished = process.waitFor(properties.getTimeoutSeconds(), TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            throw new EngineException("interrupted while waiting for the engine", e);
        }
        if (!finished) {
            process.destroyForcibly();
            throw new EngineException(
                    "engine timed out after " + properties.getTimeoutSeconds() + "s");
        }

        try {
            errPump.join(2000);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }

        int exit = process.exitValue();
        if (exit != 0) {
            throw new EngineException("engine exited with status " + exit + ": " + tail(stderr));
        }
        if (stdout.length() == 0) {
            throw new EngineException("engine produced no output: " + tail(stderr));
        }

        try {
            return mapper.readTree(stdout.toString());
        } catch (IOException e) {
            throw new EngineException("engine output was not valid JSON: " + tail(stderr), e);
        }
    }

    /**
     * Re-render a stored report as HTML.
     *
     * <p>The stored JSON is piped to the engine rather than the capture being
     * re-analysed. The analysis is the artefact of record: re-running it later
     * could hand back a document that disagrees with the one persisted — same
     * evidence, newer engine, different findings — and it also keeps working
     * after the uploaded capture has been pruned.
     *
     * <p>PDF is the same document printed by the browser — the report carries
     * the ``@page`` rules and prints itself when opened with ``?print=1``. A
     * server-side renderer used to live here and was removed: WeasyPrint needs
     * Pango and cairo, which install cleanly in a container and often not at
     * all on a laptop, so the endpoint answered 501 in exactly the deployments
     * people used it from.
     */
    public byte[] render(String reportJson) {
        List<String> command = new ArrayList<>(properties.pythonCommand());
        command.add("-m");
        command.add("securemailscope.cli");
        command.add("render");
        command.add("-");                       // read the report from stdin
        command.add("--html");
        command.add("-");                       // write the result to stdout

        Process process;
        try {
            process = new ProcessBuilder(command).start();
        } catch (IOException e) {
            throw new EngineException("could not start the analysis engine to render a report", e);
        }

        StringBuilder stderr = new StringBuilder();
        Thread errPump = new Thread(() -> drain(process, stderr, true));
        errPump.setDaemon(true);
        errPump.start();

        // Feed stdin on its own thread: a report large enough to fill the pipe
        // buffer would otherwise deadlock against our own read of stdout.
        byte[] payload = reportJson.getBytes(StandardCharsets.UTF_8);
        Thread inPump = new Thread(() -> {
            try (java.io.OutputStream os = process.getOutputStream()) {
                os.write(payload);
            } catch (IOException ignored) {
                // The engine exiting early closes the pipe; the exit status and
                // stderr below are what actually report the failure.
            }
        });
        inPump.setDaemon(true);
        inPump.start();

        byte[] stdout;
        try (java.io.InputStream in = process.getInputStream()) {
            stdout = in.readAllBytes();
        } catch (IOException e) {
            process.destroyForcibly();
            throw new EngineException("failed reading rendered report", e);
        }

        boolean finished;
        try {
            finished = process.waitFor(properties.getTimeoutSeconds(), TimeUnit.SECONDS);
            errPump.join(2000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            throw new EngineException("interrupted while rendering a report", e);
        }
        if (!finished) {
            process.destroyForcibly();
            throw new EngineException(
                    "rendering timed out after " + properties.getTimeoutSeconds() + "s");
        }

        int exit = process.exitValue();
        if (exit != 0) {
            throw new EngineException("engine exited with status " + exit + ": " + tail(stderr));
        }
        if (stdout.length == 0) {
            throw new EngineException("engine rendered nothing: " + tail(stderr));
        }
        return stdout;
    }

    /**
     * The result of probing the engine: whether it can actually run, and if not,
     * exactly why.
     */
    public record EngineStatus(boolean ready, String version, String error,
                               String python, String interpreter) {
        public static EngineStatus down(String error) {
            return new EngineStatus(false, null, error, null, null);
        }
    }

    /**
     * Probe whether the engine can actually do its job.
     *
     * <p>This deliberately imports {@code securemailscope.pipeline} rather than
     * the bare {@code securemailscope} package. The package's {@code __init__}
     * is empty, so importing it succeeds even when none of the engine's
     * dependencies are installed — which made an earlier version of this check
     * report a healthy engine on a machine where every analysis failed with
     * {@code ModuleNotFoundError}. Importing the pipeline pulls in
     * {@code cryptography}, {@code yaml} and the whole analysis chain, so a
     * missing dependency is caught here instead of surfacing later as a failed
     * capture.
     *
     * <p>The interpreter's own path is reported too: the usual cause of a
     * failure is {@code python3} resolving to a different interpreter than the
     * one the engine was installed into.
     */
    public EngineStatus probe() {
        List<String> command = new ArrayList<>(properties.pythonCommand());
        command.add("-c");
        // The Python version is reported deliberately. A container and a
        // laptop can run byte-identical code on different interpreters, and a
        // version-specific failure is otherwise invisible: the engine once died
        // on Python 3.9 only, because importlib.resources handles namespace
        // packages differently there. Surfacing the version makes that class of
        // problem a glance rather than an investigation.
        command.add(
                "import sys;"
                        + "import securemailscope.pipeline as p;"
                        + "print(getattr(p, '__version__', '1.0.0'));"
                        + "print('%d.%d.%d' % sys.version_info[:3]);"
                        + "print(sys.executable)");
        try {
            Process p = new ProcessBuilder(command).start();
            StringBuilder out = new StringBuilder();
            StringBuilder err = new StringBuilder();
            Thread errPump = new Thread(() -> drain(p, err, true));
            errPump.setDaemon(true);
            errPump.start();
            drain(p, out, false);

            boolean finished = p.waitFor(30, TimeUnit.SECONDS);
            errPump.join(2000);
            if (!finished) {
                p.destroyForcibly();
                return EngineStatus.down("the interpreter did not respond within 30s");
            }
            if (p.exitValue() != 0) {
                return EngineStatus.down(lastLine(err));
            }
            String[] lines = out.toString().trim().split("\\R");
            return new EngineStatus(
                    true,
                    lines.length > 0 ? lines[0].trim() : "1.0.0",
                    null,
                    lines.length > 1 ? lines[1].trim() : null,
                    lines.length > 2 ? lines[2].trim() : null);
        } catch (IOException e) {
            return EngineStatus.down(
                    "could not start '" + String.join(" ", properties.pythonCommand())
                            + "': " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return EngineStatus.down("interrupted while probing the engine");
        }
    }

    /** Convenience for callers that only care whether the engine works. */
    public String version() {
        EngineStatus status = probe();
        return status.ready() ? status.version() : null;
    }

    private static String lastLine(StringBuilder sb) {
        String s = sb.toString().trim();
        if (s.isEmpty()) {
            return "the interpreter exited without explanation";
        }
        String[] lines = s.split("\\R");
        // A Python traceback's final line is the actual error.
        return lines[lines.length - 1].trim();
    }

    private static void drain(Process process, StringBuilder sink, boolean errorStream) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(
                errorStream ? process.getErrorStream() : process.getInputStream(),
                StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                sink.append(line).append('\n');
            }
        } catch (IOException ignored) {
            // the process died; the exit status carries the real error
        }
    }

    private static String tail(StringBuilder sb) {
        String s = sb.toString().trim();
        if (s.isEmpty()) {
            return "(no diagnostics)";
        }
        return s.length() <= 1500 ? s : "…" + s.substring(s.length() - 1500);
    }
}

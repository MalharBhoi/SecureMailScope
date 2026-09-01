package in.gov.ntro.sih.sms;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * SecureMailScope backend.
 *
 * <p>Deliberately thin. Every piece of cryptographic analysis — PCAP parsing,
 * TCP reassembly, TLS handshake dissection, X.509 validation, the rule engine,
 * grading and the model — lives in the Python engine under {@code engine/}.
 * This service uploads a capture, runs the engine, persists the result and
 * serves it. That split is intentional: the subtle, bug-prone logic sits where
 * it is exhaustively unit-tested, and the two halves meet across exactly one
 * JSON contract.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class SecureMailScopeApplication {

    public static void main(String[] args) {
        SpringApplication.run(SecureMailScopeApplication.class, args);
    }
}

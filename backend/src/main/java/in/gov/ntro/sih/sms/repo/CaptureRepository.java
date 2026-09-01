package in.gov.ntro.sih.sms.repo;

import in.gov.ntro.sih.sms.domain.Capture;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CaptureRepository extends JpaRepository<Capture, Long> {
    List<Capture> findAllByOrderByUploadedAtDesc();

    /** Uploading the same evidence twice should find the first analysis, not repeat it. */
    Optional<Capture> findFirstBySha256AndStatusOrderByIdDesc(String sha256, Capture.Status status);
}

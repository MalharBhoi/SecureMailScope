package in.gov.ntro.sih.sms.repo;

import in.gov.ntro.sih.sms.domain.MailSession;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MailSessionRepository extends JpaRepository<MailSession, Long> {
    List<MailSession> findByCaptureIdOrderByStreamIndexAsc(Long captureId);
    List<MailSession> findByCaptureIdAndGrade(Long captureId, String grade);
}

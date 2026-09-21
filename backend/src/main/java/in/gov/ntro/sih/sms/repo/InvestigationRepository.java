package in.gov.ntro.sih.sms.repo;
import in.gov.ntro.sih.sms.domain.Investigation;
import org.springframework.data.jpa.repository.JpaRepository;
public interface InvestigationRepository extends JpaRepository<Investigation, Long> {}

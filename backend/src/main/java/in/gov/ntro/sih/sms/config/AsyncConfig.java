package in.gov.ntro.sih.sms.config;

import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * Analysis runs off the request thread so an upload returns immediately and the
 * UI can poll for progress.
 *
 * <p>A small bounded pool on purpose: each task forks a Python process that
 * parses a whole capture, so unbounded concurrency would thrash the machine
 * rather than finish sooner.
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "analysisExecutor")
    public Executor analysisExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("analysis-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(60);
        executor.initialize();
        return executor;
    }
}

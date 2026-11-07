package com.example.consumer;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.event.EventListener;

/**
 * The http suite's sample app. Under a boot variant (`SEAMPACT_SUITE_BOOT_VARIANT`) it writes the started line once
 * the app runs and exits, so the boot profile sees a start or the boot check's refusal.
 */
@SpringBootApplication(scanBasePackages = "com.example")
public class ConsumerApplication {
    static final String BOOT_STARTED_LINE = "seampact-suite: started";

    public static void main(String[] arguments) {
        SpringApplication.run(ConsumerApplication.class, arguments);
    }

    @EventListener
    void onReady(ApplicationReadyEvent ready) {
        if (BootVariant.current().isEmpty()) return;

        System.out.println(BOOT_STARTED_LINE);
        ConfigurableApplicationContext context = ready.getApplicationContext();
        System.exit(SpringApplication.exit(context));
    }
}

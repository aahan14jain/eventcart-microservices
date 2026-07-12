package com.eventcart.orderservice.config;

import io.micrometer.cloudwatch2.CloudWatchConfig;
import io.micrometer.cloudwatch2.CloudWatchMeterRegistry;
import io.micrometer.core.instrument.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cloudwatch.CloudWatchAsyncClient;

import java.time.Duration;
import java.util.Map;

/**
 * Registers Micrometer's CloudWatch meter registry alongside Prometheus.
 * Only active when {@code management.cloudwatch.metrics.export.enabled=true}.
 */
@Configuration
@ConditionalOnProperty(prefix = "management.cloudwatch.metrics.export", name = "enabled", havingValue = "true")
public class CloudWatchMetricsConfig {

    @Bean(destroyMethod = "close")
    public CloudWatchAsyncClient cloudWatchAsyncClient(
            @Value("${management.cloudwatch.metrics.export.region}") String region) {
        return CloudWatchAsyncClient.builder()
                .region(Region.of(region))
                .build();
    }

    @Bean
    public CloudWatchConfig cloudWatchConfig(
            @Value("${management.cloudwatch.metrics.export.namespace}") String namespace,
            @Value("${management.cloudwatch.metrics.export.step:1m}") Duration step) {
        Map<String, String> props = Map.of(
                "cloudwatch.namespace", namespace,
                "cloudwatch.step", step.toString());
        return props::get;
    }

    @Bean
    public CloudWatchMeterRegistry cloudWatchMeterRegistry(
            CloudWatchConfig cloudWatchConfig,
            Clock clock,
            CloudWatchAsyncClient cloudWatchAsyncClient) {
        return new CloudWatchMeterRegistry(cloudWatchConfig, clock, cloudWatchAsyncClient);
    }
}

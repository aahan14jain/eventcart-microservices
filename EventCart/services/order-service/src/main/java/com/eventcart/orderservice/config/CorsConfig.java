package com.eventcart.orderservice.config;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.eventcart.orderservice.observability.CorrelationId;

/**
 * Global CORS: explicit allowlisted origins only (no {@code *}). Origins are configurable
 * per environment via {@code cors.allowed-origins} (comma-separated), e.g.
 * {@code CORS_ALLOWED_ORIGINS=https://app.example.com} in production.
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final List<String> allowedOrigins;

    public CorsConfig(
            @Value("${cors.allowed-origins:http://localhost:3000,http://localhost:4200}") String allowedOriginsCsv) {
        this.allowedOrigins = Arrays.stream(allowedOriginsCsv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins(allowedOrigins.toArray(new String[0]))
                .allowedMethods("GET", "POST", "OPTIONS")
                .allowedHeaders(
                        HttpHeaders.CONTENT_TYPE,
                        HttpHeaders.ACCEPT,
                        HttpHeaders.AUTHORIZATION,
                        AdminSecurityConfig.API_KEY_HEADER)
                .exposedHeaders(CorrelationId.HEADER_NAME)
                .maxAge(3600);
    }
}

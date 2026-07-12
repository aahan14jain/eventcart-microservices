package com.eventcart.orderservice.observability;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Accepts or generates a correlation id per request, exposes it via MDC, request attributes, and response header.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class CorrelationIdFilter extends OncePerRequestFilter {

    private static final int MAX_LENGTH = 128;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String uri = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (contextPath == null) {
            contextPath = "";
        }
        if (uri != null && uri.startsWith(contextPath + "/actuator")) {
            filterChain.doFilter(request, response);
            return;
        }

        String id = resolve(request.getHeader(CorrelationId.HEADER_NAME));
        LogMdc.putTraceId(id);
        request.setAttribute(CorrelationId.REQUEST_ATTRIBUTE, id);
        response.setHeader(CorrelationId.HEADER_NAME, id);
        try {
            filterChain.doFilter(request, response);
        } finally {
            LogMdc.clearTraceId();
        }
    }

    private static String resolve(String headerValue) {
        if (headerValue == null || headerValue.isBlank()) {
            return UUID.randomUUID().toString();
        }
        String trimmed = headerValue.trim();
        return trimmed.length() > MAX_LENGTH ? trimmed.substring(0, MAX_LENGTH) : trimmed;
    }
}

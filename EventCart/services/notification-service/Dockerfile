# syntax=docker/dockerfile:1

FROM eclipse-temurin:17-jdk-alpine AS builder

WORKDIR /build

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -q -B dependency:go-offline -DskipTests

COPY src/ src/
RUN ./mvnw -q -B package -DskipTests

FROM eclipse-temurin:17-jre-alpine AS runtime

RUN addgroup -g 1001 eventcart && \
    adduser -u 1001 -G eventcart -D -s /sbin/nologin eventcart

WORKDIR /app

COPY --from=builder --chown=eventcart:eventcart /build/target/*.jar app.jar

USER eventcart

EXPOSE 8083

ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:InitialRAMPercentage=50.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:8083/actuator/health/liveness || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]

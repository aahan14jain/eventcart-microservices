# EventCart Admin Dashboard

Internal Angular (standalone, Angular 19) tool for saga visibility and DLQ replay.

## Run

```bash
# Terminal 1 — order-service (admin API on :8080)
cd EventCart/services/order-service && ./mvnw spring-boot:run

# Terminal 2 — admin UI on :4200 (proxies /admin → :8080)
cd eventcart-admin && npm start
```

Open http://localhost:4200

## Auth

Requests send header `X-Admin-Api-Key` (see `src/environments/environment.ts`).
Must match order-service `admin.security.api-key` / `ADMIN_API_KEY`.

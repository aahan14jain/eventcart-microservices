import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Attaches the admin API key to every outbound HTTP request. */
export const adminApiKeyInterceptor: HttpInterceptorFn = (req, next) => {
  const key = environment.adminApiKey?.trim();
  if (!key) {
    return next(req);
  }
  return next(
    req.clone({
      setHeaders: {
        'X-Admin-Api-Key': key,
      },
    }),
  );
};

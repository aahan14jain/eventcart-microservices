import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { DlqMessage, SagaInstance } from './models';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  listSagas(limit = 50): Observable<SagaInstance[]> {
    return this.http.get<SagaInstance[]>(`${this.base}/admin/sagas`, {
      params: { limit: String(limit) },
    });
  }

  listDlq(): Observable<DlqMessage[]> {
    return this.http.get<DlqMessage[]>(`${this.base}/admin/dlq`);
  }

  replayDlq(id: string): Observable<DlqMessage> {
    return this.http.post<DlqMessage>(`${this.base}/admin/dlq/${encodeURIComponent(id)}/replay`, {});
  }
}

import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { AdminApiService } from '../../core/admin-api.service';
import { applySagaRelayEvent } from '../../core/live-update.util';
import { SagaInstance } from '../../core/models';
import { RealtimeRelayService } from '../../core/realtime-relay.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-sagas-page',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, MatTableModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './sagas-page.component.html',
  styleUrl: './sagas-page.component.css',
})
export class SagasPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(AdminApiService);
  private readonly relay = inject(RealtimeRelayService);
  private readonly subs = new Subscription();

  readonly columns = ['expand', 'orderId', 'currentStatus', 'updatedAt'];
  sagas: SagaInstance[] = [];
  expandedOrderId: string | null = null;
  loading = true;
  error: string | null = null;
  lastFetchedAt: Date | null = null;
  live = false;

  ngOnInit(): void {
    this.subs.add(
      this.relay.connected$.subscribe((connected) => {
        this.live = connected;
      }),
    );

    this.subs.add(
      this.relay.connected$
        .pipe(
          switchMap((connected) =>
            timer(0, connected ? environment.sagasReconcileIntervalMs : environment.sagasPollIntervalMs),
          ),
          switchMap(() =>
            this.api.listSagas().pipe(
              catchError((err) => {
                this.error = err?.message ?? 'Failed to load sagas';
                this.loading = false;
                return of(null);
              }),
            ),
          ),
        )
        .subscribe((sagas) => {
          if (sagas == null) {
            return;
          }
          this.sagas = sagas;
          this.loading = false;
          this.error = null;
          this.lastFetchedAt = new Date();
        }),
    );

    this.subs.add(
      this.relay.sagaEvents$.subscribe((event) => {
        this.sagas = applySagaRelayEvent(this.sagas, event);
        this.loading = false;
        this.lastFetchedAt = new Date();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get statusHint(): string {
    if (this.live) {
      return `Live · reconcile every ${environment.sagasReconcileIntervalMs / 1000}s`;
    }
    return `Polling every ${environment.sagasPollIntervalMs / 1000}s (WebSocket offline)`;
  }

  toggle(orderId: string): void {
    this.expandedOrderId = this.expandedOrderId === orderId ? null : orderId;
  }

  isExpanded(orderId: string): boolean {
    return this.expandedOrderId === orderId;
  }
}

import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { AdminApiService } from '../../core/admin-api.service';
import { SagaInstance } from '../../core/models';
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
  private pollSub?: Subscription;

  readonly columns = ['expand', 'orderId', 'currentStatus', 'updatedAt'];
  sagas: SagaInstance[] = [];
  expandedOrderId: string | null = null;
  loading = true;
  error: string | null = null;
  lastFetchedAt: Date | null = null;
  readonly pollHint = `${environment.sagasPollIntervalMs / 1000}s`;

  ngOnInit(): void {
    this.pollSub = timer(0, environment.sagasPollIntervalMs)
      .pipe(
        switchMap(() =>
          this.api.listSagas().pipe(
            catchError((err) => {
              this.error = err?.message ?? 'Failed to load sagas';
              this.loading = false;
              return of([] as SagaInstance[]);
            }),
          ),
        ),
      )
      .subscribe((sagas) => {
        this.sagas = sagas;
        this.loading = false;
        if (sagas.length || !this.error) {
          this.error = null;
        }
        this.lastFetchedAt = new Date();
      });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  toggle(orderId: string): void {
    this.expandedOrderId = this.expandedOrderId === orderId ? null : orderId;
  }

  isExpanded(orderId: string): boolean {
    return this.expandedOrderId === orderId;
  }
}

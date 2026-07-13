import { DatePipe, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { AdminApiService } from '../../core/admin-api.service';
import { applyDlqRelayEvent, mergeDlqFromServer } from '../../core/live-update.util';
import { DlqMessage } from '../../core/models';
import { RealtimeRelayService } from '../../core/realtime-relay.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-dlq-page',
  standalone: true,
  imports: [NgIf, DatePipe, MatTableModule, MatButtonModule, MatProgressBarModule, MatSnackBarModule],
  templateUrl: './dlq-page.component.html',
  styleUrl: './dlq-page.component.css',
})
export class DlqPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(AdminApiService);
  private readonly relay = inject(RealtimeRelayService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly subs = new Subscription();

  readonly columns = ['id', 'topic', 'partition', 'offset', 'originalTopic', 'receivedAt', 'replayed', 'actions'];
  messages: DlqMessage[] = [];
  loading = true;
  error: string | null = null;
  replayingId: string | null = null;
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
            timer(0, connected ? environment.dlqReconcileIntervalMs : environment.dlqPollIntervalMs),
          ),
          switchMap(() =>
            this.api.listDlq().pipe(
              catchError((err) => {
                this.error = err?.message ?? 'Failed to load DLQ';
                this.loading = false;
                return of(null);
              }),
            ),
          ),
        )
        .subscribe((messages) => {
          if (messages == null) {
            return;
          }
          this.messages = mergeDlqFromServer(messages, this.messages);
          this.loading = false;
          this.error = null;
        }),
    );

    this.subs.add(
      this.relay.dlqEvents$.subscribe((event) => {
        this.messages = applyDlqRelayEvent(this.messages, event);
        this.loading = false;
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get statusHint(): string {
    if (this.live) {
      return `Live · reconcile every ${environment.dlqReconcileIntervalMs / 1000}s`;
    }
    return `Polling every ${environment.dlqPollIntervalMs / 1000}s (WebSocket offline)`;
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.listDlq().subscribe({
      next: (messages) => {
        this.messages = mergeDlqFromServer(messages, this.messages);
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.message ?? 'Failed to load DLQ';
        this.loading = false;
      },
    });
  }

  replay(row: DlqMessage): void {
    if (this.replayingId || row.id.startsWith('live:')) {
      if (row.id.startsWith('live:')) {
        this.snackBar.open('Wait for HTTP reconcile before replaying a live-only row', 'Dismiss', { duration: 4000 });
      }
      return;
    }
    this.replayingId = row.id;
    this.api.replayDlq(row.id).subscribe({
      next: (updated) => {
        this.messages = this.messages.map((m) => (m.id === updated.id ? updated : m));
        this.replayingId = null;
        this.snackBar.open(`Replayed to ${updated.originalTopic}`, 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.replayingId = null;
        this.snackBar.open(err?.message ?? 'Replay failed', 'Dismiss', { duration: 4000 });
      },
    });
  }

  truncate(payload: string, max = 80): string {
    if (!payload) {
      return '';
    }
    return payload.length <= max ? payload : `${payload.slice(0, max)}…`;
  }
}

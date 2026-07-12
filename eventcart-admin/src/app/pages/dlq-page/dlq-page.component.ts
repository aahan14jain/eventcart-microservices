import { DatePipe, NgIf } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AdminApiService } from '../../core/admin-api.service';
import { DlqMessage } from '../../core/models';

@Component({
  selector: 'app-dlq-page',
  standalone: true,
  imports: [NgIf, DatePipe, MatTableModule, MatButtonModule, MatProgressBarModule, MatSnackBarModule],
  templateUrl: './dlq-page.component.html',
  styleUrl: './dlq-page.component.css',
})
export class DlqPageComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly snackBar = inject(MatSnackBar);

  readonly columns = ['id', 'topic', 'partition', 'offset', 'originalTopic', 'receivedAt', 'replayed', 'actions'];
  messages: DlqMessage[] = [];
  loading = true;
  error: string | null = null;
  replayingId: string | null = null;

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.listDlq().subscribe({
      next: (messages) => {
        this.messages = messages;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.message ?? 'Failed to load DLQ';
        this.loading = false;
      },
    });
  }

  replay(row: DlqMessage): void {
    if (this.replayingId) {
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

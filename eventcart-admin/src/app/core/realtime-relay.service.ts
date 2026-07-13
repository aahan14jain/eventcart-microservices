import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, filter } from 'rxjs';
import { environment } from '../../environments/environment';
import { DlqRelayEvent, RelayEvent, SagaStatusRelayEvent } from './models';

/**
 * Single WebSocket client for the Kafka→WS relay.
 * Connects on first inject; reconnects with backoff. No local persistence.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeRelayService implements OnDestroy {
  private readonly zone = inject(NgZone);

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private stopped = false;

  private readonly connectedSubject = new BehaviorSubject<boolean>(false);
  private readonly eventsSubject = new Subject<RelayEvent>();

  readonly connected$: Observable<boolean> = this.connectedSubject.asObservable();
  readonly events$: Observable<RelayEvent> = this.eventsSubject.asObservable();

  readonly sagaEvents$: Observable<SagaStatusRelayEvent> = this.events$.pipe(
    filter((e): e is SagaStatusRelayEvent => e.type === 'saga.status'),
  );

  readonly dlqEvents$: Observable<DlqRelayEvent> = this.events$.pipe(
    filter((e): e is DlqRelayEvent => e.type === 'dlq.message'),
  );

  constructor() {
    this.connect();
  }

  get connected(): boolean {
    return this.connectedSubject.value;
  }

  connect(): void {
    this.stopped = false;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.clearReconnectTimer();

    const url = environment.wsUrl;
    try {
      this.socket = new WebSocket(url);
    } catch {
      this.connectedSubject.next(false);
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.zone.run(() => {
        this.reconnectAttempt = 0;
        this.connectedSubject.next(true);
      });
    };

    this.socket.onmessage = (msg) => {
      let parsed: RelayEvent;
      try {
        parsed = JSON.parse(String(msg.data)) as RelayEvent;
      } catch {
        return;
      }
      this.zone.run(() => this.eventsSubject.next(parsed));
    };

    this.socket.onerror = () => {
      // onclose will schedule reconnect
    };

    this.socket.onclose = () => {
      this.zone.run(() => {
        this.connectedSubject.next(false);
        this.socket = null;
        if (!this.stopped) {
          this.scheduleReconnect();
        }
      });
    };
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connectedSubject.next(false);
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.eventsSubject.complete();
    this.connectedSubject.complete();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

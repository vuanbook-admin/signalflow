export type AuditOutcome = "accepted" | "completed" | "blocked" | "failed" | "pending";

export type AuditAction =
  | "queue_created"
  | "publish_dispatched"
  | "publish_reconciled"
  | "retry_scheduled"
  | "rescheduled"
  | "canceled";

export type AuditScalar = string | number | boolean | null;

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  outcome: AuditOutcome;
  jobId: string;
  workspaceId?: string;
  platform?: string;
  providerJobId?: string;
  message?: string;
  metadata?: Record<string, AuditScalar>;
}

export class LocalAuditLog {
  private readonly entries: AuditEntry[] = [];
  private sequence = 0;

  append(input: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    const timestamp = new Date().toISOString();
    const entry: AuditEntry = {
      ...input,
      id: `audit_${Date.parse(timestamp)}_${this.sequence++}`,
      timestamp,
    };
    this.entries.push(entry);
    return entry;
  }

  list(): AuditEntry[] {
    return [...this.entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  }

  snapshot(): AuditEntry[] {
    return this.list();
  }

  hydrate(entries?: AuditEntry[]): void {
    this.entries.length = 0;
    if (entries) this.entries.push(...entries);
    this.sequence = this.entries.length;
  }
}

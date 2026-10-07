import type { PrismaService } from '../persistence/prisma.service';

export interface OutboxLeaseRecord {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly attempts: number;
  readonly traceParent: string | null;
  readonly createdAtMs: number;
}
interface LeasedRow {
  id:string; event_id:string; event_type:string; exchange:string; routing_key:string;
  payload:string; correlation_id:string; attempts:number; trace_parent:string|null; created_at:Date;
}
export class PrismaOutboxStore {
  constructor(private readonly prisma: PrismaService) {}
  async leaseBatch(input:{workerId:string;leaseMs:number;limit:number;maxAttempts:number}):Promise<OutboxLeaseRecord[]> {
    const rows=await this.prisma.client.$queryRawUnsafe<LeasedRow[]>(
      `UPDATE app.outbox_message AS o SET locked_by=$1,
       locked_until=now()+($2::bigint*interval '1 millisecond'),attempts=o.attempts+1
       WHERE o.id IN (SELECT c.id FROM app.outbox_message c
        WHERE c.published_at IS NULL AND c.dead_at IS NULL
        AND (c.locked_until IS NULL OR c.locked_until<now()) AND c.attempts<$3
        ORDER BY c.created_at,c.id FOR UPDATE SKIP LOCKED LIMIT $4)
       RETURNING o.id::text,o.event_id::text,o.event_type,o.exchange,o.routing_key,o.payload,
       o.correlation_id::text,o.attempts,o.trace_parent,o.created_at`,
      input.workerId,input.leaseMs,input.maxAttempts,input.limit,
    );
    return rows.map((r)=>({id:r.id,eventId:r.event_id,eventType:r.event_type,exchange:r.exchange,
      routingKey:r.routing_key,payload:r.payload,correlationId:r.correlation_id,attempts:r.attempts,
      traceParent:r.trace_parent,createdAtMs:r.created_at.getTime()}));
  }
  async markPublished(input:{id:string;workerId:string}):Promise<boolean>{
    const rows=await this.prisma.client.$queryRawUnsafe<{id:string}[]>(
      `UPDATE app.outbox_message SET published_at=now(),locked_by=NULL,locked_until=NULL,last_error=NULL
       WHERE id=$1::uuid AND locked_by=$2 AND published_at IS NULL RETURNING id::text`,input.id,input.workerId);
    return rows.length===1;
  }
  async markFailed(input:{id:string;workerId:string;error:string;maxAttempts:number}):Promise<boolean>{
    const rows=await this.prisma.client.$queryRawUnsafe<{id:string}[]>(
      `UPDATE app.outbox_message SET last_error=$3,locked_by=NULL,locked_until=NULL,
       dead_at=CASE WHEN attempts >= $4 THEN now() ELSE NULL END
       WHERE id=$1::uuid AND locked_by=$2 AND published_at IS NULL RETURNING id::text`,
       input.id,input.workerId,input.error.slice(0,200),input.maxAttempts);
    return rows.length===1;
  }
}

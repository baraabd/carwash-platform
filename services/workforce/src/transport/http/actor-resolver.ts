import { CORRELATION_HEADER, resolveCorrelationId } from '@carwash/service-kit';
import type { RequestMeta } from '../../ports';
import { IdentityAuthFailure, type IdentitySessionClient } from '../../infrastructure/identity/identity-session.client';
import type { ServiceClientAuthenticator } from '../../infrastructure/security/service-clients';
import { RateLimited } from './http-errors';

export interface HeaderBag {
  readonly headers: Readonly<Record<string,string|string[]|undefined>>;
}
function header(request:HeaderBag,name:string):string|undefined {
  const value=request.headers[name];
  return Array.isArray(value)?undefined:value;
}
export class RequestBudget {
  private readonly windows=new Map<string,{start:number;count:number}>();
  constructor(private readonly limit:number,private readonly windowMs=60_000,private readonly now:()=>number=Date.now){}
  take(key:string):void {
    const at=this.now(); const current=this.windows.get(key);
    if(!current||at-current.start>=this.windowMs){
      if(this.windows.size>10_000)this.windows.clear();
      this.windows.set(key,{start:at,count:1}); return;
    }
    current.count+=1;
    if(current.count>this.limit)throw new RateLimited();
  }
}
export class ActorResolver {
  constructor(
    private readonly identity:IdentitySessionClient,
    private readonly services:ServiceClientAuthenticator,
    private readonly userBudget:RequestBudget,
    private readonly serviceBudget:RequestBudget,
  ){}
  async resolve(request:HeaderBag):Promise<RequestMeta>{
    const correlationId=resolveCorrelationId(header(request,CORRELATION_HEADER));
    const clientId=header(request,'x-service-client');
    const token=header(request,'x-service-token');
    const authorization=header(request,'authorization');
    if(clientId!==undefined||token!==undefined){
      if(authorization!==undefined||clientId===undefined||token===undefined)throw new IdentityAuthFailure('UNAUTHENTICATED');
      const client=this.services.authenticate(clientId,token);
      if(!client)throw new IdentityAuthFailure('UNAUTHENTICATED');
      this.serviceBudget.take(`service:${client.id}`);
      return {correlationId,actor:{kind:'SERVICE',clientId:client.id,scopes:client.scopes}};
    }
    if(authorization===undefined)throw new IdentityAuthFailure('UNAUTHENTICATED');
    const session=await this.identity.resolve(authorization,correlationId);
    this.userBudget.take(`user:${session.subject}`);
    return {correlationId,actor:{kind:'USER',subject:session.subject,permissions:session.permissions}};
  }
}

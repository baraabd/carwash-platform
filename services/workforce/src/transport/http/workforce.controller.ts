import { Body,Controller,Get,HttpCode,Inject,Param,Patch,Post,Query,Req,Res,UseFilters } from '@nestjs/common';
import { WorkforceService } from '../../application';
import { invalid,type DecisionReason,type EmploymentStatus,type OperatorState,type ShiftState,type SuspensionReason,type VerificationCaseState } from '../../domain';
import { operationalReadiness } from '../../domain/readiness';
import { ActorResolver,type HeaderBag } from './actor-resolver';
import { WorkforceHttpFilter } from './http-errors';

export const WORKFORCE_V1='/internal/v1/workforce';
interface StatusResponse{status(code:number):StatusResponse}
function objectBody(body:unknown,allowed:readonly string[],required:readonly string[]):Record<string,unknown>{
  if(typeof body!=='object'||body===null||Array.isArray(body))invalid('Body must be a JSON object.');
  const record=body as Record<string,unknown>;
  for(const key of Object.keys(record))if(!allowed.includes(key))invalid(`Unexpected field: ${key.slice(0,40)}.`);
  for(const key of required)if(!(key in record))invalid(`Missing field: ${key}.`);
  return record;
}
function str(value:unknown,field:string,max=200):string{
  if(typeof value!=='string'||value.length===0||value.length>max)invalid(`${field} must be a string.`);
  return value;
}
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function instant(value:unknown,field:string):Date{
  const text=str(value,field);
  if(!INSTANT.test(text))invalid(`${field} must be a UTC ISO-8601 instant.`);
  const date=new Date(text); if(!Number.isFinite(date.getTime()))invalid(`${field} is not a valid instant.`);
  return date;
}
function header(req:HeaderBag,name:string):string{
  const value=req.headers[name]; return typeof value==='string'?value:'';
}
function operatorView(operator:OperatorState,skillCodes:readonly string[],now=new Date()){
  const readiness=operationalReadiness(operator,skillCodes,now);
  return {operatorId:operator.id,displayName:operator.displayName,homeZoneId:operator.homeZoneId,
    employmentStatus:operator.employmentStatus,suspensionReason:operator.suspensionReason,
    verificationStatus:operator.verificationStatus,verifiedUntil:operator.verifiedUntil?.toISOString()??null,
    version:operator.version,skillCodes:[...skillCodes],readiness};
}
function caseView(state:VerificationCaseState){
  return {caseId:state.id,operatorId:state.operatorId,status:state.status,evidenceRefs:[...state.evidenceRefs],
    submittedAt:state.submittedAt.toISOString(),decidedAt:state.decidedAt?.toISOString()??null,
    decisionReason:state.decisionReason,validUntil:state.validUntil?.toISOString()??null,version:state.version};
}
function shiftView(state:ShiftState){
  return {shiftId:state.id,operatorId:state.operatorId,zoneId:state.zoneId,startsAt:state.startsAt.toISOString(),
    endsAt:state.endsAt.toISOString(),status:state.status,version:state.version};
}
@Controller(WORKFORCE_V1)
@UseFilters(WorkforceHttpFilter)
export class WorkforceController{
  constructor(@Inject(WorkforceService)private readonly workforce:WorkforceService,@Inject(ActorResolver)private readonly actors:ActorResolver){}

  @Get('me')
  async me(@Req()req:HeaderBag){
    const meta=await this.actors.resolve(req); const result=await this.workforce.me(meta);
    return operatorView(result.operator,result.skillCodes);
  }
  @Patch('me')
  async updateMe(@Req()req:HeaderBag,@Body()body:unknown){
    const meta=await this.actors.resolve(req); const input=objectBody(body,['displayName','homeZoneId'],[]);
    const operator=await this.workforce.updateMe(meta,{
      ...(input.displayName===undefined?{}:{displayName:str(input.displayName,'displayName',80)}),
      ...(input.homeZoneId===undefined?{}:{homeZoneId:str(input.homeZoneId,'homeZoneId',40)}),
    });
    const result=await this.workforce.me(meta); return operatorView(operator,result.skillCodes);
  }
  @Post('me/verification-cases')
  async submitVerification(@Req()req:HeaderBag,@Body()body:unknown,@Res({passthrough:true})res:StatusResponse){
    const meta=await this.actors.resolve(req); const input=objectBody(body,['evidenceRefs'],['evidenceRefs']);
    if(!Array.isArray(input.evidenceRefs)||!input.evidenceRefs.every((v)=>typeof v==='string'))invalid('evidenceRefs must be strings.');
    const result=await this.workforce.submitVerification(meta,input.evidenceRefs,header(req,'idempotency-key'));
    res.status(201); return caseView(result);
  }
  @Post('verification-cases/:id/withdraw')
  @HttpCode(200)
  async withdraw(@Req()req:HeaderBag,@Param('id')id:string,@Body()body:unknown){
    const meta=await this.actors.resolve(req); objectBody(body??{},[],[]);
    return caseView(await this.workforce.withdrawVerification(meta,id));
  }
  @Post(':id/review')
  @HttpCode(200)
  async review(@Req()req:HeaderBag,@Param('id')id:string,@Body()body:unknown){
    const meta=await this.actors.resolve(req); const input=objectBody(body,['decision','validUntil','reason'],['decision']);
    const decision=str(input.decision,'decision',16);
    if(decision==='APPROVE'){
      if(input.validUntil===undefined||input.reason!==undefined)invalid('APPROVE requires validUntil only.');
      return caseView(await this.workforce.reviewVerification(meta,id,{decision:'APPROVE',validUntil:instant(input.validUntil,'validUntil')}));
    }
    if(decision==='REJECT'){
      if(input.reason===undefined||input.validUntil!==undefined)invalid('REJECT requires reason only.');
      const reason=str(input.reason,'reason',40) as DecisionReason;
      return caseView(await this.workforce.reviewVerification(meta,id,{decision:'REJECT',reason}));
    }
    return invalid('Unknown decision.');
  }
  @Post('operators')
  async createOperator(@Req()req:HeaderBag,@Body()body:unknown,@Res({passthrough:true})res:StatusResponse){
    const meta=await this.actors.resolve(req); const input=objectBody(body,['identitySubject','displayName','homeZoneId'],['identitySubject','displayName','homeZoneId']);
    const operator=await this.workforce.createOperator(meta,{identitySubject:str(input.identitySubject,'identitySubject',40),
      displayName:str(input.displayName,'displayName',80),homeZoneId:str(input.homeZoneId,'homeZoneId',40)});
    res.status(201); return operatorView(operator,[]);
  }
  @Patch('operators/:id/status')
  async setState(@Req()req:HeaderBag,@Param('id')id:string,@Body()body:unknown){
    const meta=await this.actors.resolve(req); const input=objectBody(body,['employmentStatus','suspensionReason'],[]);
    const employment=input.employmentStatus===undefined?undefined:str(input.employmentStatus,'employmentStatus',16) as EmploymentStatus;
    const suspension=input.suspensionReason===undefined?undefined:
      input.suspensionReason===null?null:str(input.suspensionReason,'suspensionReason',24) as SuspensionReason;
    const operator=await this.workforce.setOperatorState(meta,id,{...(employment===undefined?{}:{employmentStatus:employment}),
      ...(suspension===undefined?{}:{suspensionReason:suspension})});
    const ready=await this.workforce.readiness(meta,id); return operatorView(operator,ready.skillCodes);
  }
  @Post('operators/:id/skills')
  async grantSkill(@Req()req:HeaderBag,@Param('id')id:string,@Body()body:unknown){
    const meta=await this.actors.resolve(req); const input=objectBody(body,['skillCode'],['skillCode']);
    return {operatorId:id,skillCodes:await this.workforce.grantSkill(meta,id,str(input.skillCode,'skillCode',40))};
  }
  @Post('operators/:id/skills/:skill/revoke')
  @HttpCode(200)
  async revokeSkill(@Req()req:HeaderBag,@Param('id')id:string,@Param('skill')skill:string,@Body()body:unknown){
    const meta=await this.actors.resolve(req); objectBody(body??{},[],[]);
    return {operatorId:id,skillCodes:await this.workforce.revokeSkill(meta,id,skill)};
  }
  @Get('operators/:id/readiness')
  async readiness(@Req()req:HeaderBag,@Param('id')id:string){
    return this.workforce.readiness(await this.actors.resolve(req),id);
  }
  @Post('operators/:id/shifts')
  async createShift(@Req()req:HeaderBag,@Param('id')id:string,@Body()body:unknown,@Res({passthrough:true})res:StatusResponse){
    const meta=await this.actors.resolve(req); const input=objectBody(body,['zoneId','startsAt','endsAt'],['zoneId','startsAt','endsAt']);
    const shift=await this.workforce.createShift(meta,id,{zoneId:str(input.zoneId,'zoneId',40),
      startsAt:instant(input.startsAt,'startsAt'),endsAt:instant(input.endsAt,'endsAt')},header(req,'idempotency-key'));
    res.status(201); return shiftView(shift);
  }
  @Post('shifts/:id/cancel')
  @HttpCode(200)
  async cancelShift(@Req()req:HeaderBag,@Param('id')id:string,@Body()body:unknown){
    const meta=await this.actors.resolve(req); objectBody(body??{},[],[]);
    return shiftView(await this.workforce.cancelShift(meta,id));
  }
  @Get('eligible')
  async eligible(@Req()req:HeaderBag,@Query('zoneId')zoneId:unknown,@Query('at')at:unknown,@Query('skillCode')skill:unknown){
    const meta=await this.actors.resolve(req);
    return {operators:await this.workforce.eligible(meta,{zoneId:str(zoneId,'zoneId',40),at:instant(at,'at'),
      ...(skill===undefined?{}:{skillCode:str(skill,'skillCode',40)})})};
  }
}

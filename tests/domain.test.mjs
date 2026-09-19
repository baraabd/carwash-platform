import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateQuote} from '../dist/services/catalog/src/domain/quote.js';
import {transitionBooking,windowsOverlap} from '../dist/services/booking/src/domain/lifecycle.js';
import {assertBalancedJournal} from '../dist/services/billing/src/domain/ledger.js';
import {parseBookingConfirmedV1} from '../dist/packages/event-contracts/src/booking-confirmed.js';
const quote=(changes={})=>({currency:'USD',lines:[{unitAmountMinor:'1500',quantity:2}],discountBps:0,...changes});
test('quote: two units total without discount',()=>assert.deepEqual(calculateQuote(quote()),{currency:'USD',subtotalMinor:'3000',discountMinor:'0',totalMinor:'3000'}));
test('quote: basis-point discount',()=>assert.equal(calculateQuote(quote({discountBps:1500})).totalMinor,'2550'));
test('quote: round half up in minor units',()=>assert.equal(calculateQuote(quote({lines:[{unitAmountMinor:'1',quantity:1}],discountBps:5000})).discountMinor,'1'));
test('quote: full discount never negative',()=>assert.equal(calculateQuote(quote({discountBps:10000})).totalMinor,'0'));
test('quote: preserves integers beyond JS safe number',()=>assert.equal(calculateQuote(quote({lines:[{unitAmountMinor:'9007199254740993',quantity:1}]})).totalMinor,'9007199254740993'));
for(const amount of ['-1','1.5','01','1e3','', '1000000000000000000']){
 test(`quote: reject amount ${JSON.stringify(amount)}`,()=>assert.throws(()=>calculateQuote(quote({lines:[{unitAmountMinor:amount,quantity:1}]})),/INVALID_AMOUNT/));
}
test('quote: rejects overflow',()=>assert.throws(()=>calculateQuote(quote({lines:[{unitAmountMinor:'999999999999999999',quantity:2}]})),/AMOUNT_OVERFLOW/));
test('quote: rejects empty basket',()=>assert.throws(()=>calculateQuote(quote({lines:[]})),/INVALID_LINES/));
test('quote: rejects malformed currency',()=>assert.throws(()=>calculateQuote(quote({currency:'usd'})),/CURRENCY/));
test('quote: rejects fractional quantity',()=>assert.throws(()=>calculateQuote(quote({lines:[{unitAmountMinor:'1',quantity:1.5}]})),/QUANTITY/));
test('quote: rejects negative discount',()=>assert.throws(()=>calculateQuote(quote({discountBps:-1})),/DISCOUNT/));
test('quote: rejects discount over 100%',()=>assert.throws(()=>calculateQuote(quote({discountBps:10001})),/DISCOUNT/));
test('quote: sums several lines',()=>assert.equal(calculateQuote(quote({lines:[{unitAmountMinor:'5',quantity:2},{unitAmountMinor:'3',quantity:3}]})).totalMinor,'19'));
const b={id:'sample',state:'PENDING_CONFIRMATION',version:1};
test('booking: legal transition increments version without mutation',()=>{
 const next=transitionBooking(b,'CONFIRMED',1);assert.equal(next.version,2);assert.equal(next.state,'CONFIRMED');assert.equal(b.state,'PENDING_CONFIRMATION');
});
test('booking: stale expected version is rejected',()=>assert.throws(()=>transitionBooking(b,'CONFIRMED',0),/VERSION_CONFLICT/));
test('booking: cannot skip execution lifecycle',()=>assert.throws(()=>transitionBooking(b,'COMPLETED',1),/INVALID_TRANSITION/));
test('booking: complete lifecycle',()=>{
 let current=b;for(const state of ['CONFIRMED','ASSIGNED','EN_ROUTE','ARRIVED','IN_PROGRESS','COMPLETED'])current=transitionBooking(current,state,current.version);
 assert.equal(current.state,'COMPLETED');assert.equal(current.version,7);
});
for(const state of ['COMPLETED','CANCELLED','EXPIRED']){
 test(`booking: ${state} is terminal`,()=>assert.throws(()=>transitionBooking({...b,state},'CONFIRMED',1),/INVALID_TRANSITION/));
}
test('booking: version overflow rejected',()=>assert.throws(()=>transitionBooking({...b,version:Number.MAX_SAFE_INTEGER},'CONFIRMED',Number.MAX_SAFE_INTEGER),/INVALID_VERSION/));
test('booking: cannot silently expire confirmed booking',()=>assert.throws(()=>transitionBooking({...b,state:'CONFIRMED'},'EXPIRED',1),/INVALID_TRANSITION/));
test('window: touching [start,end) intervals do not overlap',()=>assert.equal(windowsOverlap({startMs:1,endMs:2},{startMs:2,endMs:3}),false));
test('window: intersection detected',()=>assert.equal(windowsOverlap({startMs:1,endMs:4},{startMs:3,endMs:5}),true));
test('window: containment detected',()=>assert.equal(windowsOverlap({startMs:1,endMs:10},{startMs:3,endMs:4}),true));
test('window: empty range rejected',()=>assert.throws(()=>windowsOverlap({startMs:1,endMs:1},{startMs:2,endMs:3}),/INVALID_WINDOW/));
const entry=(side,amountMinor='100',currency='USD')=>({accountId:side==='DEBIT'?'cash':'revenue',side,amountMinor,currency});
test('ledger: balanced journal accepted',()=>assert.doesNotThrow(()=>assertBalancedJournal([entry('DEBIT'),entry('CREDIT')])));
test('ledger: unbalanced journal rejected',()=>assert.throws(()=>assertBalancedJournal([entry('DEBIT'),entry('CREDIT','99')]),/UNBALANCED/));
test('ledger: amounts beyond safe JS integer remain precise',()=>assert.doesNotThrow(()=>assertBalancedJournal([entry('DEBIT','9007199254740993'),entry('CREDIT','9007199254740993')])));
test('ledger: cannot offset different currencies',()=>assert.throws(()=>assertBalancedJournal([entry('DEBIT','100','USD'),entry('CREDIT','100','EUR')]),/UNBALANCED/));
test('ledger: independent currency groups can balance',()=>assert.doesNotThrow(()=>assertBalancedJournal([entry('DEBIT'),entry('CREDIT'),entry('DEBIT','50','EUR'),entry('CREDIT','50','EUR')])));
test('ledger: negative amount rejected',()=>assert.throws(()=>assertBalancedJournal([entry('DEBIT','-100'),entry('CREDIT','-100')]),/AMOUNT/));
test('ledger: zero amount rejected',()=>assert.throws(()=>assertBalancedJournal([entry('DEBIT','0'),entry('CREDIT','0')]),/AMOUNT/));
test('ledger: invalid account rejected',()=>assert.throws(()=>assertBalancedJournal([{...entry('DEBIT'),accountId:' '},entry('CREDIT')]),/ACCOUNT/));
test('ledger: invalid side rejected',()=>assert.throws(()=>assertBalancedJournal([entry('PLUS'),entry('CREDIT')]),/SIDE/));
const uid='123e4567-e89b-42d3-a456-426614174000';
const event=()=>({eventId:uid,eventType:'booking.confirmed.v1',schemaVersion:1,producer:'booking',occurredAt:'2026-09-19T09:00:00.000Z',correlationId:uid,aggregateVersion:1,data:{bookingId:uid,customerId:uid}});
test('event: valid contract parses to a separate object',()=>{const e=event();const actual=parseBookingConfirmedV1(e);assert.deepEqual(actual,e);assert.notEqual(actual,e);assert.notEqual(actual.data,e.data)});
test('event: rejected extra fields prevent arbitrary PII propagation',()=>assert.throws(()=>parseBookingConfirmedV1({...event(),phone:'unwanted'}),/UNEXPECTED/));
test('event: data is strict',()=>{const e=event();e.data.address='unwanted';assert.throws(()=>parseBookingConfirmedV1(e),/UNEXPECTED/)});
test('event: invalid ID rejected',()=>assert.throws(()=>parseBookingConfirmedV1({...event(),eventId:'not-uuid'}),/UUID/));
test('event: unknown schema rejected explicitly',()=>assert.throws(()=>parseBookingConfirmedV1({...event(),schemaVersion:2}),/UNSUPPORTED/));
test('event: producer field is constrained structurally',()=>assert.throws(()=>parseBookingConfirmedV1({...event(),producer:'billing'}),/UNSUPPORTED/));
test('event: impossible calendar date rejected',()=>assert.throws(()=>parseBookingConfirmedV1({...event(),occurredAt:'2026-02-30T09:00:00.000Z'}),/TIMESTAMP/));
test('event: occurrence time must be canonical UTC',()=>assert.throws(()=>parseBookingConfirmedV1({...event(),occurredAt:'2026-09-19T09:00:00+03:00'}),/TIMESTAMP/));
test('event: missing field rejected',()=>{const e=event();delete e.correlationId;assert.throws(()=>parseBookingConfirmedV1(e),/UNEXPECTED/)});
test('event: unsafe aggregate version rejected',()=>assert.throws(()=>parseBookingConfirmedV1({...event(),aggregateVersion:Number.MAX_SAFE_INTEGER+1}),/VERSION/));
test('event: null rejected',()=>assert.throws(()=>parseBookingConfirmedV1(null),/EXPECTED_OBJECT/));

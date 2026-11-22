import assert from 'node:assert/strict';
import { buildCampaignBoard } from '../lib/campaign-board.mjs';
const missions = [
  {id:'1',campaignId:'c1',campaignName:'Campaña 33',productId:'p1',status:'done',createdAt:'2026-11-20T09:00:00Z',stats:{prospects:6}},
  {id:'2',campaignId:'c1',campaignName:'Campaña 33',productId:'p2',status:'queued',createdAt:'2026-11-20T09:01:00Z'},
  {id:'3',campaignId:'c1',campaignName:'Campaña 33',productId:'p3',status:'running',createdAt:'2026-11-20T09:02:00Z'},
  {id:'4',campaignId:'c2',campaignName:'Demo',productId:'p4',status:'cancelled',demo:true,createdAt:'2026-11-20T10:00:00Z'},
  {id:'5',productId:'p5',status:'done'},
];
const threads = [
  {missionId:'1',messages:[{direction:'out'},{direction:'in'},{direction:'in'}],drafts:[{status:'revisar'},{status:'enviado'}],quotes:[{status:'aceptada'}]},
  {missionId:'4',demo:true,messages:[{direction:'in'}]},
];
const board = buildCampaignBoard(missions, threads, [{id:'p1',name:'A'}, {id:'p2',name:'B'}]);
assert.equal(board.length, 2);
assert.equal(board[0].id,'c2');
assert.equal(board[1].total,3);
assert.equal(board[1].completed,1);
assert.equal(board[1].queued,1);
assert.equal(board[1].active,1);
assert.equal(board[1].progress,33);
assert.equal(board[1].prospectsReported,6);
assert.equal(board[1].buyersRecorded,1);
assert.equal(board[1].replies,2);
assert.equal(board[1].draftsToReview,1);
assert.equal(board[1].acceptedQuotes,1);
assert.equal(board[0].buyersRecorded,0,'No contar contactos demo como reales');
assert.equal(buildCampaignBoard([],[],[]).length,0);
console.log('OK: campañas agrupadas, tareas pendientes, progreso, compradores y respuestas.');

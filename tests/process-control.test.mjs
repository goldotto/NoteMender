import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {terminateProcess} from '../src/process-control.mjs';

test('Windows cancellation ends only the owned launcher tree and waits for termination',async()=>{
  const child={pid:1234,exitCode:null,kill(){throw Error('unexpected fallback');}},killer=new EventEmitter();let call,finished=false;
  const pending=terminateProcess(child,{platform:'win32',spawnImpl:(...args)=>{call=args;return killer;}}).then(()=>finished=true);
  assert.deepEqual(call,['taskkill.exe',['/PID','1234','/T','/F'],{windowsHide:true,stdio:'ignore'}]);assert.equal(finished,false);
  killer.emit('close',0);await pending;assert.equal(finished,true);
});
test('missing PID uses direct termination and finished children are untouched',async()=>{
  let kills=0;await terminateProcess({kill(){kills++;}},{platform:'win32'});await terminateProcess({pid:55,exitCode:0,kill(){kills++;}},{platform:'win32'});assert.equal(kills,1);
});
test('Windows termination command error falls back to the owned child',async()=>{
  let kills=0;const killer=new EventEmitter(),pending=terminateProcess({pid:1234,exitCode:null,kill(){kills++;}},{platform:'win32',spawnImpl:()=>killer});killer.emit('error',Error('unavailable'));await pending;assert.equal(kills,1);
});

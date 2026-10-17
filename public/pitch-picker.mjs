import {degreeMidi,describePitch,SOLFEGE} from './entry-notes.mjs';
import {KEYS,numberPitch} from './music.mjs';
// Keep the original select and its change handler as the single source of truth.
export function createPitchPicker(select,{getKey,getFlats=()=>false,isBusy=()=>false,audition,onError=()=>{},afterChoose=()=>{}}){
  const label=select.closest('label'),host=document.createElement('div');host.className='intuitive-pitch';host.id=select.id+'Picker';
  const advanced=document.createElement('details');advanced.className='professional-pitch';advanced.innerHTML='<summary>专业音高选择</summary>';
  label.before(host);host.append(advanced);advanced.append(label);
  if(select.id==='mergePitch')advanced.append(document.getElementById('mergeMidiInput').closest('label'));
  const status=document.createElement('p');status.className='pitch-description';status.setAttribute('role','status');
  const row=document.createElement('div');row.className='pitch-digits';
  const midi=()=>select.value==='rest'?null:Number(select.value);
  function choose(value){if(select.disabled||isBusy())return;select.value=value===null?'rest':String(value);afterChoose();select.dispatchEvent(new Event('change',{bubbles:true}));refresh();}
  const digits=[1,2,3,4,5,6,7,0].map(d=>{const b=document.createElement('button');b.type='button';b.dataset.degree=d;b.innerHTML=`<b>${d}</b><small>${SOLFEGE[d]}</small>`;b.title=d?'按当前调号选择此数字，保留当前高低音组':'选择休止符';b.addEventListener('click',()=>{try{choose(degreeMidi(d,{key:getKey(),octave:numberPitch(midi(),getKey()).octave}));}catch(e){onError(e);}});row.append(b);return b;});
  const shifts=document.createElement('div');shifts.className='pitch-shifts';
  const stepButtons=[['低一点',-1],['高一点',1],['低一组',-12],['高一组',12]].map(([text,step])=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.title=`${step<0?'降低':'升高'}${Math.abs(step)===1?'一个半音':'一个八度'}，休止符不能升降`;b.addEventListener('click',()=>choose(midi()+step));shifts.append(b);return [b,step];});
  const listen=document.createElement('button');listen.type='button';listen.textContent='试听此音';listen.title='试听当前选择的实际音高，不写入工程';listen.addEventListener('click',()=>Promise.resolve(audition(midi())).catch(onError));
  advanced.before(status,row,shifts,listen);
  function refresh(){const value=midi(),key=getKey(),p=describePitch(value,key,getFlats());status.textContent=`${p.notation} · ${p.label} · 当前 1=${KEYS[key]}`;status.setAttribute('aria-label',p.detail);for(const b of digits){let valid=true;try{degreeMidi(+b.dataset.degree,{key,octave:p.octave});}catch{valid=false;}b.disabled=(select.disabled||isBusy())||!valid;b.setAttribute('aria-pressed',String(String(b.dataset.degree)===p.digit&&!p.accidental));}for(const [b,step]of stepButtons)b.disabled=(select.disabled||isBusy())||value===null||value+step<21||value+step>108;listen.disabled=(select.disabled||isBusy())||value===null;}
  select.addEventListener('change',refresh);refresh();return {refresh};
}

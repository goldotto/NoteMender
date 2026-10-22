export function engravingSettings(value={}) {
  const finite=(x,f,a,b)=>x!==null&&x!==''&&Number.isFinite(Number(x))?Math.max(a,Math.min(b,Number(x))):f;
  return {version:1,title:typeof value.title==='string'?value.title.slice(0,120):null,
    meter:['2/4','3/4','4/4','6/8'].includes(value.meter)?value.meter:null,
    key:value.key!==null&&value.key!==undefined&&Number.isInteger(Number(value.key))?finite(value.key,0,0,11):null,
    bpm:value.bpm==null?null:finite(value.bpm,112,30,300),
    step:value.step!==null&&value.step!==''&&[0,.5,.25,.125,.0625].includes(Number(value.step))?Number(value.step):.25,
    fontSize:finite(value.fontSize,22,16,32),margin:finite(value.margin,14,8,25),
    barsPerRow:Math.round(finite(value.barsPerRow,4,1,8)),lyrics:value.lyrics!==false,
    sectionId:typeof value.sectionId==='string'?value.sectionId.slice(0,80):'',flats:Boolean(value.flats)};
}

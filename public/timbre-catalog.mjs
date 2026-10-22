export const SOUNDFONT_REVISION='044fab8e1456bfafc5776e86dfd6bb8697149aef';
export const SAMPLE_TIMBRES=Object.freeze([
  {id:'piano',name:'钢琴',instrument:'acoustic_grand_piano',program:0,size:2631954,sha256:'00eebe0214c12ff8f32c47c2f7ac92ef352800e868ab0f883b80854486ac4ca6'},
  {id:'guitar',name:'尼龙弦吉他',instrument:'acoustic_guitar_nylon',program:24,size:1837439,sha256:'5375fa9e0408d960e12b6e4ec120c42bce824d80b18e982b27ddaece146a4f64'},
  {id:'violin',name:'小提琴',instrument:'violin',program:40,size:2870964,sha256:'3c169ac4c7781fe145e545e909993371188aa6bad617bc3a5f0692b7678995f8',sustain:true},
  {id:'flute',name:'长笛',instrument:'flute',program:73,size:2969583,sha256:'e2e35283876eec60b919beeb8bfa49f46f12dddf5b8c6025e7a45c5d2a24bda5',sustain:true},
]);
export const SYNTH_TIMBRES=Object.freeze([
  {id:'classic',name:'原有音色 · 合成',wave:'triangle',attack:.012,decay:.7,release:.02},
  {id:'soft',name:'柔和 · 合成',harmonics:[1,.15,.04],attack:.025,decay:.65,release:.05},
  {id:'bright',name:'明亮 · 合成',harmonics:[1,.5,.3,.14,.08],attack:.008,decay:.4,release:.03},
  {id:'pluck',name:'拨弦 · 合成',harmonics:[1,.45,.22,.1],attack:.004,decay:.03,release:.025},
  {id:'flute',name:'笛声 · 合成',harmonics:[1,.08,.13,.02],attack:.045,decay:.85,release:.06},
  {id:'strings',name:'弦乐 · 合成',harmonics:[1,.55,.33,.18,.1,.06],attack:.09,decay:.9,release:.08},
]);
export const sampleSpec=id=>SAMPLE_TIMBRES.find(s=>s.id===id||'sound-'+s.id===id);
export function timbreId(value){return SYNTH_TIMBRES.some(t=>t.id===value)||SAMPLE_TIMBRES.some(t=>'sample-'+t.id===value)?value:'classic';}
export function sampleURLs(spec,region='auto'){
  const suffix=`gleitz/midi-js-soundfonts@${SOUNDFONT_REVISION}/FluidR3_GM/${spec.instrument}-mp3.js`;
  const cdns=[`https://fastly.jsdelivr.net/gh/${suffix}`,`https://cdn.jsdelivr.net/gh/${suffix}`],official=`https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/${SOUNDFONT_REVISION}/FluidR3_GM/${spec.instrument}-mp3.js`;
  return region==='global'?[official,...cdns]:[...cdns,official];
}

"""Audio-time segmentation and local alignment repair, independent of score notes."""
import math
import unicodedata

def units_key(language):
    return 'chars' if language in ('zh', 'yue') else 'words'

def quiet_ranges(audio, sr):
    import numpy as np
    hop=max(1, round(sr*.02))
    levels=[float(np.sqrt(np.mean(np.square(audio[a:a+hop], dtype=np.float64)))) for a in range(0,len(audio),hop)]
    if not levels:return []
    threshold=max(1e-5, min(.004, float(np.percentile(levels,70))*.12))
    ranges=[];begin=None
    for i,level in enumerate(levels+[threshold+1]):
        if level<=threshold and begin is None:begin=i
        if level>threshold and begin is not None:
            if (i-begin)*hop/sr>=.18:ranges.append((begin*hop/sr,min(len(audio)/sr,i*hop/sr)))
            begin=None
    return ranges

def context_windows(length, pauses, sr=16000, maximum=26, minimum=12, context=1):
    """Partition core time exactly once; analyse with neighbouring audio context."""
    seconds=length/sr;cores=[];start=0.
    while start<seconds-1e-8:
        limit=min(seconds,start+maximum)
        choices=[(a+b)/2 for a,b in pauses if start+minimum<=(a+b)/2<=limit]
        end=limit if limit>=seconds else max(choices,default=limit)
        cores.append((round(start*sr),round(end*sr)));start=end
    return [(a,b,max(0,a-round(context*sr)),min(length,b+round(context*sr))) for a,b in cores]

def valid(unit):
    return all(isinstance(unit.get(k),(int,float)) and math.isfinite(unit[k]) for k in ('start','end')) and unit['end']>unit['start']

def own_core(segment, core_start, core_end, final=False):
    """Midpoint ownership removes context duplicates; never invent missing times."""
    key=units_key(segment['language']);units=segment[key];kept=[]
    for i,u in enumerate(units):
        if valid(u):mid=(u['start']+u['end'])/2
        else:
            prev=next((x['end'] for x in reversed(units[:i]) if valid(x)),segment['start'])
            following=next((x['start'] for x in units[i+1:] if valid(x)),segment['end'])
            mid=(prev+following)/2
        if core_start<=mid<core_end or final and mid==core_end:kept.append(u)
    text_key='char' if key=='chars' else 'word'
    return {**segment,'start':core_start,'end':core_end,key:kept,'text':('' if key=='chars' else ' ').join(u[text_key] for u in kept)}

def normalized(text):
    return ''.join(c.lower() for c in text if unicodedata.category(c)[0] in 'LN')

def stitch_segments(segments):
    """Discard only overlapping same-word seam detections, not repeated singing."""
    result=[]
    for segment in segments:
        key=units_key(segment['language']);text_key='char' if key=='chars' else 'word'
        previous=result[-1].get(key,[]) if result else []
        fresh=[]
        for u in segment[key]:
            duplicate=False
            if valid(u):
                for p in previous[-4:]:
                    if not valid(p) or normalized(p[text_key])!=normalized(u[text_key]):continue
                    shared=max(0,min(p['end'],u['end'])-max(p['start'],u['start']))
                    union=max(p['end'],u['end'])-min(p['start'],u['start'])
                    if abs(p['start']-u['start'])<=.25 and shared/union>=.5:duplicate=True;break
            if not duplicate:fresh.append(u)
        result.append({**segment,key:fresh,'text':('' if key=='chars' else ' ').join(u[text_key] for u in fresh)})
    return result

def repair_windows(segment, maximum=12):
    """Retry unlocated runs inside neighbouring valid time anchors, with context."""
    units=segment[units_key(segment['language'])];runs=[];i=0
    while i<len(units):
        if valid(units[i]):i+=1;continue
        first=i
        while i<len(units) and not valid(units[i]):i+=1
        left=max(0,first-1);right=min(len(units),i+1)
        start=units[left]['start'] if valid(units[left]) else segment['start']
        end=units[right-1]['end'] if valid(units[right-1]) else segment['end']
        if 0<end-start<=maximum:runs.append((left,right,start,end))
    return runs

def adopt_repair(original, candidate, first, last):
    key=units_key(original['language']);text_key='char' if key=='chars' else 'word'
    old=original[key][first:last];new=candidate[key]
    if len(old)!=len(new) or any(normalized(a[text_key])!=normalized(b[text_key]) for a,b in zip(old,new)):return original,False
    if sum(not valid(x) for x in new)>=sum(not valid(x) for x in old):return original,False
    if any(valid(a) and valid(b) and b['start']<a['end']-.001 for a,b in zip(new,new[1:])):return original,False
    # Valid neighbouring anchors cannot be moved substantially by a repair.
    if any(valid(a) and (not valid(b) or abs(a['start']-b['start'])>.15 or abs(a['end']-b['end'])>.15) for a,b in zip(old,new)):return original,False
    result={**original,key:original[key][:first]+[{**b,'alignmentMethod':'local-retry'} for b in new]+original[key][last:]}
    return result,True

"""Build complete ROSVOT word intervals without losing IDs to tiny-gap merging.

Pure Python: tests do not import Torch or load models.
"""
import math


def word_intervals(words, duration, minimum=.020001):
    intervals, rejected, cursor = [], [], 0.0
    for word in sorted(words, key=lambda w: w.get('start', float('inf'))):
        a, b = word.get('start'), word.get('end')
        if not isinstance(a, (float, int)) or not isinstance(b, (float, int)) or not math.isfinite(a) or not math.isfinite(b) or a < cursor - .001 or a < 0 or b > duration + .001 or b - a < minimum:
            rejected.append(word.get('id'))
            continue
        a, b = max(cursor, a), min(duration, b)
        if a > cursor:
            intervals.append({'start': cursor, 'end': a, 'lyricIds': []})
        intervals.append({'start': a, 'end': b, 'lyricIds': [word['id']]})
        cursor = b
    if cursor < duration:
        intervals.append({'start': cursor, 'end': duration, 'lyricIds': []})
    if not intervals:
        intervals = [{'start': 0.0, 'end': duration, 'lyricIds': []}]
    # Merge only sub-20ms silence. Reject tiny words above instead of hiding them.
    i = 0
    while i < len(intervals):
        part = intervals[i]
        if part['end'] - part['start'] < minimum and len(intervals) > 1:
            if i == 0:
                intervals[1]['start'] = part['start']
            else:
                intervals[i-1]['end'] = part['end']
            intervals.pop(i)
        else:
            i += 1
    return intervals, rejected


def ids_for_interval(index, intervals, start, end, words):
    if index is None or index < 1 or index > len(intervals):
        return []
    ids = intervals[index-1]['lyricIds']
    return [w['id'] for w in words if w['id'] in ids and min(end, w['end']) - max(start, w['start']) >= .01]

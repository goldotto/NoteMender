// English help is separate from project data and recognition output.
export const EN_SELECT_HELP={
 engine:{auto:'Choose a strategy for each section: vocals, clear solos or dense instruments. Review the result by ear.',basic:'Basic Pitch detects polyphonic notes, then selects one melody. Accompaniment can interfere.'},
 muPrecision:{auto:'FP16 on CUDA and FP32 on CPU. Report half-precision failures and fall back without downloading new weights.',fp16:'FP16 Transformer with FP32 audio features. Uses less GPU memory and time; output notes may differ.',bf16:'BF16 requires native NVIDIA hardware support. The wider numerical range does not guarantee identical notes.',fp32:'Original FP32 path for comparison. Slower and uses more memory.'},
 recognitionProfile:{legacy:'Current default filtering, merging and quantization rules: the stable comparison baseline.',corrected:'Experimental repeated-note and short-note preservation, adaptive energy, fusion and melody continuity. Review by ear.',pyin:'Experimental rules plus probabilistic pYIN tracking for pitch and octave comparison. Takes longer.',crepe:'Experimental rules plus optional CREPE tiny tracking through torchcrepe. Checks pitch and octave, not lyrics.'},
 recognitionAblation:{none:'Enable all experimental improvements.',repeat:'Disable repeated-note onset protection for comparison.',short:'Disable short-note preservation for comparison.',energy:'Disable adaptive energy thresholds for comparison.',fusion:'Disable vocal candidate fusion for comparison.',continuity:'Disable melody continuity constraints for comparison.'},
 computeMode:{standard:'Use the default CPU execution path.',performance:'Use backends that passed consistency checks; show the reason when falling back.'},
 computeDevice:{auto:'Prefer a validated NVIDIA backend; unsupported stages use the CPU.',cpu:'Use native CPU inference with configurable thread count.',cuda:'Prefer NVIDIA. Missing, unvalidated or failed stages fall back to CPU.'},
 strategy:{smooth:'Prefer a continuous pitch path to reduce switching between melody and accompaniment.',highest:'Prefer higher notes. High accompaniment may be selected; this is not a lead-melody detector.',strongest:'Prefer stronger notes; loud accompaniment may be selected.'},
 pasteMode:{empty:'Refuse to paste over existing notes.',overwrite:'Replace the entire destination range. Undo restores it in one step.'},
 layoutMode:{free:'Arrange notes by time, moving and resizing freely without first dividing into bars.',barred:'Preview bar layout using the time signature while retaining free editing.'},
 playMode:{synth:'Play the current working score.',original:'Play the original recording in its original key.'},
 sectionAnalysis:{auto:'Choose the recognition strategy automatically.',vocal:'Use the vocal strategy, preferring the vocal stem.',solo:'Use continuous pitch tracking for clear single-note instruments.',dense:'Select one melody from polyphonic instrument candidates.'}
};
const entries=`scorePreviewToggle|Open the movable, resizable read-only score preview. It refreshes after workspace edits. Print PDF, export SVG, or export MusicXML to edit in Dolce.
draftKey|Set one notation key (1=X) for the whole candidate, replacing its section keys. Sound and MIDI pitches stay unchanged. The key is retained when adopted.
scoreTimbre|Choose the timbre for all score playback and WAV export. Original audio and stems are unchanged. Synthesized and bundled sampled instruments work offline.
draftTimbre|Shares the working score timbre. Switching retains the current playback position.
notationMode|Both views share the current project. Select a staff note to seek, audition, transpose by semitones, or change its duration. Each view remembers its scroll position.
exportEngraving|Lay out a copy of the working score on A4 pages, print to PDF or export SVG. Working notes are unchanged.
updatesTop|Check builds, read release notes and download program updates. Models, components and personal data are retained.
feedbackTop|Prepare and preview a report, then open your mail app addressed to goldotto@proton.me. Nothing is sent automatically.
returnDraftStart|Return to the start chosen with the section playback slider, not the beginning of the entire section.
marqueeMode|F toggles box selection. When off, drag empty space to move the cursor. Clicking a note selects it and positions the cursor for splitting. Drag a selected block to move the selected group.
mixedCopy|Copy selected notes and lyrics together, preserving their links. Ctrl+C.
mixedDelete|Delete selected notes and lyrics together. Undo restores the group.
mixedLyrics|Open editing tools for the selected lyrics while keeping the selection.
audioDrawerToggle|Open audio import, recognition, separation and performance settings.
audioDrawerClose|Close audio settings without unloading audio or changing settings.
helpTop|Open the searchable built-in manual.
helpBtn|Search the manual by feature, model or shortcut.
creditsBtn|View third-party projects, purposes, official links and licenses.
lyricsToggle|Open lyric comparison and manual editing; keep the note selection.
sectionsToggle|Open and locate the full-song waveform and section list above Listen and compare.
openProject|Open a project JSON with notes, lyrics, alignment and candidates. Maximum 32 MB.
toolbarLyricSplit|L: preview splitting selected sustained notes at adopted lyric word boundaries. Pitches stay unchanged; no model runs.
noteLyricSplit|Preview splitting this note at timed lyric boundaries, then confirm and adjust each pitch.
batchLyricSplit|Split selected notes at their word timings. Unselected notes stay unchanged.
lyricNoteSplitConfirm|Apply the split preview. Check pitches by ear. Ctrl+Z restores notes, lyric links and selection together.
shortcutsBtn|View shortcuts and their local enable switch. Ctrl+Alt+K toggles shortcuts.
shortcutsEnabled|Enable editing and playback shortcuts. Text entry and Ctrl/Shift mouse selection remain available when disabled.
linkedEditing|Off by default. Linked notes and words move as a group. Resizing changes only the item being resized. Verify associations before enabling.
lyricsLinkedEditing|Shares the score linkage switch. Only adopted lyrics participate.
inlineLinkedEditing|Move linked notes and words together. Resizing a lyric changes only the lyric. Turn off for independent alignment.
saveProject|Choose a filename, save to exports and download the project JSON. Duplicate names are numbered. Maximum 32 MB.
projectSaveName|Choose a filename without changing the song title. Adds .json and replaces invalid filename characters.
projectSaveConfirm|Save and download; number duplicate filenames rather than overwrite.
projectSaveCancel|Cancel saving without changing the project.
backupsBtn|Choose a backup created before adopting a candidate.
dropzone|Click or drop an audio file. Common formats, up to 120 MB and approximately 10 minutes.
audioFile|Choose the original recording for comparison and recognition.
engine|Choose a local recognition engine; hover over an option for details.
recognitionProfile|Choose recognition rules and additional pitch evidence.
recognitionAblation|Experimental comparison: disable one rule group, keeping the others.
computeThreads|Native CPU thread count. Zero lets the runtime decide. Applies to the next task.
refreshCompute|Recheck acceleration components and devices without analysing audio.
lyricAssist|Optional, off by default. Run Qwen transcription and alignment during generation; this takes extra time. Lyrics can also be recognized later.
recognitionTraditional|Use Basic Pitch and the existing section strategies. ROSVOT is optional. This is the default and has lower hardware requirements.
recognitionMu|Use MuScriptor large independently. Start with the original mix or enable optional separation. Audition individual results and turn a track into a score in the candidate preview. Install the component first. Weights are noncommercial.
generateMuTrack|Generate MuScriptor alternatives only for the selected section and actual stem. Does not change the working score.
cancelMuTrack|Cancel additional recognition, retaining candidates and the working score.
showAllDraftCandidates|Show older rules, raw candidates and comparison backups. Existing data is retained when collapsed.
selectMuAll|Preview each section using an available MuScriptor candidate for its actual stem. Sections without usable notes keep their current choice.
rebuildMuCandidates|Reprocess this section's cached MuScriptor results. Check overlapping pitches when a vocal stem is available, and keep the prior candidate as a backup.
singingFine|Generate optional ROSVOT singing-note alternatives using RMVPE and word references. Review and adopt manually.
autoSeparate|Separate vocals and instruments before generating section candidates. Clear solo recordings may not need this.
separate|Generate separated playback audio without replacing the working score.
rangeStart|Recognition start in original-audio seconds. Zero starts at the beginning.
rangeEnd|Recognition end in original-audio seconds. Blank processes the full recording.
minMidi|Lowest allowed vocal MIDI pitch; a narrow range may discard real low notes.
maxMidi|Highest allowed vocal MIDI pitch; a narrow range may discard real high notes.
instrumentMinMidi|Lowest MIDI pitch allowed for instrumental melody candidates.
instrumentQuantize|Instrument timing grid in beats. A finer grid preserves faster notes but is more complex.
quantize|Vocal timing grid. One quarter note is one beat. This does not set pitch.
transcribe|Generate candidates with the current audio and settings. The working score changes only when adopted.
cancelJob|Cancel analysis. Completed candidate results can still be reopened.
demoBtn|Load the bundled example, replacing the current score. Can be undone.
newBtn|Start a blank score. Save the current project first if needed.
importMidi|Import MIDI and choose one melody track as an editable candidate.
resumeCandidate|Reopen the collapsed candidate, retaining selected alternatives.
cleanupCancel|Cancel clearing and retain the current contents.
cleanupConfirm|Clear the stated browser data; do not delete files from disk.
discardCandidate|Delete pending browser candidates, keeping the working score, audio and local files.
discardDialogCandidate|Delete this pending candidate. Closing or collapsing the window does not delete it.
unloadAudio|Unload original audio and stems; keep notes, lyrics, candidates and disk files.
play|Space plays or pauses. Starting playback clears ordinary editing selection.
stop|Stop playback and reset its position.
backThree|Move playback back three seconds.
forwardThree|Move playback forward three seconds.
focusPlayhead|Pause and select the note at the current playback position.
loop|Repeat the range near the current position.
volume|Adjust listening volume without changing notes or the original recording.
mainSpeed|Pitch-preserving playback from 0.10x to 2.00x, shared by audio, stems and score.
mainSpeedValue|Set playback speed in steps of 0.01 without changing project BPM or exported tempo.
mainSpeedReset|Restore normal playback speed (1x).
waveZoom|Zoom the original waveform horizontally to inspect a shorter time range.
wavePrev|Move the waveform view backward.
waveNext|Move the waveform view forward.
waveAtPlayhead|Centre the waveform view on the playhead.
wavePan|Pan the waveform without changing playback position.
waveform|The waveform shows amplitude, not pitch. Click to seek.
seek|Set playback position in original-audio seconds.
offset|Adjust the global score/audio offset. Use alignment points for local drift.
scoreZoom|Scale note widths without changing text size or row height.
scoreBeatsInput|Show 1–16 beats per row. Fewer beats make short notes easier to inspect.
toolbarCopy|Copy selected notes and lyrics with their relative spacing. Ctrl+C.
toolbarCut|Copy and delete selected notes and lyrics. Ctrl+X; undo is available.
toolbarPaste|Paste at the clicked empty position or the position set in the sidebar. Ctrl+V.
toolbarSplit|Split the selected note at the vertical cursor. Click inside the note first, or press S. Use word-splitting tools for lyrics.
toolbarMerge|M: merge consecutive notes, choosing a pitch when needed. Use word-merging tools for lyrics.
toolbarDelete|Delete selected notes and lyrics. Delete; undo restores them together.
clearSelection|Clear note and lyric selection. Esc.
undo|Undo the last edit together with lyric links and selection. Ctrl+Z.
redo|Redo an undone edit. Ctrl+Y or Ctrl+Shift+Z.
exportScoreDesk|Open the full workspace score in ScoreDesk, optionally with original audio and alignment.
exportBtn|Export project JSON, numbered-notation SVG, MIDI, rendered WAV or print to PDF.
key|Change the notation reference (1=X), keeping actual pitches unchanged.
transposeBtn|Transpose actual notes to a target key. Original audio stays unchanged.
requantize|Rebuild timing from the last recognized raw notes and current BPM. Replaces manual timing edits; can be undone.
flats|Prefer flat notation without changing sound.
alignmentBeat|Score beat of an alignment point, counted from zero.
alignmentSecond|Original-audio second corresponding to the alignment point.
alignAtPlayhead|Use the current playback time for this alignment point.
addAlignment|Add or update an alignment point. Other positions interpolate between points.
removeAlignment|Remove the alignment point at this beat.
title|Change the score title. The save filename is separate.
reviewShortSeconds|Find notes shorter than this original-audio duration. Short notes can be valid.
reviewLongSeconds|Find notes longer than this original-audio duration. Long notes can be valid.
durationReviewKind|Filter short notes, long notes or both; this is a duration filter only.
durationPrevious|Go to the previous duration match.
durationNext|Go to the next duration match.
durationSelectAll|Select every duration match for batch editing.
durationMergeShort|Merge adjacent short fragments of the same pitch. Other pitches and gaps are not merged automatically.
loopSelection|Keep selection and loop its original-audio range while editing.
cutAtPlayhead|Split the selected or currently playing note at the playhead. S.
insertStart|New-note starting beat; the interface counts from beat 1.
insertDuration|New-note duration, minimum 0.0625 beat. Later notes are not pushed.
insertPitch|Choose the new note's MIDI pitch.
insertAtPlayhead|Use the playhead for insertion start.
insertAtSelection|Use the selected note's start for insertion.
addNote|Insert a note without overlapping existing notes.
addRest|Clear the specified range to leave a rest. Can be undone.
copyNotes|Copy the selection, including notes, lyrics and internal links when mixed.
pasteNotes|Paste copied notes, lyrics or mixed content. Overwriting requires explicit permission.
pasteStart|Start beat of the first pasted note, counted from 1.
pasteAtPlayhead|Use the playhead as the paste start.
globalPitchStep|Choose semitone or octave steps. One octave is 12 semitones.
globalPitchDown|Lower all actual pitches and adjust the key. Reject the batch if any pitch is out of range.
globalPitchUp|Raise all actual pitches and adjust the key. Reject the batch if any pitch is out of range.
batchPitch|Choose one replacement pitch for selected notes; keep their timings.
batchReplace|Replace selected pitches only. Undo restores the batch.
batchDelete|Delete selected notes. Lyrics with broken links remain as unassociated text.
batchReviewed|Mark selected notes as manually reviewed, not automatically verified.
batchMerge|Merge consecutive selected notes; do not cross unselected notes.
batchFillGaps|Explicitly allow filling rests between merged notes.
noteStart|Change this note's start without overlapping neighbours.
noteDuration|Change this note's duration, minimum 0.0625 beat.
noteDurationSeconds|Set duration in original-audio seconds using the current time mapping.
notePitch|Change the actual MIDI pitch of the selected note.
noteLyric|Edit text linked to this note. Enter or Save applies it.
noteLyricSave|Save manually entered lyrics.
noteLyrics|Open lyric associations and manual editing for this note.
audition|Preview selected notes at the current playback speed.
markReviewed|V: mark this note as manually reviewed.
deleteNote|Delete this note while retaining associated text. Can be undone.
splitAt|Split position in beats; must lie inside the note.
splitAtMiddle|Set the split position to the note midpoint.
splitAtPlayhead|Set the split position to the playhead.
splitNote|Split into two notes of the same pitch. Can be undone.
mergeNote|Merge this and the next note; choose a pitch if they differ.
mergePitch|Choose the merged note's pitch from existing pitches.
mergeMidiInput|Alternatively enter a MIDI pitch within the allowed range.
mergeFillGaps|Explicitly allow filling gaps within the merged range.
mergeConfirm|Confirm pitch and gap settings. Undo restores the original notes.
freeInput|Text syntax: 1:1 #4:0.5 0:1. The number after a colon is duration in beats; 0 leaves a rest; apostrophes and commas change octave.
freeApply|Write the sequence at the given beat, replacing only its duration. Can be undone.
sectionTrack|Show the whole recording by default. Drag blank space to create a section; only actual boundaries have resize handles.
sectionName|Name a section for navigation, such as intro, verse or interlude.
sectionStart|Section start in original-audio seconds.
sectionEnd|Section end in original-audio seconds. Minimum 0.25 seconds; cannot overlap another section.
sectionKind|Record the section type without changing pitches.
sectionSource|Choose the audio stem for section recognition.
saveSection|Save section name, times and strategy without deleting notes at its boundaries.
locateSection|Seek to the selected section.
regenerateSection|Analyse only the selected section and needed context. Preview before adopting.
deleteSection|Delete the section marker and linked alternatives, keeping notes and original audio. Can be undone.
expandTimeline|Include the blank time before the score on its timeline; does not change the section view.
lyricsScope|Use automatically detected vocal sections, the whole song or an existing section.
lyricsSource|Prefer separated vocals; original audio can be used for comparison.
lyricsLanguage|Choose a language or let the model detect it.
lyricsManualRange|Override automatic lyric sections with a manual time range.
lyricsFrom|Manual lyric recognition/alignment start in original-audio seconds.
lyricsTo|Manual lyric recognition/alignment end in original-audio seconds.
lyricsTranscribe|Run Qwen transcription and alignment, then preview. Notes are unchanged.
lyricsCancel|Cancel the lyric task, retaining existing adopted lyrics.
lyricsImportText|Paste TXT, LRC, SRT or WebVTT. A plain-text line uses the audio range above.
lyricsImport|Review the imported lyrics and original-audio timing before applying.
lyricsAlign|Align selected words or their phrase to original audio. Correct the text first; preview the result.
lyricsOpenFile|Open TXT, LRC, SRT or WebVTT. Inline timestamps retain word timing.
lyricsApply|Adopt the lyric preview in one undoable operation.
lyricsDiscard|Discard the preview, retaining adopted lyrics.
lyricsRematch|Recalculate lyric-note links from original-audio timings without rerunning recognition.
lyricsNew|Create an editable word at the current position.
lyricsChooseNotes|Start linking, click or Ctrl-click score notes, then confirm.
lyricsLinkSelection|Link the current word to selected notes, including multiple notes per word.
lyricLinkFollowTime|Optionally replace word timing with selected note boundaries. Off by default.
lyricText|Edit the word text. Audio timing is separate.
lyricStart|Word start in original-audio seconds.
lyricEnd|Word end in original-audio seconds.
lyricSave|Save text and timing. Linked groups move together when enabled; resizing affects lyrics only. No recognition runs.
lyricRemapPhrase|Preview phrase links recalculated from existing audio timings.
lyricResplitPhrase|Reanalyse note splitting for corrected phrase text, producing an optional candidate to adopt.
lyricLink|Link this lyric to selected notes, keeping lyric timing by default.
lyricUnlink|Remove note associations, keeping text and audio timing.
lyricPrev|Move this word's note association backward.
lyricNext|Move this word's note association forward.
lyricSplitWord|Specify two texts and their audio boundary manually; notes stay unchanged.
lyricMergeWord|Merge this word and the next with their time ranges; notes stay unchanged.
lyricLoop|Loop the original-audio range of this word.
lyricDelete|Delete this word. Can be undone.
lyricCopy|Copy selected words, durations and relative spacing. Ctrl+C.
lyricCut|Copy and delete selected words. Ctrl+X; can be undone.
lyricPaste|Paste at a chosen original-audio time, recalculating note links.
lyricDeleteSelection|Delete selected lyrics without deleting notes. Can be undone.
lyricPasteSecond|Lyric paste position in original-audio seconds. Clicking score whitespace also sets it.
lyricPasteAtPlayhead|Use the current audio playhead as lyric paste start.
lyricPasteOverwrite|Explicitly allow replacing destination lyrics; notes stay unchanged.
lyricShiftSeconds|Shift selected lyrics by seconds: negative moves earlier, positive later. Linked notes also move when linkage is on.
lyricShiftApply|Move selected words, and linked notes when enabled. Can be undone in one step.
lyricBatchMode|Assign one word per note or share one text item across selected notes.
lyricBatchText|Separate per-note words with spaces or line breaks.
lyricBatchAssign|Assign text to selected notes, replacing links. Empty text clears associations. Can be undone.
lyricReplaceScope|Replace text for selected-note lyrics or the whole lyric set.
lyricBatchFind|Text to find for batch correction.
lyricBatchReplacement|Replacement text.
lyricBatchReplace|Replace text in the chosen scope without changing notes.
draftSectionSelect|Choose a candidate song section.
draftTrackSelect|Choose this section's audio source, such as vocals, guitar, piano or bass.
draftVariantSelect|Choose a recognition alternative for this source; see its explanation below.
draftSlice|Set the section preview/listening start. Return to start uses this position; automatic paging does not change it.
draftSpeed|Shares the main pitch-preserving playback speed.
draftSpeedValue|Enter exact candidate playback speed.
draftSpeedReset|Restore candidate and main playback speed to 1x.
draftZoom|Scale candidate note widths without changing text size or row height.
playDraftOriginal|Play the corresponding original-audio excerpt.
playDraftStem|Play the separated source stem of this candidate.
playDraftDrums|Play drums to compare rhythm and onsets.
playDraftNotes|Play the candidate from the current position or selected note, highlighting against original-audio time.
pauseDraft|Pause or resume candidate playback. Clicking a note sets the resume position.
resumeDraftFollow|Go to the playback page and resume automatic page following.
draftPreviousPage|View the previous page while playback continues from the same position.
draftNextPage|View the next page while playback continues from the same position.
editorToolsTab|Close lyric comparison and show the editing tools.
applyLocalDraft|Back up the old score, then replace the working score with the complete candidate and its time mapping. Not limited by the preview window; can be undone.
exportMuMidi|Export original polyphonic MuScriptor MIDI. This differs from the single-melody score and requires the raw analysis cache.
exportAudit|Export recognition evidence and processing diagnostics for investigation.
exportSVG|Export vector numbered notation with lyrics and notation symbols.
exportMidi|Export the working score as a single MIDI melody.
exportJSON|Save a complete project JSON with a chosen filename. Maximum 32 MB.
exportWav|Render the working score with its project tempo and selected timbre.
exportPDF|Open browser printing and choose Save as PDF.
restoreBackup|Restore the selected project backup after inspecting its name and time.
showPreviousScore|Temporarily inspect the working score from before generation without adopting the candidate.
nextUncertain|Go to the next note not yet manually reviewed.
freeStart|Sequence start beat, counted from 1.
freeAtPlayhead|Use the playhead as text-sequence start.
freeAtSelection|Use the selected note start as text-sequence start.
sectionWindow|Show the whole song and all sections by default. Choose a smaller time window to zoom without changing sections.
sectionPrev|Pan the section waveform backward.
sectionNext|Pan the section waveform forward.
sectionAtPlayhead|Centre the local section view on playback; the whole-song view stays unchanged.
meter|Set the layout time signature. A quarter note is one beat; 6/8 is three beats per bar.
barNumber|Choose the bar to load or edit.
barAtPlayhead|Choose the bar at the playhead.
loadBar|Load this bar's notes into the text editor.
loopBar|Loop this bar using the original-audio time mapping.
barInput|Bar note syntax, for example 1:1 2:0.5. Durations after colons are in beats.
applyBar|Replace this bar with the entered notes. Can be undone.
sectionKey|Notation key used from the start of this bar, keeping actual pitches unchanged.
setSectionKey|Apply this section key until the next key change.
removeSectionKey|Remove the notation-key change at this bar start.
prevNote|Select the previous working-score note.
nextNote|Select the next working-score note.
pitchDown|Lower this note by one semitone. Can be undone.
pitchUp|Raise this note by one semitone. Can be undone.
durationDown|Shorten this note by 0.0625 beat, within the editing precision.
durationUp|Lengthen this note by 0.0625 beat without overlapping later notes.
batchDownOne|Lower selected notes by one semitone; reject the batch if any pitch goes out of range.
batchUpOne|Raise selected notes by one semitone; reject the batch if any pitch goes out of range.
batchDownOctave|Lower selected notes by one octave (12 semitones); reject out-of-range batches.
batchUpOctave|Raise selected notes by one octave (12 semitones); reject out-of-range batches.
batchLyrics|Keep selected notes and open manual and batch lyric editing.
lyricsClose|Close lyrics and return to note-context editing.
targetKey|Choose the target key for actual transposition.
direction|Choose upward or downward actual transposition.
applyTranspose|Transpose actual pitches and notation key. Original audio keeps its key. Can be undone.
midiTrack|Choose one MIDI track as the score's melody.
applyMidi|Preview the selected MIDI track as a candidate, then adopt it.
stopDraftIssueLoop|Stop looping the current diagnostic excerpt.
lyricSplitLeft|Text for the first split item. Set the audio boundary below.
lyricSplitRight|Text for the second split item. Time is not divided automatically.
lyricSplitSecond|Original-audio boundary inside the word's current time range.
lyricSplitConfirm|Split the text at the specified time without changing notes. Can be undone.
backupSelect|Choose a project backup to restore.
inlineLyricDuration|Lyric duration in original-audio seconds. Changes the text endpoint, not note duration.
sequenceStart|Fix the queued sequence start, counted from beat 1. Playback and note selection do not change a nonempty queue's destination.
sequenceAtPlayhead|Explicitly set queue start to playback position, keeping queued actual pitches.
sequenceAtSelection|Use the earliest selected-note start without writing notes.
sequenceOctave|Choose the octave for new notes relative to 1 in the notation key at their position.
sequenceAccidental|Add a sharp or flat to the next chosen degree. Rests are unaffected.
sequenceDuration|Duration of each item, minimum 1/16 beat. Editing an item shifts only later queued items.
sequenceNext|Finish editing an item; subsequent degree clicks append to the queue.
sequenceDelete|Delete the queue item being edited without changing the score.
sequenceRemoveLast|Remove the last uncommitted queue item.
sequenceClear|Clear the uncommitted queue, leaving the score unchanged.
sequenceListen|Preview the whole queue with current time mapping and playback speed without writing it.
sequenceStop|Stop queue playback.
sequenceWrite|Write up to 64 beats at once. Confirm before replacing notes. Rests leave gaps; later notes are not pushed. Undo restores the whole edit.`;
export const EN_CONTROL_HELP=Object.fromEntries(entries.split('\n').map(line=>{const i=line.indexOf('|');return [line.slice(0,i),line.slice(i+1)];}));
for(const [id,original] of Object.entries({inlineLyricSave:'lyricSave',inlineLyricLoop:'lyricLoop',inlineLyricDelete:'lyricDelete',inlineLyricRemap:'lyricRemapPhrase',inlineLyricResplit:'lyricResplitPhrase',inlineLyricChoose:'lyricsChooseNotes',inlineLyricLink:'lyricLink',inlineLyricUnlink:'lyricUnlink',inlineLyricPrev:'lyricPrev',inlineLyricNext:'lyricNext',inlineLyricText:'lyricText',inlineLyricStart:'lyricStart'}))EN_CONTROL_HELP[id]=EN_CONTROL_HELP[original];

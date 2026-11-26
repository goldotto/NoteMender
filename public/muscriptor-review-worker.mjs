import {muVocalSuggestions} from './muscriptor-relabel.mjs';
import {scanMuScriptor} from './muscriptor-review.mjs';

self.onmessage = ({data: {audio, result, stems, action, notes, reference, evidence}}) => {
  try {
    const reply=action==='relabelling'?{groups:muVocalSuggestions(audio,notes,reference,evidence)}:{report:scanMuScriptor(audio,result,stems)};
    self.postMessage(reply);
  } catch (error) {
    self.postMessage({error: error.message});
  }
};

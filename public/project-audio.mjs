// Changing a project must never attach a late response from the previous song.
export class ProjectAudioRestore {
  constructor({load,reset,apply,onError}){Object.assign(this,{load,reset,apply,onError});this.revision=0;}
  invalidate(){return ++this.revision;}
  async restore(project){
    const revision=this.invalidate();this.reset(project);
    const resource=project?.audioResources?.find(r=>r.source==='original');
    if(!resource)return;
    try{const buffer=await this.load(resource);if(revision===this.revision)this.apply(buffer,project);}
    catch(error){if(revision===this.revision)this.onError(error);}
  }
}

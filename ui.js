// Shared presentation for every editor. Existing inputs and handlers retain their identity.
export function prepareEditor() {
  const dialog=document.querySelector('#modal'), body=document.querySelector('#modalBody');
  dialog.classList.remove('editor-wide');delete body.dataset.editorStep;
  body.classList.remove('editor-grid');
  const fields=body.querySelectorAll('input:not([type=checkbox]),select,textarea');
  const wide=fields.length>=6 || !!body.querySelector('#weeklyEditorItems,.lab-notebook,#deckList,#deckImportRaw');
  if(!wide)return;
  dialog.classList.add('editor-wide');body.classList.add('editor-grid');
  for(const child of body.children){
    if(child.matches('label')){
      if(child.querySelector('textarea')&&!child.querySelector('#posLineA,#posLineB,#posRange,#posUpdate,#muMulligan,#muWindows,#muRespect,#muBeats'))child.classList.add('editor-span');
    }else child.classList.add('editor-span');
  }
  const actions=[...body.children].filter(el=>el.matches('button.btn.primary,.btn-row'));
  if(actions.length){
    const footer=document.createElement('div');footer.className='editor-footer editor-span';
    actions.forEach(el=>footer.append(el));body.append(footer);
  }
}

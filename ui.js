export const ARROW = `<svg class="ui-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false"><path d="M5 19 19 5M5 5h14v14"/></svg>`;
// Shared presentation for every editor. Existing inputs and handlers retain their identity.
export function prepareEditor() {
  const dialog=document.querySelector('#modal'), body=document.querySelector('#modalBody');
  dialog.classList.remove('editor-wide');delete body.dataset.editorStep;
  body.classList.remove('editor-grid','position-editor');
  if(body.querySelector('#posQuestion')){
    dialog.classList.add('editor-wide');body.classList.add('editor-grid','position-editor');
    const intro=body.querySelector('p'),save=body.querySelector('#savePositionReview');
    const fields=[['01 · Context',['posQuestion','posMatch','posRole']],['02 · Compare your lines',['posLineA','posLineB','posRange','posUpdate']],['03 · Review the decision',['posTakeaway','posClip','posStatus']]];
    const groups=fields.map(([title,ids])=>{const group=document.createElement('fieldset');group.className='editor-section editor-span';const legend=document.createElement('legend');legend.textContent=title;group.append(legend);const grid=document.createElement('div');grid.className='editor-section-grid';for(const id of ids){const input=body.querySelector('#'+id);if(input){const label=input.closest('label');if(['posQuestion','posTakeaway'].includes(id))label.classList.add('editor-span');grid.append(label);}}group.append(grid);return group;});
    const footer=document.createElement('div');footer.className='editor-footer editor-span';if(save)footer.append(save);
    body.replaceChildren(...[intro,...groups,footer].filter(Boolean));if(intro)intro.classList.add('editor-span');return;
  }
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

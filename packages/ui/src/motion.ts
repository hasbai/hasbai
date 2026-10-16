/** Page changes share one short animation; preference changes cancel it immediately. */
export function pageMotion(node:HTMLElement,key:unknown){
 const preference=matchMedia('(prefers-reduced-motion: reduce)');let animation:Animation|undefined;
 const cancel=()=>animation?.cancel();
 const enter=()=>{cancel();if(!preference.matches)animation=node.animate([{opacity:.65,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});};
 preference.addEventListener('change',cancel);enter();
 return {update(next:unknown){if(next!==key){key=next;enter();}},destroy(){cancel();preference.removeEventListener('change',cancel);}};
}

import {useLayoutEffect, useState, type RefObject} from 'react'
import type {Step} from './scenarios'

type Box = {left:number; top:number; width:number; height:number}
type Scene = {anchor:HTMLElement|null; box:Box|null; x:number; y:number; missing:boolean}
const initial: Scene = {anchor:null,box:null,x:8,y:8,missing:false}
const clamp = (n:number,lo:number,hi:number) => Math.max(lo,Math.min(n,hi))

function scrollingParents(node:HTMLElement) {
  const parents:{el:HTMLElement;x:boolean;y:boolean}[]=[]
  for(let el=node.parentElement; el && el!==document.body; el=el.parentElement) {
    const css=getComputedStyle(el)
    const x=/auto|scroll|hidden|clip/.test(css.overflowX), y=/auto|scroll|hidden|clip/.test(css.overflowY)
    if(x||y) parents.push({el,x,y})
  }
  return parents
}

export function useSpotlight(step:Step, card:RefObject<HTMLElement>) {
  const [scene,setScene] = useState<Scene>(initial)
  useLayoutEffect(() => {
    const surface=card.current!
    let anchor:HTMLElement|null=null, frame=0, followup=0, expired=false
    let parents:ReturnType<typeof scrollingParents>=[]
    const root=document.querySelector<HTMLElement>('[data-learn-app]')!
    const vv=window.visualViewport
    const resize=new ResizeObserver(schedule)
    resize.observe(surface)
    const timeout=window.setTimeout(()=>{expired=true;schedule()},1300)
    function measure() {
      surface.style.setProperty('--learn-vh',(vv?.height??innerHeight)+'px')
      const scope=root.querySelector('[data-learn-view="'+step.view+'"]')
      const query='[data-learn="'+step.target+'"]'
      const source=step.target==='page-heading'?root:scope
      const found=step.target && source ? Array.from(source.querySelectorAll<HTMLElement>(query))
        .find(el=>el.getClientRects().length && el.checkVisibility()) ?? null : null
      if (anchor!==found) {
        if(anchor) resize.unobserve(anchor)
        anchor=found
        if(anchor) {
          resize.observe(anchor)
          parents=scrollingParents(anchor)
          // scrollIntoView reveals the target through *every* scroll container,
          // not just the window. It must complete synchronously before the
          // spotlight rectangle is measured. Smooth scrolling left the outline
          // hidden until the user nudged the page manually.
          anchor.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})
          const r=anchor.getBoundingClientRect(), height=vv?.height??innerHeight
          const sideFits=innerWidth>620 && Math.max(r.left,innerWidth-r.right)>=surface.offsetWidth+22
          if(step.action && !sideFits) {
            // Leave room below for the coaching card when a live form control
            // must remain clickable.
            const free=Math.max(40,height-surface.offsetHeight-20)
            const desired=(vv?.offsetTop??0)+free/2
            window.scrollBy({top:r.top+Math.min(r.height,free)/2-desired,behavior:'instant'})
          }
          // A different route/widget can finish laying out in the next frame.
          // Remeasure even if no browser scroll event was dispatched.
          followup=requestAnimationFrame(schedule)
        }
      }
      const left=vv?.offsetLeft??0, top=vv?.offsetTop??0
      const width=Math.min(document.documentElement.clientWidth,vv?.width??innerWidth), height=vv?.height??innerHeight
      const margin=8, right=left+width, bottom=top+height
      const rect=anchor?.getBoundingClientRect(), panel=surface.getBoundingClientRect()
      let box:Box|null=null
      if(rect && rect.bottom>top && rect.top<bottom && rect.right>left && rect.left<right) {
        let x=Math.max(left,rect.left-3), y=Math.max(top,rect.top-3)
        let endX=Math.min(right,rect.right+3), endY=Math.min(bottom,rect.bottom+3)
        for(const parent of parents) {
          const p=parent.el.getBoundingClientRect()
          if(parent.x) {x=Math.max(x,p.left);endX=Math.min(endX,p.right)}
          if(parent.y) {y=Math.max(y,p.top);endY=Math.min(endY,p.bottom)}
        }
        if(endX>x && endY>y) box={left:x,top:y,width:endX-x,height:endY-y}
      }
      let x=left+(width-panel.width)/2, y=top+(height-panel.height)/2
      if(box) {
        const r=box.left+box.width, b=box.top+box.height
        x=box.left
        if(width>620 && right-r>=panel.width+22) { x=r+12; y=box.top }
        else if(width>620 && box.left-left>=panel.width+22) { x=box.left-panel.width-12; y=box.top }
        else if(bottom-b>=panel.height+16) y=b+8
        else if(box.top-top>=panel.height+16) y=box.top-panel.height-8
        else y=bottom-b >= box.top-top ? bottom-panel.height-margin : top+margin
      } else if (width<=620 && step.target) y=bottom-panel.height-margin
      x=Math.round(clamp(x,left+margin,right-panel.width-margin))
      y=Math.round(clamp(y,top+margin,bottom-panel.height-margin))
      const next={anchor,box,x,y,missing:!!step.target&&!found&&expired}
      setScene(old=>old.anchor===anchor&&old.x===x&&old.y===y&&old.missing===next.missing&&
        old.box?.left===box?.left&&old.box?.top===box?.top&&old.box?.width===box?.width&&old.box?.height===box?.height?old:next)
    }
    function schedule(){ if(!frame) frame=requestAnimationFrame(()=>{frame=0;measure()}) }
    const changes=new MutationObserver(schedule)
    changes.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open','disabled','data-learn']})
    window.addEventListener('scroll',schedule,true)
    window.addEventListener('resize',schedule)
    vv?.addEventListener('resize',schedule)
    vv?.addEventListener('scroll',schedule)
    measure()
    return ()=>{
      clearTimeout(timeout); cancelAnimationFrame(frame); cancelAnimationFrame(followup); changes.disconnect(); resize.disconnect()
      window.removeEventListener('scroll',schedule,true); window.removeEventListener('resize',schedule)
      vv?.removeEventListener('resize',schedule);vv?.removeEventListener('scroll',schedule)
    }
  },[step,card])
  return scene
}

import assert from 'node:assert/strict'

export async function checkCard(page) {
  const errors=await page.locator('[data-training-step]').evaluate(card=>{
    const found=[],rect=card.getBoundingClientRect(),w=document.documentElement.clientWidth,h=innerHeight
    if(rect.left < -1 || rect.top < -1 || rect.right>w+1 || rect.bottom>h+1) found.push('card outside viewport')
    if(card.scrollWidth>card.clientWidth+1) found.push('card content overflows width')
    const quiet=card.querySelector('footer .learn-quiet')
    if(quiet && getComputedStyle(quiet).color!==getComputedStyle(card).color) found.push('footer action text loses its high-contrast color')
    const controls=[...card.querySelectorAll('button')].map(b=>b.getBoundingClientRect())
    for(const [i,a] of controls.entries()){
      if(a.left < rect.left-1 || a.top < rect.top-1 || a.right > rect.right+1 || a.bottom > rect.bottom+1) found.push('clipped button '+i)
      for(const b of controls.slice(i+1)) if(a.left<b.right && b.left<a.right && a.top<b.bottom && b.top<a.bottom) found.push('overlapping buttons')
    }
    const title=card.querySelector('h2').getBoundingClientRect(),body=card.querySelector('#learn-step-text').getBoundingClientRect()
    if(title.bottom>body.top+1) found.push('overlapping title and description')
    return found.map(x=>card.dataset.trainingStep+' '+x+' at '+w+'×'+h)
  })
  assert.deepEqual(errors,[])
}

export async function openedTarget(page, name) {
  const target=page.locator('[data-learn="'+name+'"]:visible').first()
  await target.waitFor()
  await page.waitForFunction(name=>{
    const anchor=[...document.querySelectorAll('[data-learn="'+name+'"]')].find(el=>el.checkVisibility() && el.getClientRects().length)
    if(!anchor) return false
    const r=anchor.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2
    return anchor.contains(document.elementFromPoint(x,y))
  },name,{timeout:4000}).catch(async error=>{
    const details=await target.evaluate(el=>{
      const rect=el.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)
      return {target:rect.toJSON(),hit:hit?.outerHTML.slice(0,180),card:document.querySelector('[data-training-step]')?.getBoundingClientRect().toJSON(),
        ancestors:[el.parentElement,el.parentElement?.parentElement].map(x=>[x?.className,x?.scrollTop,x?.getBoundingClientRect().toJSON()])}
    })
    throw new Error('Inaccessible spotlight '+name+' '+JSON.stringify(details),{cause:error})
  })
  return target
}

/**
 * A guided step must reveal its highlighted control without requiring the
 * user to scroll the page manually. This catches regressions where the ring
 * appears only after a wheel/scroll event.
 */
export async function visibleSpotlight(page, targetName) {
  await page.waitForFunction(name => {
    const candidates=[...document.querySelectorAll('[data-learn="'+name+'"]')]
    const target=candidates.find(el=>el.getClientRects().length && el.checkVisibility())
    const spot=document.querySelector('.learn-spot')
    if(!target || !spot) return false
    const a=target.getBoundingClientRect(), b=spot.getBoundingClientRect()
    const w=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))
    const h=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
    const smaller=Math.min(a.width*a.height,b.width*b.height)
    return b.width>0 && b.height>0 && b.top>=-2 && b.bottom<=innerHeight+2
      && b.left>=-2 && b.right<=document.documentElement.clientWidth+2
      && smaller>0 && w*h/smaller>.45
  },targetName,{timeout:5500})
}

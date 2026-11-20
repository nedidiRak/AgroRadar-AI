import test from 'node:test'
import assert from 'node:assert/strict'
import {adminSteps,observerSteps,practiceStages,topics} from '../src/training/scenarios.ts'

test('both role routes have stable, unique checkpoints and a reachable finish',()=>{
  for(const steps of [adminSteps,observerSteps]){
    assert.equal(steps[0].id,'welcome')
    assert.equal(steps.at(-1).id,'finish')
    assert.equal(new Set(steps.map(s=>s.id)).size,steps.length)
    assert.ok(steps.every(s=>topics[s.topic]&&(!s.action || (s.target&&s.hint))))
  }
})
test('observer steps are read-only with an AI exercise and no editor or farm writes',()=>{
  assert.deepEqual(observerSteps.map(s=>s.id),['welcome','choose-field','weather','precipitation','alerts','risk','question','interpret','finish'])
  assert.ok([...practiceStages].every(id=>adminSteps.some(s=>s.id===id)))
  assert.ok(adminSteps.findIndex(s=>s.id==='studio') < adminSteps.findIndex(s=>practiceStages.has(s.id)))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {columns, decodeWorkspace, freshWorkspace, makeTile, reorder, templateNames, templateTiles, widgets} from '../src/workspaceLayout.ts'
import {initialPreferences} from '../src/uiPreferences.ts'

test('all five templates fit each grid and inherit the existing classic preferences', () => {
  for (const name of Object.keys(templateNames)) for (const device of ['desktop','mobile']) {
    const tiles = templateTiles(name, device)
    assert.equal(new Set(tiles.map(t=>t.id)).size, tiles.length)
    assert.ok(tiles.every(t=>t.x >= 0 && t.x + t.w <= columns(device) && t.w >= Math.min(columns(device), widgets[t.type].minW)))
  }
  assert.deepEqual(templateTiles('classic','mobile',initialPreferences(true)).map(t=>t.type),['fields','forecast','fiveDay'])
})
test('saved instances, empty layouts, independent devices and order survive a round trip', () => {
  const value = freshWorkspace(), profile = value.layouts[0]
  profile.desktop = [makeTile('weather','desktop','a'), {...makeTile('weather','desktop','b'), fieldId:4, x:7,y:6,w:5,h:9}]
  profile.mobile = []
  const restored = decodeWorkspace(JSON.parse(JSON.stringify(value))).layouts[0]
  assert.deepEqual(restored.desktop[1], profile.desktop[1])
  assert.deepEqual(restored.mobile, [])
  assert.deepEqual(reorder(profile.desktop,'b',-1).map(t=>t.id),['b','a'])
  assert.deepEqual(profile.desktop.map(t=>t.id),['a','b'])
})
test('corruption and future formats are explicit; retired widgets do not invalidate siblings', () => {
  for (const bad of [null, {}, {version:2}, {version:1, active:'x', layouts:[]}]) assert.throws(()=>decodeWorkspace(bad))
  const state = freshWorkspace(), tile = makeTile('map','desktop','map')
  state.layouts[0].desktop = [tile, {...tile,id:'retired',type:'oldWidget'}]
  assert.deepEqual(decodeWorkspace(state).layouts[0].desktop.map(t=>t.id),['map'])
  for (const broken of [{...tile,w:'9'}, {...tile,h:-10}, {...tile,x:20}]) {
    state.layouts[0].desktop=[broken]
    assert.throws(()=>decodeWorkspace(state))
  }
})

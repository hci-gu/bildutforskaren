import assert from 'node:assert/strict'
import { test } from 'node:test'
import defaults from '../../../../config.json'
import { availableViewType, enabledViewTypes } from './uiConfig'

test('hidden view types leave the dropdown and the current view falls back to an enabled view', () => {
  const config = structuredClone(defaults)
  config.views.umap.enabled = false
  config.views.year.enabled = false
  assert.deepEqual(enabledViewTypes(config), ['grid', 'tagged', 'graph'])
  assert.equal(availableViewType(config, 'umap', false), 'grid')
  assert.equal(availableViewType(config, 'tagged', false), 'tagged')
})

test('graph requires data and disabling every view produces an empty state', () => {
  const config = structuredClone(defaults)
  for (const view of Object.values(config.views)) view.enabled = false
  assert.equal(availableViewType(config, 'umap', true), null)
  config.views.graph.enabled = true
  assert.equal(availableViewType(config, 'graph', false), null)
  assert.equal(availableViewType(config, 'umap', true), 'graph')
})

test('legacy configuration without enabled flags keeps view types visible', () => {
  const config = structuredClone(defaults)
  for (const view of Object.values(config.views)) Reflect.deleteProperty(view, 'enabled')
  assert.deepEqual(enabledViewTypes(config), Object.keys(defaults.views))
})

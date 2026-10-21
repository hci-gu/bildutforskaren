import assert from 'node:assert/strict'
import { test } from 'node:test'
import defaults from '../../../../config.json'
import { atom, createStore } from 'jotai'
import { configuredAtom } from '../../store/configuredAtom'
import { availableViewType, canvasWidgetEnabled, enabledViewTypes } from './uiConfig'

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

test('disabling Advanced disables all its child widgets while leaving selection controls independent', () => {
  const config = structuredClone(defaults)
  config.views.umap.advanced = false
  for (const widget of ['clusterImages', 'fidelity', 'filter', 'colorPhotographer', 'stability', 'projectionParameters']) {
    assert.equal(canvasWidgetEnabled(config, 'umap', widget), false, widget)
  }
  for (const widget of ['tagPanel', 'reprojectSelection', 'createGraph', 'setAnchorA']) {
    assert.equal(canvasWidgetEnabled(config, 'umap', widget), true, widget)
  }
  config.views.umap.tagPanel = false
  assert.equal(canvasWidgetEnabled(config, 'umap', 'tagPanel'), false)
  assert.equal(canvasWidgetEnabled(config, 'grid', 'tagPanel'), true)
  assert.equal(canvasWidgetEnabled(config, 'grid', 'fidelity'), false)
  assert.equal(canvasWidgetEnabled(config, 'grid', 'explanation'), false)
})

test('hidden features stay false after previous selections and background auto-enable writes', () => {
  const store = createStore()
  const configAtom = atom(structuredClone(defaults))
  const settingsAtom = configuredAtom({ showClusterImages: true, fidelity: true, scale: 2 }, (get, settings) => ({
    ...settings,
    showClusterImages: settings.showClusterImages && canvasWidgetEnabled(get(configAtom), 'umap', 'clusterImages'),
    fidelity: settings.fidelity && canvasWidgetEnabled(get(configAtom), 'umap', 'fidelity'),
  }))
  assert.equal(store.get(settingsAtom).showClusterImages, true)
  store.set(configAtom, (config) => ({ ...config, views: { ...config.views, umap: { ...config.views.umap, advanced: false } } }))
  assert.deepEqual(store.get(settingsAtom), { showClusterImages: false, fidelity: false, scale: 2 })
  store.set(settingsAtom, (previous) => ({ ...previous, showClusterImages: true, fidelity: true }))
  assert.deepEqual(store.get(settingsAtom), { showClusterImages: false, fidelity: false, scale: 2 })
})

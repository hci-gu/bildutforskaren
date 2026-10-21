import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'jotai'
import defaults from '../../../../config.json'
import { uiConfigAtom } from './uiConfig'
import {
  imageViewerRequestAtom,
  openImageViewerAtom,
  selectCanvasImageAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
} from '../../store/imageSelection'

test('selecting an image keeps the manual viewer behavior by default', () => {
  const store = createStore()
  const image = { id: 0, meta: { title: 'Image' } }
  store.set(selectCanvasImageAtom, image)
  assert.deepEqual(store.get(selectedEmbeddingAtom), image)
  assert.deepEqual(store.get(selectedEmbeddingIdsAtom), ['0'])
  assert.equal(store.get(imageViewerRequestAtom), null)
  store.set(openImageViewerAtom, 0)
  assert.equal(store.get(imageViewerRequestAtom)?.imageId, 0)
})

test('configured image selection opens the viewer and can reopen the same image after closing', () => {
  const store = createStore()
  store.set(uiConfigAtom, { ...defaults, openImageOnSelection: true })
  store.set(selectCanvasImageAtom, { id: 5, meta: {} })
  assert.equal(store.get(imageViewerRequestAtom)?.imageId, 5)
  store.set(imageViewerRequestAtom, null)
  store.set(selectedEmbeddingAtom, null)
  store.set(selectCanvasImageAtom, { id: 5, meta: {} })
  assert.equal(store.get(imageViewerRequestAtom)?.imageId, 5)
})

test('metadata updates and bulk selection do not automatically reopen the viewer', () => {
  const store = createStore()
  store.set(uiConfigAtom, { ...defaults, openImageOnSelection: true })
  store.set(selectedEmbeddingIdsAtom, ['1', '2'])
  store.set(selectedEmbeddingAtom, { id: 1, meta: { title: 'Updated metadata' } })
  assert.equal(store.get(imageViewerRequestAtom), null)
  store.set(selectedEmbeddingIdsAtom, ['1'])
  assert.equal(store.get(imageViewerRequestAtom), null)
  store.set(uiConfigAtom, { ...defaults, openImageOnSelection: false })
  store.set(selectCanvasImageAtom, { id: 2, meta: {} })
  assert.equal(store.get(imageViewerRequestAtom), null)
})

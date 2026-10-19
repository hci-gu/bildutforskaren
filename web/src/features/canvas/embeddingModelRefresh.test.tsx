import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore } from 'jotai/vanilla'
import {
  activeDatasetIdAtom,
  anchorAnalysisStatusAtom,
  clusterProfilesStatusAtom,
  conceptLensStatusAtom,
  embeddingsRevisionAtom,
  observeEmbeddingModelAtom,
  neighborFidelityStatusAtom,
  selectedExplainedClusterAtom,
  projectionRevisionAtom,
  projectionStabilityStatusAtom,
} from '../../store'
import { isDatasetActive } from '../datasets/types/datasets'

test('a completed model switch refreshes vectors and clears obsolete analysis state', () => {
  const store = createStore()
  store.set(activeDatasetIdAtom, 'dataset')
  store.set(observeEmbeddingModelAtom, { datasetId: 'dataset', fingerprint: 'clip' })
  store.set(conceptLensStatusAtom, 'ready')
  store.set(clusterProfilesStatusAtom, 'ready')
  store.set(anchorAnalysisStatusAtom, 'ready')
  store.set(projectionStabilityStatusAtom, 'ready')
  store.set(neighborFidelityStatusAtom, 'ready')
  store.set(selectedExplainedClusterAtom, 7)
  store.set(observeEmbeddingModelAtom, { datasetId: 'dataset', fingerprint: 'gemma' })
  assert.equal(store.get(embeddingsRevisionAtom), 1)
  assert.equal(store.get(projectionRevisionAtom), 1)
  assert.equal(store.get(conceptLensStatusAtom), 'idle')
  assert.equal(store.get(clusterProfilesStatusAtom), 'idle')
  assert.equal(store.get(anchorAnalysisStatusAtom), 'idle')
  assert.equal(store.get(projectionStabilityStatusAtom), 'idle')
  assert.equal(store.get(neighborFidelityStatusAtom), 'idle')
  assert.equal(store.get(selectedExplainedClusterAtom), null)
  store.set(observeEmbeddingModelAtom, { datasetId: 'dataset', fingerprint: 'gemma' })
  assert.equal(store.get(embeddingsRevisionAtom), 1)
  store.set(observeEmbeddingModelAtom, { datasetId: 'dataset', fingerprint: 'clip' })
  assert.equal(store.get(embeddingsRevisionAtom), 2)
})

test('a ready dataset still polls while preparing a different model', () => {
  assert.equal(isDatasetActive({ status: 'ready', job: { stage: 'embedding-model' } }), true)
  assert.equal(isDatasetActive({ status: 'ready', job: { stage: 'ready' } }), false)
  assert.equal(isDatasetActive({
    status: 'ready',
    embedding_switch: { target: 'google/embeddinggemma-2', status: 'queued', error: null },
  }), true)
  assert.equal(isDatasetActive({
    status: 'ready',
    embedding_switch: { target: 'google/embeddinggemma-2', status: 'running', error: null },
  }), true)
})

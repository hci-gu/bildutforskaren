import pytest
import json
import io
import numpy as np
from unittest.mock import patch, MagicMock

# Important: This import assumes that your Flask app instance is named 'app'
# and can be imported from 'api.py'. Adjust if your structure is different.
# It also assumes that 'api.py' is in the parent directory or Python path.
from api import app, model, faiss_index, processor, TOP_K, image_paths

# A tiny valid PNG (1x1 pixel, red) as bytes
# (Generated using Pillow: `Image.new('RGB', (1,1), 'red').save(bio, format='PNG')`)
TINY_PNG_BYTES = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90\x77\x58\xde\x00\x00\x00\x0cIDAT\x08\x99c`\x00\x00\x00\x04\x00\x01\xa0\n\x0c\x00\x00\x00\x00IEND\xaeB`\x82'

@pytest.fixture
def client():
    app.config['TESTING'] = True
    # Ensure image_paths is not empty for tests that might use its length
    if not image_paths:
        image_paths.append(MagicMock()) # Add a mock path if empty
        
    with app.test_client() as client:
        yield client

@pytest.fixture
def mock_image_content():
    return TINY_PNG_BYTES

@pytest.fixture
def mock_embedding_tensor():
    # CLIP embeddings are typically 768-dimensional for ViT-L/14
    # Or 512-dimensional for ViT-B/32. The current api.py uses ViT-L/14 (768 dim).
    # Let's assume the model in api.py outputs 768-dim embeddings.
    # The model in api.py is "openai/clip-vit-large-patch14" which has 768 dimensions
    return torch.randn(1, 768) 

# We need torch for the mock_embedding_tensor. api.py already imports it.
# Ensure torch is available or mock its tensor part if not directly testing torch logic.
try:
    import torch
except ImportError:
    # If torch is not available in the test environment for some reason,
    # create a simple mock for tensor to allow tests to run.
    class MockTorchTensor:
        def __init__(self, data):
            self.data = np.array(data)
        def cpu(self):
            return self
        def numpy(self):
            return self.data
        def norm(self, dim, keepdim):
            return self # Simplified
        def __truediv__(self, other):
            return self # Simplified

    torch = MagicMock()
    torch.randn = lambda *args: MockTorchTensor(np.random.randn(*args))
    torch.no_grad = lambda: MagicMock(__enter__=MagicMock(), __exit__=MagicMock())


def test_search_by_image_success(client, mock_image_content, mock_embedding_tensor):
    with patch('api.requests.get') as mock_requests_get, \
         patch('api.Image.open') as mock_image_open, \
         patch.object(processor, '__call__') as mock_processor_call, \
         patch.object(model, 'get_image_features') as mock_get_image_features, \
         patch.object(faiss_index, 'search') as mock_faiss_search:

        # Configure mocks
        mock_response = MagicMock()
        mock_response.content = mock_image_content
        mock_response.raise_for_status = MagicMock()
        mock_requests_get.return_value = mock_response

        mock_pil_image = MagicMock()
        mock_image_open.return_value = mock_pil_image
        mock_pil_image.convert.return_value = mock_pil_image # Return self after convert

        mock_processor_call.return_value = {"pixel_values": torch.randn(1,3,224,224)} # Dummy processed input
        
        mock_get_image_features.return_value = mock_embedding_tensor
        
        # Mock FAISS search results: (Distances, Indices)
        # Ensure indices are within the bounds of image_paths if it's used
        # For simplicity, assume image_paths has at least 2 elements for this test
        if len(image_paths) < 2: image_paths.extend([MagicMock(), MagicMock()])
        
        mock_faiss_search.return_value = (
            np.array([[0.1, 0.2]], dtype='float32'), # Distances
            np.array([[0, 1]], dtype='int64')        # Indices
        )

        # Make the request
        response = client.post('/search_by_image', json={'image_url': 'http://example.com/test.jpg'})

        # Assertions
        assert response.status_code == 200
        data = json.loads(response.data)
        assert len(data) == 2
        assert data[0]['id'] == 0
        assert data[0]['distance'] == pytest.approx(0.1, rel=1e-5)
        assert data[1]['id'] == 1
        assert data[1]['distance'] == pytest.approx(0.2, rel=1e-5)

        mock_requests_get.assert_called_once_with('http://example.com/test.jpg', timeout=10)
        mock_image_open.assert_called_once_with(io.BytesIO(mock_image_content))
        mock_pil_image.convert.assert_called_once_with('RGB')
        mock_processor_call.assert_called_once() # Check args if more specific
        mock_get_image_features.assert_called_once() # Check args if more specific
        
        # Check faiss_index.search call: k defaults to TOP_K (100) from api.py config
        # The query embedding needs to be normalized and reshaped to (1, dim)
        expected_query_embedding = mock_embedding_tensor / mock_embedding_tensor.norm(dim=-1, keepdim=True)
        expected_query_embedding_np = expected_query_embedding.cpu().numpy().reshape(1, -1)
        
        # Use np.testing.assert_array_almost_equal for numpy array comparison
        np.testing.assert_array_almost_equal(mock_faiss_search.call_args[0][0], expected_query_embedding_np)
        assert mock_faiss_search.call_args[0][1] == TOP_K


def test_search_by_image_missing_url(client):
    response = client.post('/search_by_image', json={})
    assert response.status_code == 400
    data = json.loads(response.data)
    assert "Missing 'image_url'" in data['error']

def test_search_by_image_fetch_error(client):
    with patch('api.requests.get') as mock_requests_get:
        mock_requests_get.side_effect = requests.exceptions.RequestException("Connection error")
        
        response = client.post('/search_by_image', json={'image_url': 'http://example.com/test.jpg'})
        
        assert response.status_code == 400 # As per current api.py implementation
        data = json.loads(response.data)
        assert "Error fetching image from URL" in data['error']

def test_search_by_image_pil_error(client, mock_image_content):
    with patch('api.requests.get') as mock_requests_get, \
         patch('api.Image.open') as mock_image_open:
        
        mock_response = MagicMock()
        mock_response.content = mock_image_content 
        mock_response.raise_for_status = MagicMock()
        mock_requests_get.return_value = mock_response
        
        mock_image_open.side_effect = IOError("Cannot open image")
        
        response = client.post('/search_by_image', json={'image_url': 'http://example.com/test.jpg'})
        
        assert response.status_code == 400 # As per current api.py implementation
        data = json.loads(response.data)
        assert "Invalid or unsupported image format" in data['error']


def test_search_by_image_embedding_error(client, mock_image_content):
    with patch('api.requests.get') as mock_requests_get, \
         patch('api.Image.open') as mock_image_open, \
         patch.object(processor, '__call__') as mock_processor_call, \
         patch.object(model, 'get_image_features') as mock_get_image_features:

        mock_response = MagicMock()
        mock_response.content = mock_image_content
        mock_response.raise_for_status = MagicMock()
        mock_requests_get.return_value = mock_response

        mock_pil_image = MagicMock()
        mock_image_open.return_value = mock_pil_image
        mock_pil_image.convert.return_value = mock_pil_image

        mock_processor_call.return_value = {"pixel_values": torch.randn(1,3,224,224)}
        
        mock_get_image_features.side_effect = Exception("Embedding failed")
        
        response = client.post('/search_by_image', json={'image_url': 'http://example.com/test.jpg'})
        
        assert response.status_code == 500
        data = json.loads(response.data)
        assert "Error generating image embedding" in data['error']

def test_search_by_image_faiss_error(client, mock_image_content, mock_embedding_tensor):
    with patch('api.requests.get') as mock_requests_get, \
         patch('api.Image.open') as mock_image_open, \
         patch.object(processor, '__call__') as mock_processor_call, \
         patch.object(model, 'get_image_features') as mock_get_image_features, \
         patch.object(faiss_index, 'search') as mock_faiss_search:

        mock_response = MagicMock()
        mock_response.content = mock_image_content
        mock_response.raise_for_status = MagicMock()
        mock_requests_get.return_value = mock_response

        mock_pil_image = MagicMock()
        mock_image_open.return_value = mock_pil_image
        mock_pil_image.convert.return_value = mock_pil_image
        
        mock_processor_call.return_value = {"pixel_values": torch.randn(1,3,224,224)}
        mock_get_image_features.return_value = mock_embedding_tensor
        
        mock_faiss_search.side_effect = Exception("FAISS search failed")
        
        response = client.post('/search_by_image', json={'image_url': 'http://example.com/test.jpg'})
        
        assert response.status_code == 500
        data = json.loads(response.data)
        assert "Error during similarity search" in data['error']

def test_search_by_image_custom_k(client, mock_image_content, mock_embedding_tensor):
    with patch('api.requests.get'), \
         patch('api.Image.open'), \
         patch.object(processor, '__call__'), \
         patch.object(model, 'get_image_features', return_value=mock_embedding_tensor), \
         patch.object(faiss_index, 'search') as mock_faiss_search:
        
        # Configure mock for faiss_index.search to return based on k
        def faiss_search_side_effect(query_embedding, k_val):
            # Return k_val items
            return (
                np.array([np.arange(k_val, dtype='float32')]), 
                np.array([np.arange(k_val, dtype='int64')])
            )
        mock_faiss_search.side_effect = faiss_search_side_effect
        
        custom_k = 5
        response = client.post('/search_by_image', json={'image_url': 'http://example.com/test.jpg', 'k': custom_k})
        
        assert response.status_code == 200
        data = json.loads(response.data)
        assert len(data) == custom_k # Ensure number of results matches custom k
        
        # Check that faiss_index.search was called with the custom k
        assert mock_faiss_search.call_args[0][1] == custom_k

# This is needed for requests.exceptions.RequestException to be available in the test file context
# when patching.
import requests
class MockRequests:
    # Mock the 'exceptions' attribute
    class exceptions:
        RequestException = type('RequestException', (Exception,), {})

# Replace the actual requests module with our mock during tests for 'api.requests.get'
# This ensures that 'requests.exceptions.RequestException' is known to the patcher.
# This is a bit of a workaround; ideally, the api.py would import 'requests.exceptions'
# or the test would patch 'api.requests.exceptions.RequestException' directly if possible.
# For now, this helps the patcher resolve the type.
api_requests_backup = api.requests
api.requests = MockRequests()

# Teardown to restore original api.requests if necessary (though pytest usually isolates tests)
def teardown_module(module):
    api.requests = api_requests_backup

# Ensure the test file ends with a newline

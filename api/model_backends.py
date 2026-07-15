from __future__ import annotations

import base64
import io
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

os.environ.setdefault(
    "HF_HOME",
    str(Path(__file__).resolve().parents[1] / ".cache" / "huggingface"),
)

import httpx
import torch
from diffusers import AutoPipelineForText2Image
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor

from sd import SD


CAPTION_MODEL = "microsoft/Florence-2-large"
CAPTION_TASK = "<MORE_DETAILED_CAPTION>"
SDXL_MODEL = "stabilityai/sdxl-turbo"
IP_ADAPTER_REPO = os.environ.get("IP_ADAPTER_REPO", "h94/IP-Adapter")
IP_ADAPTER_SUBFOLDER = os.environ.get("IP_ADAPTER_SUBFOLDER", "sdxl_models")
IP_ADAPTER_WEIGHT_NAME = os.environ.get("IP_ADAPTER_WEIGHT_NAME", "ip-adapter_sdxl.bin")
IP_ADAPTER_DEFAULT_SCALE = float(os.environ.get("IP_ADAPTER_DEFAULT_SCALE", "0.9"))


@dataclass(frozen=True)
class CaptionItem:
    id: int
    image_path: Path
    max_new_tokens: int


@dataclass(frozen=True)
class CaptionResult:
    id: int
    ok: bool
    description: str | None = None
    error: str | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class SdxlEmbeddingItem:
    id: int
    prompt: str


@dataclass(frozen=True)
class SdxlEmbeddingResult:
    id: int
    ok: bool
    embedding: dict[str, torch.Tensor] | None = None
    error: str | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class IpAdapterEmbeddingItem:
    id: int
    image_path: Path


@dataclass(frozen=True)
class IpAdapterEmbeddingResult:
    id: int
    ok: bool
    embedding: dict[str, Any] | None = None
    error: str | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class SdxlImageResult:
    ok: bool
    image: bytes | None = None
    error: str | None = None
    duration_ms: int | None = None


def _torch_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _model_dtype(device: str) -> torch.dtype:
    return torch.float16 if device == "cuda" else torch.float32


def _detach_payload(value: Any) -> Any:
    if isinstance(value, torch.Tensor):
        return value.detach().cpu()
    if isinstance(value, dict):
        return {key: _detach_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_detach_payload(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_detach_payload(item) for item in value)
    return value


def encode_embedding_payload(embedding: Any) -> str:
    buffer = io.BytesIO()
    torch.save(_detach_payload(embedding), buffer)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def decode_embedding_payload(payload: str) -> Any:
    raw = base64.b64decode(payload.encode("ascii"))
    return torch.load(io.BytesIO(raw), map_location="cpu")


class LocalModelBackend:
    def __init__(self) -> None:
        self._caption_processor = None
        self._caption_model = None
        self._caption_device = None
        self._sd = None
        self._ip_adapter_pipe = None
        self._ip_adapter_device = None

    def _load_caption_model(self):
        if self._caption_processor is not None and self._caption_model is not None:
            return self._caption_processor, self._caption_model, self._caption_device

        device = _torch_device()
        torch_dtype = _model_dtype(device)
        self._caption_processor = AutoProcessor.from_pretrained(
            CAPTION_MODEL,
            trust_remote_code=True,
        )
        self._caption_model = AutoModelForCausalLM.from_pretrained(
            CAPTION_MODEL,
            torch_dtype=torch_dtype,
            trust_remote_code=True,
        ).to(device)
        self._caption_device = device
        return self._caption_processor, self._caption_model, self._caption_device

    def _load_sd(self) -> SD:
        if self._sd is None:
            self._sd = SD()
        return self._sd

    def _load_ip_adapter_pipe(self):
        if self._ip_adapter_pipe is not None:
            return self._ip_adapter_pipe, self._ip_adapter_device

        device = _torch_device()
        torch_dtype = _model_dtype(device)
        pipe = AutoPipelineForText2Image.from_pretrained(
            SDXL_MODEL,
            torch_dtype=torch_dtype,
        )
        pipe.load_ip_adapter(
            IP_ADAPTER_REPO,
            subfolder=IP_ADAPTER_SUBFOLDER,
            weight_name=IP_ADAPTER_WEIGHT_NAME,
        )
        pipe.set_ip_adapter_scale(IP_ADAPTER_DEFAULT_SCALE)
        pipe.set_progress_bar_config(disable=True)
        pipe = pipe.to(device)

        self._ip_adapter_pipe = pipe
        self._ip_adapter_device = device
        return self._ip_adapter_pipe, self._ip_adapter_device

    def caption_images(self, items: list[CaptionItem]) -> list[CaptionResult]:
        if not items:
            return []

        processor, model, device = self._load_caption_model()
        torch_dtype = _model_dtype(device)
        images = []
        valid_items = []
        results_by_id: dict[int, CaptionResult] = {}

        for item in items:
            try:
                with Image.open(item.image_path) as img:
                    images.append(img.convert("RGB").copy())
                valid_items.append(item)
            except Exception as exc:
                results_by_id[item.id] = CaptionResult(
                    id=item.id,
                    ok=False,
                    error=str(exc),
                )

        if valid_items:
            started_at = time.monotonic()
            texts = [CAPTION_TASK for _ in valid_items]
            inputs = processor(text=texts, images=images, return_tensors="pt").to(
                device,
                torch_dtype,
            )
            with torch.no_grad():
                generated_ids = model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=max(item.max_new_tokens for item in valid_items),
                    num_beams=3,
                    do_sample=False,
                )

            generated_texts = processor.batch_decode(
                generated_ids,
                skip_special_tokens=False,
            )
            batch_duration_ms = int((time.monotonic() - started_at) * 1000)
            per_item_ms = int(batch_duration_ms / max(1, len(valid_items)))
            for item, image, generated_text in zip(valid_items, images, generated_texts):
                parsed = processor.post_process_generation(
                    generated_text,
                    task=CAPTION_TASK,
                    image_size=(image.width, image.height),
                )
                results_by_id[item.id] = CaptionResult(
                    id=item.id,
                    ok=True,
                    description=parsed.get(CAPTION_TASK, generated_text).strip(),
                    duration_ms=per_item_ms,
                )

        return [results_by_id[item.id] for item in items]

    def sdxl_text_embeddings(self, items: list[SdxlEmbeddingItem]) -> list[SdxlEmbeddingResult]:
        if not items:
            return []

        sd = self._load_sd()
        results = []
        for item in items:
            started_at = time.monotonic()
            try:
                prompt_embeds, pooled_prompt_embeds = sd.generate_embedding(item.prompt)
                results.append(
                    SdxlEmbeddingResult(
                        id=item.id,
                        ok=True,
                        embedding={
                            "prompt_embeds": prompt_embeds.detach().cpu(),
                            "pooled_prompt_embeds": pooled_prompt_embeds.detach().cpu(),
                        },
                        duration_ms=int((time.monotonic() - started_at) * 1000),
                    )
                )
            except Exception as exc:
                results.append(SdxlEmbeddingResult(id=item.id, ok=False, error=str(exc)))
        return results

    def ip_adapter_image_embeddings(
        self,
        items: list[IpAdapterEmbeddingItem],
    ) -> list[IpAdapterEmbeddingResult]:
        if not items:
            return []

        pipe, device = self._load_ip_adapter_pipe()
        results = []
        for item in items:
            started_at = time.monotonic()
            try:
                with Image.open(item.image_path) as image:
                    image = image.convert("RGB").copy()
                positive = pipe.prepare_ip_adapter_image_embeds(
                    image,
                    None,
                    device,
                    num_images_per_prompt=1,
                    do_classifier_free_guidance=False,
                )
                classifier_free_guidance = pipe.prepare_ip_adapter_image_embeds(
                    image,
                    None,
                    device,
                    num_images_per_prompt=1,
                    do_classifier_free_guidance=True,
                )
                results.append(
                    IpAdapterEmbeddingResult(
                        id=item.id,
                        ok=True,
                        embedding={
                            "format": "diffusers_ip_adapter_image_embeds",
                            "format_version": 1,
                            "sdxl_model": SDXL_MODEL,
                            "ip_adapter_repo": IP_ADAPTER_REPO,
                            "ip_adapter_subfolder": IP_ADAPTER_SUBFOLDER,
                            "ip_adapter_weight_name": IP_ADAPTER_WEIGHT_NAME,
                            "positive": _detach_payload(positive),
                            "classifier_free_guidance": _detach_payload(
                                classifier_free_guidance
                            ),
                        },
                        duration_ms=int((time.monotonic() - started_at) * 1000),
                    )
                )
            except Exception as exc:
                results.append(
                    IpAdapterEmbeddingResult(id=item.id, ok=False, error=str(exc))
                )
        return results

    def sdxl_image_from_embedding(
        self,
        embedding: dict[str, torch.Tensor],
        *,
        steps: int = 4,
        cfg: float = 0.5,
        size: int = 512,
        seed: int = 1,
    ) -> SdxlImageResult:
        started_at = time.monotonic()
        try:
            sd = self._load_sd()
            image = sd.image_for_embeddings(
                (embedding["prompt_embeds"], embedding["pooled_prompt_embeds"]),
                steps=steps,
                cfg=cfg,
                size=size,
                seed=seed,
            )
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return SdxlImageResult(
                ok=True,
                image=buffer.getvalue(),
                duration_ms=int((time.monotonic() - started_at) * 1000),
            )
        except Exception as exc:
            return SdxlImageResult(ok=False, error=str(exc))

    def sdxl_image_from_ip_adapter_embedding(
        self,
        embedding: dict[str, Any],
        *,
        prompt: str = "",
        negative_prompt: str = "",
        steps: int = 4,
        cfg: float = 0.0,
        size: int = 512,
        seed: int = 1,
        adapter_scale: float = IP_ADAPTER_DEFAULT_SCALE,
    ) -> SdxlImageResult:
        started_at = time.monotonic()
        try:
            pipe, device = self._load_ip_adapter_pipe()
            pipe.set_ip_adapter_scale(adapter_scale)
            key = "classifier_free_guidance" if cfg > 1.0 else "positive"
            image_embeds = embedding[key]
            generator_device = device if device in ("cuda", "mps") else "cpu"
            image = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                ip_adapter_image_embeds=image_embeds,
                num_inference_steps=steps,
                guidance_scale=cfg,
                width=size,
                height=size,
                output_type="pil",
                generator=torch.Generator(device=generator_device).manual_seed(seed),
            ).images[0]
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return SdxlImageResult(
                ok=True,
                image=buffer.getvalue(),
                duration_ms=int((time.monotonic() - started_at) * 1000),
            )
        except Exception as exc:
            return SdxlImageResult(ok=False, error=str(exc))


class RemoteHttpModelBackend:
    def __init__(self, *, base_url: str, timeout: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(f"{self.base_url}{path}", json=payload)
            response.raise_for_status()
            return response.json()

    def caption_images(self, items: list[CaptionItem]) -> list[CaptionResult]:
        payload_items = []
        for item in items:
            raw = item.image_path.read_bytes()
            payload_items.append(
                {
                    "id": item.id,
                    "image_base64": base64.b64encode(raw).decode("ascii"),
                    "max_new_tokens": item.max_new_tokens,
                }
            )

        data = self._post_json("/caption/florence/batch", {"items": payload_items})
        by_id = {
            int(item["id"]): CaptionResult(
                id=int(item["id"]),
                ok=bool(item.get("ok")),
                description=item.get("description"),
                error=item.get("error"),
                duration_ms=item.get("duration_ms"),
            )
            for item in data.get("items", [])
        }
        return [
            by_id.get(item.id)
            or CaptionResult(id=item.id, ok=False, error="Missing result from remote worker")
            for item in items
        ]

    def sdxl_text_embeddings(self, items: list[SdxlEmbeddingItem]) -> list[SdxlEmbeddingResult]:
        payload = {
            "items": [
                {
                    "id": item.id,
                    "prompt": item.prompt,
                }
                for item in items
            ]
        }
        data = self._post_json("/embed/sdxl-text/batch", payload)
        by_id = {}
        for item in data.get("items", []):
            item_id = int(item["id"])
            if item.get("ok"):
                by_id[item_id] = SdxlEmbeddingResult(
                    id=item_id,
                    ok=True,
                    embedding=decode_embedding_payload(item["embedding"]),
                    duration_ms=item.get("duration_ms"),
                )
            else:
                by_id[item_id] = SdxlEmbeddingResult(
                    id=item_id,
                    ok=False,
                    error=item.get("error") or "Remote worker failed",
                )
        return [
            by_id.get(item.id)
            or SdxlEmbeddingResult(id=item.id, ok=False, error="Missing result from remote worker")
            for item in items
        ]

    def ip_adapter_image_embeddings(
        self,
        items: list[IpAdapterEmbeddingItem],
    ) -> list[IpAdapterEmbeddingResult]:
        payload_items = []
        for item in items:
            raw = item.image_path.read_bytes()
            payload_items.append(
                {
                    "id": item.id,
                    "image_base64": base64.b64encode(raw).decode("ascii"),
                }
            )

        data = self._post_json("/embed/ip-adapter-image/batch", {"items": payload_items})
        by_id = {}
        for item in data.get("items", []):
            item_id = int(item["id"])
            if item.get("ok"):
                by_id[item_id] = IpAdapterEmbeddingResult(
                    id=item_id,
                    ok=True,
                    embedding=decode_embedding_payload(item["embedding"]),
                    duration_ms=item.get("duration_ms"),
                )
            else:
                by_id[item_id] = IpAdapterEmbeddingResult(
                    id=item_id,
                    ok=False,
                    error=item.get("error") or "Remote worker failed",
                )
        return [
            by_id.get(item.id)
            or IpAdapterEmbeddingResult(
                id=item.id,
                ok=False,
                error="Missing result from remote worker",
            )
            for item in items
        ]

    def sdxl_image_from_embedding(
        self,
        embedding: dict[str, torch.Tensor],
        *,
        steps: int = 4,
        cfg: float = 0.5,
        size: int = 512,
        seed: int = 1,
    ) -> SdxlImageResult:
        data = self._post_json(
            "/generate/sdxl-image",
            {
                "embedding": encode_embedding_payload(embedding),
                "steps": steps,
                "cfg": cfg,
                "size": size,
                "seed": seed,
            },
        )
        if not data.get("ok"):
            return SdxlImageResult(ok=False, error=data.get("error") or "Remote worker failed")
        return SdxlImageResult(
            ok=True,
            image=base64.b64decode(data["image_base64"].encode("ascii")),
            duration_ms=data.get("duration_ms"),
        )

    def sdxl_image_from_ip_adapter_embedding(
        self,
        embedding: dict[str, Any],
        *,
        prompt: str = "",
        negative_prompt: str = "",
        steps: int = 4,
        cfg: float = 0.0,
        size: int = 512,
        seed: int = 1,
        adapter_scale: float = IP_ADAPTER_DEFAULT_SCALE,
    ) -> SdxlImageResult:
        data = self._post_json(
            "/generate/sdxl-image-from-ip-adapter",
            {
                "embedding": encode_embedding_payload(embedding),
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "steps": steps,
                "cfg": cfg,
                "size": size,
                "seed": seed,
                "adapter_scale": adapter_scale,
            },
        )
        if not data.get("ok"):
            return SdxlImageResult(ok=False, error=data.get("error") or "Remote worker failed")
        return SdxlImageResult(
            ok=True,
            image=base64.b64decode(data["image_base64"].encode("ascii")),
            duration_ms=data.get("duration_ms"),
        )


def get_model_backend() -> LocalModelBackend | RemoteHttpModelBackend:
    backend = os.environ.get("MODEL_BACKEND", "local").strip().lower()
    if backend == "remote":
        url = os.environ.get("MODEL_WORKER_URL", "").strip()
        if not url:
            raise RuntimeError("MODEL_BACKEND=remote requires MODEL_WORKER_URL")
        timeout = float(os.environ.get("MODEL_BACKEND_TIMEOUT", "120"))
        return RemoteHttpModelBackend(base_url=url, timeout=timeout)
    return LocalModelBackend()

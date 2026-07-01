import torch
import os
import time

os.environ.setdefault("HF_HOME", os.path.join(os.path.dirname(__file__), ".cache", "huggingface"))

from diffusers import DiffusionPipeline, AutoencoderTiny
from compel import Compel, ReturnedEmbeddingsType

try:
  import xformers  # noqa: F401
  HAS_XFORMERS = True
except ImportError:
  HAS_XFORMERS = False

try:
  from sfast.compilers.stable_diffusion_pipeline_compiler import (compile, CompilationConfig)
  HAS_SFAST = True
except ImportError:
  HAS_SFAST = False

if torch.backends.mps.is_available():
  device = "mps"
elif torch.cuda.is_available():
  device = "cuda"
else:
  device = "cpu"

torch.set_grad_enabled(False)
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

huggingface_token = os.environ.get('HUGGINGFACE_TOKEN')

class SD:
  def __init__(self):
    torch_dtype = torch.float16 if device in ("cuda", "mps") else torch.float32
    self.base = DiffusionPipeline.from_pretrained("stabilityai/sdxl-turbo", variant="fp16", torch_dtype=torch_dtype, safety_checker=None, requires_safety_checker=False).to(device)
    self.base.vae = AutoencoderTiny.from_pretrained(
      "madebyollin/taesdxl",
      torch_dtype=torch_dtype,
    ).to(device=device, dtype=torch_dtype)
    # self.base.vae = self.base.vae.cuda()

    if HAS_SFAST and device == "cuda":
      config = CompilationConfig.Default()
      config.enable_xformers = HAS_XFORMERS
      config.enable_triton = True
      config.enable_cuda_graph = True

      config.enable_jit = True
      config.enable_jit_freeze = True
      config.trace_scheduler = False
      config.enable_cnn_optimization = True
      config.preserve_parameters = False
      config.prefer_lowp_gemm = True

      self.base = compile(self.base, config)
    self.base.set_progress_bar_config(disable=True)
    # self.compel = Compel(
    #   tokenizer=[self.base.tokenizer, self.base.tokenizer_2],
    #   text_encoder=[self.base.text_encoder, self.base.text_encoder_2],
    #   returned_embeddings_type=ReturnedEmbeddingsType.PENULTIMATE_HIDDEN_STATES_NON_NORMALIZED,
    #   requires_pooled=[False, True]
    # )

  def weightedEmbeds(self, prompt, weight):
    prompt_embeds, pooled_prompt_embeds = self.compel([prompt])

    return (prompt_embeds * weight, pooled_prompt_embeds * weight)
  
  def customEmbedding(self, prompt, weight):
    response = self.base.encode_prompt(prompt)
    prompt_embeds = response[0]
    pooled_prompt_embeds = response[2]

    return (prompt_embeds * weight, pooled_prompt_embeds * weight)

  def generateFromWeightedTextEmbeddings(self, inputs, neg_prompt="", steps=1, cfg=0, size=512, seed=1):

    text_embeddings = [self.customEmbedding(p, w) for (p, w) in inputs]
    prompt_embeddings = torch.stack([t[0] for t in text_embeddings]).sum(0)
    pooled_prompt_embeddings = torch.stack([t[1] for t in text_embeddings]).sum(0)
    print("run base")
    return self.base(
      prompt_embeds=prompt_embeddings,
      pooled_prompt_embeds=pooled_prompt_embeddings,
      num_inference_steps=steps,
      guidance_scale=cfg,
      width=size,
      height=size,
      output_type="pil",
      generator=torch.Generator(device=device).manual_seed(seed),
      return_dict=False
    )[0][0]
  
  def generate_embedding(self, prompt):
    response = self.base.encode_prompt(prompt)
    prompt_embeds = response[0]
    pooled_prompt_embeds = response[2]
    return (prompt_embeds, pooled_prompt_embeds)
  
  def image_for_embeddings(self, embeddings, steps=1, cfg=0, size=512, seed=1):
    prompt_embeds, pooled_prompt_embeds = embeddings
    return self.base(
      prompt_embeds=prompt_embeds,
      pooled_prompt_embeds=pooled_prompt_embeds,
      num_inference_steps=steps,
      guidance_scale=cfg,
      width=size,
      height=size,
      output_type="pil",
      generator=torch.Generator(device=device).manual_seed(seed),
      return_dict=False
    )[0][0]

  def generate(self, prompt, steps=1, cfg=0, size=512, seed=1):
    # if seed is not None:
    #   self.generator = torch.Generator(device="cuda").manual_seed(seed)
    
    prompt_embeds, pooled_prompt_embeds = self.generate_embedding(prompt)
    return self.base(
      prompt_embeds=prompt_embeds,
      pooled_prompt_embeds=pooled_prompt_embeds,
      num_inference_steps=steps,
      guidance_scale=cfg,
      width=size,
      height=size,
      output_type="pil",
      generator=torch.Generator(device=device).manual_seed(seed),
      return_dict=False
    )[0][0]


  # def generate(self, prompt, neg_prompt="", steps=20, cfg=7.5, seed=None):
  #   if seed is not None:
  #     self.generator.manual_seed(seed)
  #   c_embedding = self.getTextEmbedding(prompt)
  #   u_embedding = self.getTextEmbedding(neg_prompt)
  #   text_embeddings = torch.cat([u_embedding, c_embedding])
  #   latents = self.generateLatents()
  #   latents = self.runSteps(latents, text_embeddings, steps=steps, cfg=cfg)
  #   latents = 1 / 0.18215 * latents
  #   image = self.vae.decode(latents).sample
  #   # create PIL image
  #   image = (image / 2 + 0.5).clamp(0, 1)
  #   image = image.detach().cpu().permute(0, 2, 3, 1).numpy()
  #   images = (image * 255).round().astype("uint8")
  #   pil_images = [Image.fromarray(image) for image in images]
  #   return pil_images[0]

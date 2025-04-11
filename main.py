import torch
from diffusers import StableDiffusionPipeline

device = "mps" if torch.backends.mps.is_available() else "cpu"

pipe = StableDiffusionPipeline.from_pretrained(
    "runwayml/stable-diffusion-v1-5",
    torch_dtype=torch.float32  # use float32 for MPS
)

pipe = pipe.to(device)

prompt = "a futuristic city in a bottle"
image = pipe(prompt).images[0]
image.save("output.png")

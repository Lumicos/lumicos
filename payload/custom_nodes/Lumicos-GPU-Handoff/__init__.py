import logging
import torch
import comfy.model_management as mm
from nodes import VAEDecodeTiled

class LumicosReleaseEncoderGPU:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"conditioning": ("CONDITIONING",)}}
    RETURN_TYPES = ("CONDITIONING",)
    FUNCTION = "release"
    CATEGORY = "Lumicos"
    @classmethod
    def IS_CHANGED(cls, conditioning):
        return float("nan")
    def release(self, conditioning):
        before = torch.cuda.memory_reserved()
        mm.unload_all_models()
        mm.soft_empty_cache()
        logging.info("[Lumicos GPU handoff] encoder -> sampler: Torch reserved %d -> %d bytes", before, torch.cuda.memory_reserved())
        return (conditioning,)

class LumicosVAEDecodeTiledSafe(VAEDecodeTiled):
    CATEGORY = "Lumicos"

    def decode(self, vae, samples, tile_size, overlap=64, temporal_size=64, temporal_overlap=8):
        logging.info("[Lumicos VAE] tiled decode %d/%d with MIOpen disabled", tile_size, overlap)
        with torch.backends.cudnn.flags(enabled=False):
            return super().decode(vae, samples, tile_size, overlap, temporal_size, temporal_overlap)

NODE_CLASS_MAPPINGS = {
    "LumicosReleaseEncoderGPU": LumicosReleaseEncoderGPU,
    "LumicosVAEDecodeTiledSafe": LumicosVAEDecodeTiledSafe,
}

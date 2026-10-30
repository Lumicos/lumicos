"""Release diffusion models before VAE decode on memory-constrained AMD GPUs.

The patch is intentionally limited to ComfyUI's VAE decode nodes.  It leaves
sampling, INT8 implementations, Triton, and model loading unchanged.  Releasing
the diffusion model here gives the VAE enough room to load without per-layer
host-buffer streaming while the decoder is running.
"""

import functools
import logging

import comfy.model_management as model_management
import nodes


LOGGER = logging.getLogger("lumicos.vae_handoff")
_PATCH_MARKER = "_lumicos_gpu_handoff_wrapped"


def _release_diffusion_models() -> None:
    # The sampler has produced the latent before a decode node can run.  Finish
    # outstanding GPU work before releasing its model and transfer buffers.
    model_management.synchronize()
    model_management.unload_all_models()
    model_management.soft_empty_cache()
    LOGGER.info("Lumicos VAE handoff: diffusion models unloaded before decode")


def _wrap_decode(node_class) -> None:
    original = node_class.decode
    if getattr(original, _PATCH_MARKER, False):
        return

    @functools.wraps(original)
    def decode_with_gpu_handoff(self, *args, **kwargs):
        _release_diffusion_models()
        return original(self, *args, **kwargs)

    setattr(decode_with_gpu_handoff, _PATCH_MARKER, True)
    node_class.decode = decode_with_gpu_handoff


_wrap_decode(nodes.VAEDecode)
if hasattr(nodes, "VAEDecodeTiled"):
    _wrap_decode(nodes.VAEDecodeTiled)


# ComfyUI loads custom-node modules for their registration side effects.  This
# module patches the built-in decode nodes and does not add a visible graph node.
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


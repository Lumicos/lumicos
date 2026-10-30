# Components and upstream terms

This package is a Lumicos source snapshot plus installer glue. Model weights are not redistributed.
Read each Hugging Face model card and comply with its terms before downloading.

Runtimes fetched during installation retain their upstream licenses:

- Node.js — https://github.com/nodejs/node/blob/main/LICENSE
- uv — https://github.com/astral-sh/uv (MIT / Apache-2.0)
- CPython — https://docs.python.org/3/license.html
- llama.cpp — https://github.com/ggml-org/llama.cpp (MIT)
- whisper.cpp — https://github.com/ggml-org/whisper.cpp (MIT)
- ComfyUI — https://github.com/Comfy-Org/ComfyUI (GPL-3.0)
- ComfyUI-GGUF — https://github.com/city96/ComfyUI-GGUF (see repository license)
- Microsoft Pattara: uses the voice installed on the user system; voice files are not redistributed.
- PyTorch/CUDA/ROCm — respective upstream package and runtime licenses

ComfyUI and GGUF source archives, including license files, are downloaded intact.
Node dependencies are installed from the included package-lock.json; their notices remain in node_modules.
Personal voice references and recorded call fillers are excluded. Avatar/UI assets retain their existing terms; this installer does not grant additional third-party asset rights.

- payload/custom_nodes run inside ComfyUI (GPL-3.0); treat them under ComfyUI's terms when you redistribute them with ComfyUI.
- Everything else in this repository: MIT (see LICENSE).

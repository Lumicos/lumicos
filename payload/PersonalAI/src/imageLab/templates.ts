/** Photo-restyle templates for Image Lab: the user uploads a picture, we run image-to-image with a fixed style prompt. */
export interface LabTemplate {
  id: string;
  group: 'style' | 'mood';
  title: string;
  /** how far the model may depart from the photo (0.1–1): higher = stronger style, less likeness */
  denoise: number;
  prompt: string;
}

const KEEP = 'same subject, same pose and composition as the original photo';

export const LAB_TEMPLATES: LabTemplate[] = [
  { id: 'anime', group: 'style', title: 'อนิเมะ', denoise: 0.72, prompt: `anime illustration, clean line art, vivid cel shading, expressive large eyes, detailed colourful background, studio quality anime key visual, ${KEEP}` },
  { id: 'pixel', group: 'style', title: 'พิกเซลอาร์ต', denoise: 0.8, prompt: `pixel art, 16-bit retro game sprite style, limited colour palette, crisp square pixels, dithering, ${KEEP}` },
  { id: 'cartoon3d', group: 'style', title: '3D การ์ตูน', denoise: 0.7, prompt: `3D animated movie character render, soft rounded shapes, smooth glossy skin, big expressive eyes, subsurface scattering, cinematic studio lighting, pixar style, ${KEEP}` },
  { id: 'watercolor', group: 'style', title: 'สีน้ำ', denoise: 0.68, prompt: `watercolor painting, soft translucent washes, visible paper texture, bleeding pigments, delicate ink outlines, ${KEEP}` },
  { id: 'oil', group: 'style', title: 'สีน้ำมัน', denoise: 0.62, prompt: `classical oil painting, thick visible brush strokes, rich pigment, canvas texture, museum quality, ${KEEP}` },
  { id: 'film', group: 'style', title: 'ฟิล์มเก่า', denoise: 0.45, prompt: `vintage 35mm film photograph, kodak portra tones, soft grain, faded warm colours, light leaks, nostalgic, ${KEEP}` },
  { id: 'sunset', group: 'mood', title: 'ท้องฟ้ายามเย็น', denoise: 0.72, prompt: `dramatic sunset sky filling the background, vivid orange, magenta and purple clouds, strong warm backlight and glowing rim light on the subject, long golden shadows, cinematic golden hour, ${KEEP}` },
  { id: 'golden', group: 'mood', title: 'แสงทอง', denoise: 0.66, prompt: `bright warm golden sunlight streaming in, glowing honey-coloured highlights, soft lens flare, hazy golden atmosphere, dreamy warm colour grading, ${KEEP}` },
  { id: 'fog', group: 'mood', title: 'หมอกเช้า', denoise: 0.72, prompt: `thick morning fog and mist all around, soft diffused cool light, muted blue-grey pastel tones, low contrast, ethereal quiet atmosphere, ${KEEP}` },
  { id: 'neon', group: 'mood', title: 'นีออนกลางคืน', denoise: 0.78, prompt: `night time city street, glowing hot pink and cyan neon signs, strong coloured light on the face, wet reflective ground, dark background, cyberpunk atmosphere, ${KEEP}` },
  { id: 'rain', group: 'mood', title: 'ฝนตก', denoise: 0.74, prompt: `heavy rain falling, rain streaks and water drops, wet glistening surfaces, dark overcast sky, cool blue-grey moody light, puddle reflections, ${KEEP}` },
];

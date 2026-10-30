import type { AIState, Character } from '../../types';

/**
 * Contract every avatar renderer implements.
 * Today: StaticAvatarRenderer (image). Later: a VrmRenderer (Three.js +
 * @pixiv/three-vrm) with the same props, plus optional lip-sync / emotion
 * inputs fed from chatEvents and TTS.
 */
export interface AvatarRendererProps {
  character?: Character;
  state: AIState;
}

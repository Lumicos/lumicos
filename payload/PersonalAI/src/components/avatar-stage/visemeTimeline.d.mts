export type Viseme='A'|'E'|'I'|'O'|'U';
export interface VisemeTimeline {duration:number;entries:Array<{viseme:Viseme;start:number;end:number}>}
export function mapTextToVisemes(text:unknown):Viseme[];
export function createVisemeTimeline(text:unknown,duration:number):VisemeTimeline|null;
export function sampleVisemeTimeline(timeline:VisemeTimeline|null|undefined,seconds:number):Viseme|null;

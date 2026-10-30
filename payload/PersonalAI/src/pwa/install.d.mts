export interface InstallController {getState():{available:boolean;installed:boolean;working:boolean};subscribe(fn:()=>void):()=>void;install():Promise<'installed'|'menu'|'busy'|'accepted'|'dismissed'>;dispose():void}
export function createInstallController(target:any):InstallController;
export const installController:InstallController;
export function registerInstallWorker(navigator:Navigator,secure:boolean,base?:string):Promise<boolean>;

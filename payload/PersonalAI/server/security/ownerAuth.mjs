import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(scryptCallback);
const fail=(message,status=400,code='OWNER_AUTH_ERROR')=>Object.assign(new Error(message),{status,code});

export class OwnerCredentialStore {
 constructor(file){this.file=file;this.record=this.#read()}
 #read(){
  try{
   const value=JSON.parse(fs.readFileSync(this.file,'utf8'));
   if(value.version!==1||value.algorithm!=='scrypt'||typeof value.salt!=='string'||typeof value.hash!=='string')throw Error('invalid owner credential record');
   return value;
  }catch(error){if(error.code==='ENOENT')return null;throw fail('Owner credential store is invalid',500,'OWNER_AUTH_CONFIG_INVALID')}
 }
 get configured(){return this.record!==null}
 async enroll(password){
  if(this.record)throw fail('Owner authentication is already configured',409,'OWNER_ALREADY_CONFIGURED');
  this.#validate(password);
  const salt=randomBytes(32),hash=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  const record={version:1,algorithm:'scrypt',salt:salt.toString('base64'),hash:Buffer.from(hash).toString('base64'),createdAt:new Date().toISOString()};
  fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(record,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  fs.renameSync(temp,this.file);try{fs.chmodSync(this.file,0o600)}catch{}
  this.record=record;
 }
 async verify(password){
  if(!this.record||typeof password!=='string'||password.length>256)return false;
  const expected=Buffer.from(this.record.hash,'base64');
  const actual=Buffer.from(await scrypt(password,Buffer.from(this.record.salt,'base64'),expected.length,{N:32768,r:8,p:1,maxmem:64*1024*1024}));
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
 }
 #validate(password){
  if(typeof password!=='string'||password.length<14||password.length>256)throw fail('Owner password must contain 14–256 characters',400,'WEAK_OWNER_PASSWORD');
  if(!/[A-Za-z\p{L}]/u.test(password)||!/[0-9]/u.test(password))throw fail('Owner password must include letters and numbers',400,'WEAK_OWNER_PASSWORD');
 }
}

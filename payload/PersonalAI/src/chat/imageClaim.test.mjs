import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unsubmittedImageClaim} from './imageClaim.mjs';
test('unsupported progress claims are detected without executing a tool',()=>{
 for(const text of ['กำลังสร้างภาพแมวให้ค่ะ','I am generating an image of a cat.','เรากำลังเจนรูปค่ะ'])assert.equal(unsubmittedImageClaim(text),true);
 assert.equal(unsubmittedImageClaim('ภาพนี้เป็นแมวสีส้ม'),false);
 assert.equal(unsubmittedImageClaim('ยังไม่ได้สร้างภาพ'),false);
 assert.equal(unsubmittedImageClaim('กำลังสร้างภาพ', [{tool:'generate_image',status:'error'}]),true);
 assert.equal(unsubmittedImageClaim('กำลังสร้างภาพ', [{tool:'generate_image',status:'done',data:{jobId:'job'}}]),false);
});

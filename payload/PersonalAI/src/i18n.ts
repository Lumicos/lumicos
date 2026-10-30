/**
 * UI language (Thai / English). The app's labels are written in code; this module translates the
 * visible interface labels at the DOM level using one dictionary, so every screen follows the choice.
 * Chat messages, memories and user content are never touched (see SKIP).
 * "{}" in an entry matches any text and is carried across.
 */
export type Lang = 'th' | 'en';
const KEY = 'lumicos.lang';
const EVENT = 'lumicos-lang';

// [Thai, English]
const PAIRS: [string, string][] = [
  // merge mode
  ['รวมภาพ', 'Merge images'], ['รวม 2–4 รูปเป็นภาพเดียว เช่น คนจากรูปหนึ่ง สินค้าจากอีกรูป', 'Combine 2–4 photos into one, e.g. a person from one and a product from another'],
  ['เลือกภาพ 2–4 ภาพ', 'Choose 2–4 images'], ['เพิ่มภาพ', 'Add image'], ['กำลังรวมภาพ…', 'Merging images…'],
  ['เลือกภาพอย่างน้อย 2 ภาพ', 'Choose at least 2 images'], ['พิมพ์ว่าจะรวมภาพยังไง เช่น ให้คนในภาพ 1 ถือสินค้าในภาพ 2', 'Describe how to merge them, e.g. the person in image 1 holds the product in image 2'],
  ['รวมได้สูงสุด 4 ภาพ', 'You can merge up to 4 images'],
  ['ลำดับภาพคือเลขที่มุมภาพ ใช้อ้างในคำสั่ง เช่น "ภาพ 1", "ภาพ 2"', 'The number in each corner is the image order, use it in your instruction, e.g. "image 1", "image 2"'],
  ['ใช้เวลาราว 1–2 นาที (Flux 3 คงใบหน้าและหน้าตาสินค้าเดิม)', 'Takes about 1–2 minutes (Flux 3 keeps faces and product designs)'],
  ['เลือกภาพ 2–4 ภาพ แล้วพิมพ์ว่าจะรวมยังไง โดยเรียกตามลำดับ เช่น "ให้คนในภาพ 1 ถือขวดในภาพ 2" คงใบหน้าและหน้าตาสินค้าเดิม (Flux 3) ใช้เวลาราว 1–2 นาที', 'Pick 2–4 images and describe how to combine them, referring to them in order, e.g. "put the person in image 1 holding the bottle in image 2". Keeps faces and product designs (Flux 3). Takes about 1–2 minutes.'],
  // reference mode
  ['อ้างอิงภาพ', 'Reference image'], ['สร้างภาพใหม่ โดยใช้คนหรือสินค้าจากรูปอ้างอิง', 'Create a new image using a person or product from reference photos'],
  ['เลือกภาพอ้างอิง 1–4 ภาพ', 'Choose 1–4 reference images'], ['กำลังสร้างภาพจากภาพอ้างอิง…', 'Generating from reference…'],
  ['เลือกภาพอ้างอิงอย่างน้อย 1 ภาพ', 'Choose at least 1 reference image'], ['พิมพ์ว่าอยากได้ภาพใหม่แบบไหน เช่น ผู้หญิงในภาพ 1 ยืนที่ชายหาดตอนเย็น', 'Describe the new picture, e.g. the woman in image 1 standing on a beach at sunset'],
  ['ใช้เวลาราว 1–3 นาที (Flux 3 คงใบหน้าและหน้าตาสินค้าจากภาพอ้างอิง)', 'Takes about 1–3 minutes (Flux 3 keeps faces and product designs from the references)'],
  // queue / album select
  ['คิวงาน', 'Job queue'], ['คิวงาน · กำลังทำ {}', 'Job queue · {} running'], ['ล้างที่เสร็จแล้ว', 'Clear finished'], ['ยกเลิก', 'Cancel'], ['เอาออกจากคิว', 'Remove from queue'],
  ['รอคิว…', 'Waiting in queue…'], ['เสร็จแล้ว', 'Done'], ['เสร็จแล้ว · กดเพื่อดู', 'Done · tap to view'], ['กำลังส่งภาพ…', 'Sending image…'], ['ไม่สำเร็จ', 'Failed'], ['ยกเลิกแล้ว', 'Cancelled'],
  ['กำลังแปลงภาพ…', 'Converting…'], ['กำลังแก้ภาพ…', 'Editing…'], ['กำลังสร้างภาพ…', 'Generating…'], ['กำลังลบพื้นหลัง…', 'Removing background…'], ['กำลังอัปสเกล…', 'Upscaling…'],
  [' · ต่อคิว', ' · Add to queue'], ['อัลบั้มภาพ', 'Album'], ['เลือกหลายรูป', 'Select multiple'], ['เลือกแล้ว {} ภาพ', '{} selected'], ['เลือกทั้งหมด', 'Select all'], ['ล้างที่เลือก', 'Clear selection'], ['ลบที่เลือก', 'Delete selected'], ['เสร็จ', 'Done'], ['เลือกภาพ', 'Select image'],
  ['แก้ไข', 'Edit'],
  // navigation / sidebar
  ['แชตใหม่', 'New chat'], ['แชทใหม่', 'New chat'], ['โรลเพลย์ใหม่', 'New roleplay'], ['ค้นหาแชต', 'Search chats'], ['ล้างการค้นหา', 'Clear search'],
  ['แชต', 'Chat'], ['แชท', 'Chat'], ['ความจำ', 'Memory'], ['ไฟล์', 'Files'], ['คลังภาพ', 'Gallery'], ['ตั้งค่า', 'Settings'],
  ['เปิดแถบข้าง', 'Open sidebar'], ['ปิดแถบข้าง', 'Collapse sidebar'], ['ประวัติแชท', 'Chat history'], ['ประวัติ', 'History'],
  ['แชตทั้งหมด', 'All chats'], ['ตัวละคร', 'Characters'], ['จัดการตัวละคร', 'Manage characters'], ['เครื่องมือ Lumicos', 'Lumicos tools'],
  ['เปิดเมนูและประวัติแชท', 'Open menu and chat history'], ['การนำทางหลัก', 'Main navigation'], ['ล้างแชท', 'Clear chat'],
  ['ลบแชท?', 'Delete chat?'], ['เปลี่ยนชื่อ', 'Rename'], ['ลบ', 'Delete'], ['บันทึก', 'Save'], ['ยกเลิก', 'Cancel'], ['แก้ไข', 'Edit'],
  ['บริการในเครื่องยังไม่เปิด', 'Local service offline'],
  // chat
  ['วันนี้ให้ฉันช่วยอะไรดีคะ?', 'How can I help today?'], ['วันนี้ให้ช่วยอะไรดี?', 'How can I help today?'],
  ['คุย วางแผน หรือเริ่มไอเดียใหม่ไปด้วยกัน', 'Chat, plan, or start a new idea together'],
  ['สรุปเอกสาร', 'Summarize a document'], ['สรุปใจความสำคัญจากไฟล์ของคุณ', 'Get the key points from your files'],
  ['สร้างภาพ', 'Create image'], ['เปลี่ยนไอเดียของคุณให้เป็นภาพ', 'Turn your ideas into pictures'],
  ['วางแผนวันนี้', 'Plan my day'], ['จัดการเวลาและสิ่งที่ต้องทำ', 'Organize your time and tasks'],
  ['พิมพ์ข้อความถึง {}…', 'Message {}…'], ['เลื่อนไปข้อความล่าสุด', 'Scroll to latest'], ['ล้างแชทนี้?', 'Clear this chat?'],
  ['แนบไฟล์', 'Attach file'], ['แนบไฟล์ / รูปภาพ', 'Attach file / image'], ['หยุดสร้างคำตอบ', 'Stop generating'], ['ส่ง', 'Send'],
  ['วิเคราะห์ / อธิบายภาพ', 'Analyze / describe image'], ['ชอบคำตอบนี้', 'Like this reply'], ['ไม่ชอบคำตอบนี้', 'Dislike this reply'],
  ['สร้างคำตอบใหม่', 'Regenerate'], ['กำลังคิด', 'Thinking'], ['พรอมต์ที่ใช้สร้างภาพ', 'Prompt used for the image'], ['ใช้พรอมต์นี้อีกครั้ง', 'Use this prompt again'],
  ['แก้ไขภาพ', 'Edit image'], ['ข้อความแรก', 'First message'], ['หยุดแล้ว', 'Stopped'], ['แก้ไขแล้ว', 'edited'],
  ['บันทึกและส่งใหม่', 'Save & send'], ['การบันทึกจะส่งใหม่ตั้งแต่ข้อความนี้', 'Saving resends from this message.'],
  ['การคิดในแชท', 'Chat reasoning'], ['ระดับการคิด', 'Reasoning level'], ['โมเดล', 'Model'], ['ความเร็ว', 'Speed'],
  ['ตั้งค่าโมเดลและระดับการคิด', 'Model and reasoning settings'],
  ['โหมดสาธิต', 'Demo mode'], ['เสียง', 'Voice'], ['โทรคุย', 'Voice call'], ['วางสาย', 'Hang up'], ['โทรคุยด้วยเสียง', 'Start a voice call'],
  ['ยกเลิกเสียง', 'Cancel recording'], ['ถูกต้อง เก็บไว้', 'Correct, keep it'], ['ไม่ต้อง', 'No thanks'],
  // settings
  ['ทั่วไป', 'General'], ['การเชื่อมต่อ LLM', 'LLM connection'], ['การสร้างคำตอบ', 'Generation'], ['พรอมต์ระบบ', 'System prompt'],
  ['ฐานความรู้', 'Knowledge'], ['ไฟล์และเครื่องมือ', 'Files & tools'], ['สิทธิ์เจ้าของ', 'Owner access'],
  ['สำหรับนักพัฒนา', 'Developer'], ['รูปลักษณ์', 'Appearance'], ['ธีม', 'Theme'], ['แสงเรืองโลโก้', 'Logo glow'], ['ความหนาแน่น', 'Density'],
  ['โหมด', 'Mode'], ['ขนาดตัวอักษร', 'Text size'], ['ความกว้างแชต', 'Chat width'], ['ส่วนติดต่อผู้ใช้', 'Interface'], ['ชื่อของคุณ', 'Your name'],
  ['กด Enter เพื่อส่งข้อความ', 'Enter sends the message'], ['ปิด: Ctrl+Enter ส่ง, Enter ขึ้นบรรทัดใหม่', 'Off: Ctrl+Enter sends, Enter adds a line.'],
  ['แสดงกระบวนการคิดของโมเดล', 'Show model thought process'], ['เมื่อเซิร์ฟเวอร์ส่งส่วนการคิดแยกมา', 'When the server returns reasoning separately.'],
  ['โมเดลปกติ (Z-Image)', 'Default model (Z-Image)'], ['Moss 4 step', 'Moss 4 step'], ['พิมพ์คำอธิบาย แล้วเลือกโมเดลสร้างภาพใหม่ (Z-Image / Moss)', 'Describe it and pick a model to create a new image (Z-Image / Moss)'],
  ['โมเดล AI', 'AI model'], ['การสุ่ม', 'Sampling'], ['อุณหภูมิ', 'Temperature'],
  ['สูง = สร้างสรรค์ขึ้น, ต่ำ = นิ่งขึ้น', 'Higher = more creative, lower = more focused.'], ['โทเคนสูงสุด', 'Max tokens'], ['ขีดจำกัดต่อหนึ่งคำตอบ', 'Upper limit for one reply.'],
  ['พรอมต์ระบบรวม', 'Global system prompt'], ['ตัวละครปัจจุบัน', 'Current character'], ['การจัดการข้อความแรก', 'First message handling'], ['ตัวอย่างพรอมต์', 'Prompt preview'],
  ['ความจำระยะยาว', 'Long-term memory'], ['ใช้ความจำระยะยาว', 'Use long-term memory'], ['แนะนำความจำจากข้อความของฉัน', 'Suggest memories from my messages'],
  ['ความจำต่อหนึ่งคำตอบ', 'Memories per reply'], ['การค้นฐานความรู้', 'Knowledge retrieval'], ['ใช้ฐานความรู้', 'Use Knowledge'],
  ['เก็บข้อมูลจากเว็บเข้าคลัง', 'Save web findings to the library'], ['AI ใช้เครื่องมือได้เมื่อไร?', 'When can the AI use tools?'],
  ['สิทธิ์', 'Permissions'], ['ถามก่อนแก้ไฟล์', 'Ask before changing files'], ['จำนวนขั้นเครื่องมือสูงสุดต่อคำตอบ', 'Max tool steps per reply'],
  ['กันเครื่องมือวนลูปไม่หยุด', 'Stops runaway tool loops.'], ['พื้นที่ทำงาน', 'Workspace'], ['มุมมองดีบัก', 'Debug views'],
  ['แสดงข้อมูลเครื่องมือดิบ', 'Show raw tool data'], ['ผู้ให้บริการ', 'Provider'], ['ที่อยู่เซิร์ฟเวอร์', 'Server URL'], ['ข้อมูล', 'Data'],
  ['มีการเปลี่ยนแปลงที่ยังไม่บันทึก', 'Unsaved changes'], ['การตั้งค่าเก็บไว้ในคอมพิวเตอร์เครื่องนี้', 'Settings are stored on this computer.'],
  ['คืนค่าเริ่มต้น', 'Reset to default'], ['แก้ไขตัวละคร', 'Edit characters'], ['ส่งออกข้อมูลสำรอง', 'Export backup'], ['นำเข้าข้อมูลสำรอง', 'Import backup'],
  ['แคชไฟล์แนบ', 'Attachment cache'], ['ล้าง', 'Clear'], ['บริการในเครื่องกำลังทำงาน', 'Local service is running.'],
  ['ขาวดำ', 'Monochrome'], ['สบายตา', 'Comfortable'], ['กระชับ', 'Compact'], ['มืด', 'Dark'], ['สว่าง', 'Light'], ['ตามระบบ', 'Follow system'],
  ['เล็ก', 'Small'], ['กลาง', 'Medium'], ['ใหญ่', 'Large'], ['แคบ', 'Narrow'], ['กว้าง', 'Wide'],
  ['ถามก่อน', 'Ask first'], ['อัตโนมัติ', 'Automatic'], ['ปิด', 'Off'], ['โหมดค้นเว็บ', 'Web Search mode'],
  ['การยืนยันตัวเจ้าของ', 'Owner authorization'], ['รหัสเจ้าของ', 'Owner password'], ['ออกจาก Owner session', 'Sign out of owner session'],
  // characters
  ['ตัวละคร', 'Character'], ['ทำสำเนา', 'Duplicate'], ['ตัวตน', 'Identity'], ['อัปโหลดรูปประจำตัว', 'Upload avatar'], ['ลบรูปประจำตัว', 'Remove avatar'],
  ['ชื่อ', 'Name'], ['ชื่อเล่น', 'Nickname'], ['คำอธิบาย', 'Description'], ['บุคลิกและน้ำเสียง', 'Personality & voice'], ['บุคลิก', 'Personality'],
  ['สไตล์การพูด', 'Speaking style'], ['ความสัมพันธ์และกฎ', 'Relationship & rules'], ['ความสัมพันธ์กับผู้ใช้', 'Relationship with user'],
  ['กฎการประพฤติ', 'Behavior rules'], ['ขั้นสูง', 'Advanced'], ['คำสั่งเพิ่มเติม', 'Additional instructions'], ['คำทักทาย', 'Greeting'],
  ['ตัวละครใหม่', 'New character'], ['โปรไฟล์', 'Profile'], ['บันทึกแล้ว', 'Saved'], ['ไม่บังคับ', 'optional'], ['ทิ้งการเปลี่ยนแปลง?', 'Discard changes?'],
  // models
  ['โมเดลในรายการ', 'Models in list'], ['โฟลเดอร์โมเดล', 'Model folders'], ['เพิ่มโฟลเดอร์', 'Add folder'], ['เพิ่มโฟลเดอร์โมเดล', 'Add model folder'],
  ['เพิ่มเข้ารายการ', 'Add to list'], ['กำลังใช้', 'In use'], ['ไม่พบไฟล์', 'File not found'], ['ดูภาพได้', 'Sees images'], ['ใช้เครื่องมือได้', 'Uses tools'], ['ใช้ตอนโทร', 'Used in calls'],
  ['กำลังโหลดรายการโมเดล…', 'Loading models…'], ['ใหม่ในโฟลเดอร์โมเดล', 'New in model folder'], ['ยังไม่เคยใช้ · กดเพื่อโหลด', 'Not used yet · tap to load'],
  ['เปลี่ยนโมเดลได้หลังคำตอบปัจจุบันเสร็จ', 'You can switch models after the current reply finishes'],
  ['ไม่ค้นหาในโฟลเดอร์นี้', 'Stop scanning this folder'], ['เอาออกจากรายการ (ไม่ลบไฟล์)', 'Remove from list (keeps the file)'],
  // gallery
  ['ทั้งหมด', 'All'], ['อัปสเกล', 'Upscale'], ['แต่งภาพ', 'Edit'], ['สร้าง', 'Generated'], ['แต่ง', 'Edited'],
  ['ภาพที่สร้าง แต่ง และอัปสเกลทั้งหมด · แตะภาพเพื่อดู · ดาวน์โหลดได้ในหน้าดูภาพ', 'All generated, edited and upscaled pictures · tap a picture to view · download from the viewer'],
  ['ลบภาพ', 'Delete image'], ['กำลังโหลด…', 'Loading…'], ['ยังไม่มีภาพในหมวดนี้', 'No pictures in this category yet'],
  // image lab
  ['ขยายขอบ', 'Extend'], ['เติม / แก้', 'Fill / Edit'], ['ก่อน', 'Before'], ['หลัง', 'After'], ['หยุด', 'Stop'], ['เปลี่ยนภาพ', 'Change image'],
  ['วางภาพที่นี่ หรือกดเพื่อเลือก', 'Drop an image here or click to choose'], ['PNG / JPG ไม่เกิน 20 MB', 'PNG / JPG, up to 20 MB'],
  ['พิมพ์คำอธิบายภาพทางขวา แล้วกดสร้าง', 'Describe the picture on the right, then press Create'], ['หรือไปแท็บอื่นเพื่อแต่งภาพที่มีอยู่', 'Or use another tab to edit an existing picture'],
  ['แก้ต่อจากผลนี้', 'Keep editing this result'], ['เริ่มภาพใหม่', 'Start a new image'], ['อัปสเกลผลนี้', 'Upscale this result'], ['บันทึกภาพ', 'Save image'],
  ['กดค้างที่ภาพเพื่อดูภาพก่อนแก้ หรือกดสลับด้านล่าง', 'Hold the picture to see the original, or use the switch below'],
  ['ซ้าย-ขวา', 'Left–right'], ['บน-ล่าง', 'Top–bottom'], ['ทุกด้าน', 'All sides'], ['ระบาย', 'Paint'], ['ยางลบ', 'Eraser'], ['ย้อน', 'Undo'],
  ['ขยายภาพ', 'Extend image'], ['เติม / แก้ภาพ', 'Fill / edit image'], ['2 เท่า', '2×'], ['4 เท่า', '4×'],
  ['อัปสเกลให้อัตโนมัติ (ช้าลง แต่ภาพคมขึ้น)', 'Upscale automatically (slower, sharper)'],
  ['ใช้เวลาราว 10–40 วินาที', 'Takes about 10–40 seconds'], ['ใช้เวลาราว 40–90 วินาที (รอบแรกนานกว่าเพราะเปิด ComfyUI)', 'Takes about 40–90 seconds (the first run is slower while ComfyUI starts)'],
  ['ใช้เวลาราว 50–100 วินาที (รอบแรกนานกว่าเพราะเปิด ComfyUI) · ไม่อัปสเกลให้อัตโนมัติ', 'Takes about 50–100 seconds (the first run is slower while ComfyUI starts) · no automatic upscale'],
  ['ต้องเปิดบริการ PersonalAI ก่อน', 'Start the PersonalAI service first'],
  ['เช่น แมวสีส้มนั่งริมหน้าต่าง แสงยามเย็น สไตล์ภาพถ่าย', 'e.g. an orange cat by the window, evening light, photo style'],
  ['เช่น ถือแอปเปิ้ลในมือ · เปลี่ยนเสื้อเป็นสีแดง · ลบ', 'e.g. holding an apple · change the shirt to red · remove'],
  ['ฉากที่ต่อออกไปมีอะไร (ไม่บังคับ)…', 'What should the extended scene contain? (optional)…'],
  ['พิมพ์บอกว่าอยากได้ภาพอะไร (ภาษาไทยได้เลย ส่งตรงไปที่โมเดลภาพ) เลือกขนาด แล้วกดสร้าง ภาพที่ได้จะเก็บไว้ในคลังภาพ', 'Describe the picture you want (Thai works, it goes straight to the image model), choose a size, then press Create. Results are kept in the Gallery.'],
  ['จับที่แถบสีบนขอบภาพแล้วลากออกไปด้านที่อยากขยาย จากนั้นพิมพ์ว่าฉากที่ต่อออกไปควรมีอะไร (ไม่พิมพ์ก็ได้)', 'Drag a coloured bar on the picture edge outwards, then describe what the new area should show (optional).'],
  ['ทำภาพให้คมและใหญ่ขึ้น ไม่เปลี่ยนเนื้อหา ใช้แยกจากการขยายขอบ เลือกเองเมื่อต้องการ', 'Make the picture sharper and larger without changing its content. Separate from Extend; choose it only when you want it.'],
  // theme
  ['คลังธีม', 'Theme library'], ['ธีมที่ AI ออกแบบ', 'Themes designed by AI'], ['ธีมสำเร็จรูป', 'Ready-made themes'], ['ย้อนกลับ', 'Revert'], ['กลับธีมเดิมของแอป', 'Back to the app theme'],
  ['เปลี่ยนธีมแล้ว', 'Theme changed'], ['ใช้', 'Use'], ['ใช้อยู่', 'In use'],
  ['ยังไม่มี ลองให้ Nova ออกแบบให้สักธีม', 'None yet. Ask Nova to design one.'],
  ['ทะเลยามเย็น', 'Evening sea'], ['ซากุระ', 'Sakura'], ['ป่าฝน', 'Rainforest'], ['อาทิตย์อัสดง', 'Sunset'], ['กระดาษ', 'Paper'], ['น้ำแข็ง', 'Ice'], ['ราตรีทอง', 'Golden night'],
  ['แตะธีมเพื่อใช้ทันที · บอก Nova ให้ออกแบบธีมใหม่ได้ เช่น “ทำธีมโทนทะเลยามเย็น” แล้วธีมจะมาอยู่ในนี้ · ธีมเก็บแยกในแต่ละเครื่อง', 'Tap a theme to use it · ask Nova to design a new one, e.g. “make an evening-sea theme”, and it appears here · themes are stored per device'],
  ['ช่องข้อมูลของตัวละครเอง (บุคลิก สไตล์การพูด ความสัมพันธ์ กฎ คำสั่งเพิ่มเติม) แยกจากพรอมต์ระบบรวม และแก้ไขได้ในหน้าแก้ไขตัวละคร', 'The character’s own fields (personality, speaking style, relationship, rules, extra instructions) are kept separate from the global system prompt and edited in the character editor.'],
  ['โรลเพลย์', 'Roleplay'], ['เปิดหน้าเลือกตัวละครเพื่อเริ่มโรลเพลย์', 'Choose a character to start a roleplay'], ['เปิด', 'Open'],
  ['โหมดโรลเพลย์ซ่อนไว้ที่นี่ เลือกตัวละครแล้วกดเริ่มโรลเพลย์ในหน้าจัดการตัวละคร แชตโรลเพลย์ไม่ใช้เว็บ คลังความรู้ หรือความจำ', 'Roleplay mode lives here. Pick a character and press Start roleplay in the character manager. Roleplay chats do not use the web, knowledge or memory.'],
  ['แสดงตัวละครโรลเพลย์ในหน้าเลือก Agent', 'Show roleplay characters in the agent picker'], ['ปิดไว้: เลือก Agent ได้เฉพาะ Nova', 'Off: only Nova can be picked'],
  ['เริ่มต้น', 'Get started'], ['พิมพ์คำอธิบาย แล้วสร้างภาพใหม่', 'Describe it and create a new picture'], ['ระบายส่วนที่จะเปลี่ยน แล้วสั่งด้วยข้อความ', 'Paint the part to change, then describe it'],
  ['ต่อภาพให้กว้างหรือสูงขึ้น', 'Extend the picture wider or taller'], ['ทำภาพให้คมและใหญ่ขึ้น', 'Make the picture sharper and larger'],
  ['เลือกภาพเพื่อแต่ง', 'Choose an image to edit'], ['พิมพ์เพื่อสร้างภาพ', 'Type to create an image'], ['กลับ', 'Back'], ['พิมพ์ก่อนว่าอยากได้ภาพอะไร', 'Describe the picture you want first'],
  ['แต่งภาพ', 'Edit photo'], ['แก้ภาพ', 'Edit'], ['ระบายแล้วสั่งด้วยข้อความ', 'Paint, then describe the change'], ['ต่อภาพให้กว้างขึ้น', 'Extend the picture'], ['ทำให้คมและใหญ่ขึ้น', 'Sharper and larger'],
  ['สไตล์', 'Styles'], ['แสงและบรรยากาศ', 'Light & mood'], ['อัปโหลดรูป แล้วแปลงเป็นสไตล์', 'Upload a photo and restyle it'], ['เปลี่ยนแสง คงหน้าเดิม', 'Change the light, keep the face'],
  ['อนิเมะ', 'Anime'], ['พิกเซลอาร์ต', 'Pixel art'], ['3D การ์ตูน', '3D cartoon'], ['สีน้ำ', 'Watercolor'], ['สีน้ำมัน', 'Oil painting'], ['ฟิล์มเก่า', 'Vintage film'],
  ['ท้องฟ้ายามเย็น', 'Sunset sky'], ['แสงทอง', 'Golden light'], ['หมอกเช้า', 'Morning mist'], ['นีออนกลางคืน', 'Neon night'], ['ฝนตก', 'Rainy day'],
  ['พิมพ์คำสั่งแต่งภาพ แล้วเลือกรูป', 'Type an instruction, then pick a photo'], ['เลือกภาพ', 'Choose photo'], ['แปลงภาพ', 'Restyle'], ['เพิ่มรายละเอียด (ไม่บังคับ)', 'Add details (optional)'], ['กำลังแปลงภาพ…', 'Restyling…'],
  ['เลือกรูปที่อยากแปลง แล้วกดแปลงภาพ ใส่รายละเอียดเพิ่มได้ถ้าต้องการ ภาพที่ได้จะเก็บไว้ในอัลบั้ม', 'Pick a photo, then tap Restyle. Add details if you like. Results are saved to the album.'], ['ใช้เวลาราว 40–90 วินาที', 'Takes about 40–90 seconds'],
  ['ลบพื้นหลัง', 'Remove background'], ['ได้ PNG พื้นหลังโปร่งใส', 'Get a transparent PNG'], ['กำลังลบพื้นหลัง…', 'Removing background…'], ['ใช้เวลาไม่กี่วินาที', 'Takes a few seconds'],
  ['เลือกรูป แล้วกดลบพื้นหลัง ได้ไฟล์ PNG โปร่งใส ใช้เวลาไม่กี่วินาที ไม่ใช้การ์ดจอ', 'Pick a photo and tap Remove background. You get a transparent PNG in a few seconds, no GPU needed.'],
  ['เทมเพลต', 'Templates'], ['เอาเทมเพลตออก', 'Remove template'],
  ['ภาพโปรไฟล์', 'Profile picture'], ['หน้าตรง แสงนุ่ม ฉากหลังเบลอ', 'Front-facing, soft light, blurred background'], ['สินค้าโชว์เด่น', 'Hero product'], ['สินค้าเป็นพระเอก ฉากสวยแบบโฆษณา', 'The product is the star, ad-style scene'],
  ['ภาพขายของ', 'E-commerce photo'], ['พื้นหลังสะอาด ไฟสตูดิโอ', 'Clean background, studio light'], ['โปสเตอร์', 'Poster'], ['องค์ประกอบกราฟิกโดดเด่น', 'Bold graphic composition'],
  ['ฉากภาพยนตร์', 'Cinematic scene'], ['โทนหนัง แสงมีอารมณ์', 'Film look, moody light'], ['อนิเมะ', 'Anime'], ['ภาพวาดสไตล์อนิเมะสีสด', 'Vivid anime-style illustration'],
  ['ฟิกเกอร์จิ๋ว', 'Mini figure'], ['ตุ๊กตาสะสมบนโต๊ะ ถ่ายมาโคร', 'Collectible figure on a desk, macro shot'], ['ภาพท่องเที่ยว', 'Travel photo'], ['โมเมนต์เที่ยวสบาย ๆ แสงทอง', 'Relaxed holiday moment, golden light'],
  ['วันนี้', 'Today'], ['เมื่อวาน', 'Yesterday'], ['7 วันก่อนหน้า', 'Previous 7 days'], ['30 วันก่อนหน้า', 'Previous 30 days'], ['เก่ากว่านั้น', 'Older'],
  ['ถามคำถาม สรุปเอกสาร ค้นข้อมูล หรือจัดการไฟล์ได้เลย', 'Ask questions, summarize documents, search, or manage files'],
  ['สวัสดีค่ะ วันนี้ให้ช่วยอะไรดี', 'Hello, how can I help today'],
  // voice / misc
  ['เสียง Lumicos', 'Lumicos voice'], ['หยุดเสียง / ปิด', 'Stop voice / off'], ['ทดสอบเสียง Lumicos', 'Test Lumicos voice'], ['ฟังเสียงภาษาไทย', 'Play Thai voice'],
  ['โมเดลและโหมดคิดเป็นคนละค่า การเลือกโมเดลจะไม่บังคับเปิด DEEP และ DEEP จะไม่สลับโมเดลเอง', 'Model and reasoning mode are separate. Choosing a model does not force DEEP, and DEEP does not switch models.'],
  // v10: memory + workspace pages were English-only in Thai mode
  ['สิ่งที่ AI จำเกี่ยวกับคุณข้ามแชต เฉพาะความจำที่เกี่ยวข้องเท่านั้นที่ถูกใส่ในพรอมต์', 'Things your AI remembers about you across chats. Only relevant memories are added to a prompt.'],
  ['ความจำใหม่', 'New memory'], ['แก้ไขความจำ', 'Edit memory'], ['ค้นหาความจำ', 'Search memories'], ['กรองตามตัวละคร', 'Filter by character'],
  ['ทุกตัวละคร', 'All characters'], ['ใช้ร่วมกันเท่านั้น', 'Shared only'], ['เฉพาะ', 'Only'], ['ทั้งหมด ·', 'All ·'],
  ['ข้อเท็จจริง', 'Fact'], ['ความชอบ', 'Preference'], ['โปรเจกต์', 'Project'], ['การตัดสินใจ', 'Decision'], ['คำสั่ง', 'Instruction'], ['ความสัมพันธ์', 'Relationship'], ['ทั่วไป', 'General'],
  ['สร้างเมื่อ', 'Created'], ['จำนวนครั้งที่ถูกใส่ในพรอมต์', 'Times added to a prompt'], ['ใช้แล้ว', 'used'], ['จากแชต “', 'from “'],
  ['ความสำคัญ {}', 'Importance {}'], ['ปักหมุด: ใช้ความจำนี้เสมอ', 'Pin: always consider this memory'], ['เลิกปักหมุด', 'Unpin'],
  ['เก็บไว้ในเครื่องนี้ที่', 'Stored on this PC in'], ['รีเฟรช', 'Refresh'], ['กลับไปแชต', 'Back to chat'],
  ['ไม่มีความจำที่ตรงกับตัวกรอง', 'No memories match these filters.'], ['ยังไม่มีความจำ บันทึกจากคำแนะนำในแชต หรือเพิ่มเองได้เลย', 'No memories yet. Save suggestions from your chats, or add one yourself.'],
  ['ลบความจำนี้?', 'Delete this memory?'], ['จะถูกลืม และกู้คืนไม่ได้', 'will be forgotten. This can’t be undone.'],
  ['คำแนะนำที่รอคุณอยู่ ·', 'Suggestions waiting for you ·'], ['ปักหมุด — พิจารณาเสมอ แม้ไม่มีคำที่ตรงกัน', 'Pinned — always considered, even without matching words'],
  ['AI เข้าถึงไฟล์ได้เฉพาะในโฟลเดอร์นี้เท่านั้น', 'Your AI can only access files in here.'], ['โฟลเดอร์ใหม่', 'New folder'], ['อัปโหลด', 'Upload'],
  ['ประเภท', 'Type'], ['ขนาด', 'Size'], ['แก้ไขล่าสุด', 'Modified'], ['ดาวน์โหลด', 'Download'], ['ย้าย', 'Move'], ['คัดลอก', 'Copy'],
  ['โฟลเดอร์', 'Folder'], ['ข้อความ', 'Text'], ['เอกสาร Word', 'Word document'], ['ไฟล์ Excel', 'Excel workbook'], ['รูปภาพ', 'Image'], ['ไฟล์ทั่วไป', 'File'],
  ['โฟลเดอร์นี้ว่าง ลากไฟล์มาวางที่นี่หรือกดอัปโหลด', 'This folder is empty. Drop files here or use Upload.'],
  ['ปิดตัวอย่าง', 'Close preview'], ['เอกสารนี้ไม่มีข้อความ', 'This document has no text.'], ['สมุดงานว่างเปล่า', 'Empty workbook.'],
  ['ไม่มีตัวอย่างสำหรับไฟล์ประเภทนี้ ดาวน์โหลดได้', 'No preview for this file type. You can download it.'], ['ว่างเปล่า', 'Empty.'],
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
type Tpl = { re: RegExp; to: string };
const toEn = new Map<string, string>(), toTh = new Map<string, string>();
const tplEn: Tpl[] = [], tplTh: Tpl[] = [];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mkTpl = (from: string, to: string): Tpl => ({ re: new RegExp('^' + esc(norm(from)).replace(/\\\{\\\}/g, '(.+)') + '$'), to });
for (const [th, en] of PAIRS) {
  if (th === en) continue;
  if (th.includes('{}')) { tplEn.push(mkTpl(th, en)); tplTh.push(mkTpl(en, th)); continue; }
  if (!toEn.has(norm(th))) toEn.set(norm(th), en);
  if (!toTh.has(norm(en))) toTh.set(norm(en), th);
}
/** Translation of one label into the chosen language, or undefined when there is none. */
const lookup = (text: string, to: Lang): string | undefined => {
  const k = norm(text);
  if (!k) return undefined;
  const hit = (to === 'en' ? toEn : toTh).get(k);
  if (hit !== undefined) return hit === k ? undefined : hit;
  for (const t of to === 'en' ? tplEn : tplTh) { const m = t.re.exec(k); if (m) { let i = 0; return t.to.replace('{}', () => m[++i] ?? ''); } }
  return undefined;
};

let lang: Lang = (() => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'th'; } catch { return 'th'; } })();
export const getLang = () => lang;
export const tr = (th: string, en: string) => (lang === 'en' ? en : th);
export function setLang(next: Lang) {
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  document.documentElement.lang = next;
  scan(document.body);
  window.dispatchEvent(new Event(EVENT));
}

const SKIP = 'textarea, input, script, style, code, pre, svg, [data-no-i18n], .msg, .markdown, .bubble, .history-item-title, .history-title, .memory-text';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const texts = new WeakMap<Node, { orig: string; out: string }>();
const attrs = new WeakMap<Element, Record<string, { orig: string; out: string }>>();

function doText(n: Node) {
  const cur = n.nodeValue ?? '';
  const rec = texts.get(n);
  const base = rec && rec.out === cur ? rec.orig : cur;
  const hit = lookup(base, lang);
  if (hit === undefined) { if (rec && rec.out === cur) { n.nodeValue = base; texts.delete(n); } return; }
  const lead = base.match(/^\s*/)![0], trail = base.match(/\s*$/)![0];
  const out = lead + hit + trail;
  if (out === cur) return;
  texts.set(n, { orig: base, out });
  n.nodeValue = out;
}
function doAttrs(el: Element) {
  let rec = attrs.get(el);
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur === null) continue;
    const r = rec?.[a];
    const base = r && r.out === cur ? r.orig : cur;
    const hit = lookup(base, lang);
    if (hit === undefined) { if (r && r.out === cur) { el.setAttribute(a, base); delete rec![a]; } continue; }
    if (hit === cur) continue;
    rec = rec ?? {}; rec[a] = { orig: base, out: hit }; attrs.set(el, rec);
    el.setAttribute(a, hit);
  }
}
function scan(root: Node) {
  if (root.nodeType === 3) { if (!root.parentElement?.closest(SKIP)) doText(root); return; }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  if (el.closest(SKIP)) return;
  doAttrs(el);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n: Node | null = w.nextNode();
  while (n) {
    if (n.nodeType === 3) { if (!n.parentElement?.closest(SKIP)) doText(n); }
    else if (!(n as Element).closest(SKIP)) doAttrs(n as Element);
    n = w.nextNode();
  }
}

export function startI18n() {
  document.documentElement.lang = lang;
  let queued = false;
  const pending = new Set<Node>();
  const flush = () => { queued = false; const items = [...pending]; pending.clear(); for (const n of items) if (n.isConnected) scan(n); };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => pending.add(n));
      else if (m.type === 'characterData') pending.add(m.target);
      else if (m.target.nodeType === 1) pending.add(m.target);
    }
    if (!queued && pending.size) { queued = true; setTimeout(flush, 30); }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  scan(document.body);
}

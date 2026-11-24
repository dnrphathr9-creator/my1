// Unit Test: ทดสอบฟังก์ชันตรวจข้อมูล (รันด้วยคำสั่ง npm test)
const test = require('node:test');
const assert = require('node:assert');
const { validateRequest, validateStatus } = require('../validate');

test('ข้อมูลครบถูกต้อง ต้องผ่าน (คืนค่า null)', () => {
  assert.strictEqual(validateRequest({ title: 'คอมเปิดไม่ติด', category_id: 1 }), null);
});

test('หัวข้อสั้นกว่า 3 ตัวอักษร ต้องไม่ผ่าน', () => {
  assert.strictEqual(validateRequest({ title: 'ab', category_id: 1 }), 'หัวข้อต้องมีอย่างน้อย 3 ตัวอักษร');
});

test('ไม่เลือกประเภท ต้องไม่ผ่าน', () => {
  assert.strictEqual(validateRequest({ title: 'คอมเปิดไม่ติด' }), 'กรุณาเลือกประเภท');
});

test('สถานะต้องเป็น pending, doing, done เท่านั้น', () => {
  assert.strictEqual(validateStatus('doing'), null);
  assert.strictEqual(validateStatus('zzz'), 'สถานะไม่ถูกต้อง');
});

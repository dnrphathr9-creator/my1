// ตรวจข้อมูลรายการแจ้งซ่อม คืนข้อความ error หรือ null ถ้าข้อมูลถูกต้อง
function validateRequest(data) {
  if (!data.title || data.title.trim().length < 3) return 'หัวข้อต้องมีอย่างน้อย 3 ตัวอักษร';
  if (!data.category_id) return 'กรุณาเลือกประเภท';
  return null;
}

// ตรวจสถานะ ต้องเป็น pending, doing หรือ done เท่านั้น
function validateStatus(status) {
  if (!['pending', 'doing', 'done'].includes(status)) return 'สถานะไม่ถูกต้อง';
  return null;
}

module.exports = { validateRequest, validateStatus };

require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { auth, allow } = require('./auth');
const { validateRequest, validateStatus } = require('./validate');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// เก็บไฟล์ที่อัปโหลดไว้ในโฟลเดอร์ uploads ตั้งชื่อใหม่กันซ้ำ จำกัด 2MB
const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + '.' + file.originalname.split('.').pop()),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ================= เข้าสู่ระบบ =================

/**
 * POST /api/auth/login  เข้าสู่ระบบ ได้ token
 * body: username, password
 */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ status: 'error', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({
    status: 'success',
    message: 'เข้าสู่ระบบสำเร็จ',
    data: { token, user: { id: user.id, full_name: user.full_name, role: user.role } },
  });
});

// ================= หน้าหลัก (Dashboard) =================

/**
 * GET /api/dashboard  สรุปจำนวนรายการตามสถานะ และ 5 รายการล่าสุด
 * user เห็นเฉพาะของตัวเอง / tech และ admin เห็นทั้งหมด
 */
app.get('/api/dashboard', auth, async (req, res) => {
  let where = '';
  const params = [];
  if (req.user.role === 'user') { where = 'WHERE r.user_id = ?'; params.push(req.user.id); }

  const [counts] = await pool.query(
    `SELECT r.status, COUNT(*) AS total FROM requests r ${where} GROUP BY r.status`,
    params
  );
  const summary = { total: 0, pending: 0, doing: 0, done: 0 };
  for (const row of counts) {
    summary[row.status] = row.total;
    summary.total += row.total;
  }

  const [latest] = await pool.query(
    `SELECT r.id, r.title, r.status, r.created_at, c.name AS category_name
     FROM requests r JOIN categories c ON r.category_id = c.id
     ${where} ORDER BY r.id DESC LIMIT 5`,
    params
  );
  res.json({ status: 'success', message: 'ดึงข้อมูลสำเร็จ', data: { summary, latest } });
});

// ================= ประเภทงานซ่อม =================

/**
 * GET /api/categories  ดูประเภทงานซ่อมทั้งหมด
 */
app.get('/api/categories', auth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM categories');
  res.json({ status: 'success', message: 'ดึงข้อมูลสำเร็จ', data: rows });
});

// ================= รายการแจ้งซ่อม =================

/**
 * GET /api/requests  ดูรายการ ค้นหา กรอง แบ่งหน้า
 * query: search, status, category_id, page
 * user เห็นเฉพาะของตัวเอง / tech และ admin เห็นทั้งหมด
 */
app.get('/api/requests', auth, async (req, res) => {
  const { search, status, category_id } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = 5;

  let where = 'WHERE 1=1';
  const params = [];
  if (req.user.role === 'user') { where += ' AND r.user_id = ?'; params.push(req.user.id); }
  if (search) { where += ' AND r.title LIKE ?'; params.push('%' + search + '%'); }
  if (status) { where += ' AND r.status = ?'; params.push(status); }
  if (category_id) { where += ' AND r.category_id = ?'; params.push(category_id); }

  const [count] = await pool.query(`SELECT COUNT(*) AS total FROM requests r ${where}`, params);
  const [rows] = await pool.query(
    `SELECT r.*, c.name AS category_name, u.full_name
     FROM requests r
     JOIN categories c ON r.category_id = c.id
     JOIN users u ON r.user_id = u.id
     ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]
  );
  const totalPages = Math.ceil(count[0].total / limit) || 1;
  res.json({ status: 'success', message: 'ดึงข้อมูลสำเร็จ', data: { items: rows, page, totalPages } });
});

/**
 * GET /api/requests/:id  ดู 1 รายการ
 * path: id
 */
app.get('/api/requests/:id', auth, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM requests WHERE id = ? AND (user_id = ? OR ? <> 'user')",
    [req.params.id, req.user.id, req.user.role]
  );
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อมูล' });
  res.json({ status: 'success', message: 'ดึงข้อมูลสำเร็จ', data: rows[0] });
});

/**
 * POST /api/requests  เพิ่มรายการพร้อมรูป (user, admin)
 * body (form-data): title, detail, category_id, image
 */
app.post('/api/requests', auth, allow('user', 'admin'), upload.single('image'), async (req, res) => {
  const { title, detail, category_id } = req.body;
  const error = validateRequest(req.body);
  if (error) return res.status(400).json({ status: 'error', message: error });
  const image = req.file ? req.file.filename : null;
  await pool.query(
    'INSERT INTO requests (user_id, category_id, title, detail, image) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, category_id, title, detail, image]
  );
  res.status(201).json({ status: 'success', message: 'บันทึกข้อมูลสำเร็จ' });
});

/**
 * PUT /api/requests/:id  แก้ไขรายการ ถ้าแนบรูปใหม่จะใช้รูปใหม่แทน
 * user แก้ได้เฉพาะของตัวเอง / admin แก้ได้ทุกรายการ
 * path: id   body (form-data): title, detail, category_id, image
 */
app.put('/api/requests/:id', auth, allow('user', 'admin'), upload.single('image'), async (req, res) => {
  const { title, detail, category_id } = req.body;
  const error = validateRequest(req.body);
  if (error) return res.status(400).json({ status: 'error', message: error });
  const [result] = await pool.query(
    "UPDATE requests SET title = ?, detail = ?, category_id = ? WHERE id = ? AND (user_id = ? OR ? = 'admin')",
    [title, detail, category_id, req.params.id, req.user.id, req.user.role]
  );
  if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อมูล' });
  if (req.file) {
    await pool.query('UPDATE requests SET image = ? WHERE id = ?', [req.file.filename, req.params.id]);
  }
  res.json({ status: 'success', message: 'แก้ไขข้อมูลสำเร็จ' });
});

/**
 * PATCH /api/requests/:id/status  เปลี่ยนสถานะ (tech, admin)
 * path: id   body (JSON): status = pending | doing | done
 */
app.patch('/api/requests/:id/status', auth, allow('tech', 'admin'), async (req, res) => {
  const error = validateStatus(req.body.status);
  if (error) return res.status(400).json({ status: 'error', message: error });
  const [result] = await pool.query('UPDATE requests SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อมูล' });
  res.json({ status: 'success', message: 'เปลี่ยนสถานะสำเร็จ' });
});

/**
 * DELETE /api/requests/:id  ลบรายการ (admin)
 * path: id
 */
app.delete('/api/requests/:id', auth, allow('admin'), async (req, res) => {
  const [result] = await pool.query('DELETE FROM requests WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อมูล' });
  res.json({ status: 'success', message: 'ลบข้อมูลสำเร็จ' });
});

// ================= จัดการข้อผิดพลาด =================

app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'ไม่พบ API นี้' });
});

app.use((err, req, res, next) => {
  console.log(err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ status: 'error', message: 'ไฟล์ต้องมีขนาดไม่เกิน 2MB' });
  }
  res.status(500).json({ status: 'error', message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
});

// ================= เริ่มเซิร์ฟเวอร์ =================

app.listen(process.env.PORT, async () => {
  console.log('Server รันที่ http://localhost:' + process.env.PORT);
  try {
    await pool.query('SELECT 1');
    console.log('เชื่อมต่อฐานข้อมูลสำเร็จ');

    // สร้างผู้ใช้ทดสอบ 4 คน รหัสผ่าน 1234 (ถ้ามีอยู่แล้วจะข้ามไป)
    const hash = await bcrypt.hash('1234', 10);
    await pool.query(
      `INSERT IGNORE INTO users (username, password, full_name, role) VALUES
       ('admin', ?, 'สมหญิง ดูแลดี', 'admin'),
       ('user1', ?, 'สมชาย ใจดี', 'user'),
       ('user2', ?, 'สมใจ รักเรียน', 'user'),
       ('tech1', ?, 'ช่างสมศักดิ์', 'tech')`,
      [hash, hash, hash, hash]
    );
  } catch (err) {
    console.log('เชื่อมต่อฐานข้อมูลไม่ได้: ' + err.message);
  }
});

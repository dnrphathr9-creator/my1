require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { auth, allow } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + '.' + file.originalname.split('.').pop()),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
});

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

app.get('/api/categories', auth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM categories');
  res.json({ status: 'success', message: 'ดึงข้อมูลสำเร็จ', data: rows });
});

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

app.get('/api/requests/:id', auth, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM requests WHERE id = ? AND (user_id = ? OR ? <> 'user')",
    [req.params.id, req.user.id, req.user.role]
  );
  if (!rows[0]) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อมูล' });
  res.json({ status: 'success', message: 'ดึงข้อมูลสำเร็จ', data: rows[0] });
});

app.post('/api/requests', auth, allow('user', 'admin'), upload.single('image'), async (req, res) => {
  const { title, detail, category_id } = req.body;
  if (!title || !category_id) {
    return res.status(400).json({ status: 'error', message: 'กรุณากรอกหัวข้อและเลือกประเภท' });
  }
  const image = req.file ? req.file.filename : null;
  await pool.query(
    'INSERT INTO requests (user_id, category_id, title, detail, image) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, category_id, title, detail, image]
  );
  res.status(201).json({ status: 'success', message: 'บันทึกข้อมูลสำเร็จ' });
});

app.put('/api/requests/:id', auth, allow('user', 'admin'), upload.single('image'), async (req, res) => {
  const { title, detail, category_id } = req.body;
  if (!title || !category_id) {
    return res.status(400).json({ status: 'error', message: 'กรุณากรอกหัวข้อและเลือกประเภท' });
  }
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

app.patch('/api/requests/:id/status', auth, allow('tech', 'admin'), async (req, res) => {
  if (!['pending', 'doing', 'done'].includes(req.body.status)) {
    return res.status(400).json({ status: 'error', message: 'สถานะไม่ถูกต้อง' });
  }
  const [result] = await pool.query('UPDATE requests SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อมูล' });
  res.json({ status: 'success', message: 'เปลี่ยนสถานะสำเร็จ' });
});

app.delete('/api/requests/:id', auth, allow('admin'), async (req, res) => {
  const [result] = await pool.query('DELETE FROM requests WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ status: 'error', message: 'ไม่พบข้อมูล' });
  res.json({ status: 'success', message: 'ลบข้อมูลสำเร็จ' });
});

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

app.listen(process.env.PORT, async () => {
  console.log('Server รันที่ http://localhost:' + process.env.PORT);
  try {
    await pool.query('SELECT 1');
    console.log('เชื่อมต่อฐานข้อมูลสำเร็จ');

    // สร้างผู้ใช้ทดสอบ 3 คน รหัสผ่าน 1234 (ถ้ามีอยู่แล้วจะข้ามไป)
    const hash = await bcrypt.hash('1234', 10);
    await pool.query(
      `INSERT IGNORE INTO users (username, password, full_name, role) VALUES
       ('admin', ?, 'สมหญิง ดูแลดี', 'admin'),
       ('user1', ?, 'สมชาย ใจดี', 'user'),
       ('tech1', ?, 'ช่างสมศักดิ์', 'tech')`,
      [hash, hash, hash]
    );
  } catch (err) {
    console.log('เชื่อมต่อฐานข้อมูลไม่ได้: ' + err.message);
  }
});

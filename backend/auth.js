const jwt = require('jsonwebtoken');

// ด่านที่ 1: ตรวจว่าเข้าสู่ระบบแล้ว (มี token ที่ถูกต้อง)
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ status: 'error', message: 'กรุณาเข้าสู่ระบบ' });
  }
}

// ด่านที่ 2: ตรวจว่าบทบาทของผู้ใช้อยู่ในรายการที่อนุญาต
function allow(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์ใช้งาน' });
  };
}

module.exports = { auth, allow };

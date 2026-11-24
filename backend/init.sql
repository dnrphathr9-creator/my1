SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS repairdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE repairdb;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('admin', 'user', 'tech') NOT NULL
);

CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  detail TEXT,
  image VARCHAR(255),
  status ENUM('pending', 'doing', 'done') NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

INSERT INTO categories (name) VALUES
('คอมพิวเตอร์'), ('เครือข่าย'), ('ไฟฟ้า'), ('อื่น ๆ');

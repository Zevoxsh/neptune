CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user', 'client') NOT NULL,
  parent_id INT NULL,
  disk_quota_mb INT NOT NULL DEFAULT 5120,
  disk_used_mb INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS domains (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(253) NOT NULL,
  type ENUM('domain', 'subdomain') NOT NULL,
  parent_domain_id INT NULL,
  document_root VARCHAR(500) NOT NULL,
  php_version VARCHAR(10) NOT NULL DEFAULT '8.2',
  ssl_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ssl_type ENUM('letsencrypt', 'manual') NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ssl_certificates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  domain_id INT NOT NULL,
  type ENUM('letsencrypt', 'manual') NOT NULL,
  cert_path VARCHAR(500) NOT NULL,
  key_path VARCHAR(500) NOT NULL,
  expires_at DATETIME NOT NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `databases` (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  db_name VARCHAR(64) NOT NULL UNIQUE,
  db_user VARCHAR(32) NOT NULL UNIQUE,
  db_password_hash VARCHAR(255) NOT NULL,
  size_mb INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ftp_accounts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  ftp_username VARCHAR(64) NOT NULL UNIQUE,
  ftp_password_hash VARCHAR(255) NOT NULL,
  home_dir VARCHAR(500) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NULL,
  target_id INT NULL,
  ip_address VARCHAR(45) NOT NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS client_permissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  permission_key VARCHAR(64) NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE KEY unique_perm (user_id, permission_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

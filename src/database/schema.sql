-- USERS & WALLETS
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    phone VARCHAR(50),
    language ENUM('en', 'am') DEFAULT 'en',
    role ENUM('user', 'admin') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE wallets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL,
    balance DECIMAL(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- TRANSACTIONS (Financial Ledger)
CREATE TABLE wallet_transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    type ENUM('DEPOSIT', 'GAME_STAKE', 'GAME_REFUND', 'GAME_WIN', 'WITHDRAWAL', 'REFERRAL_REWARD', 'ADMIN_ADJUSTMENT') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    balance_before DECIMAL(12, 2) NOT NULL,
    balance_after DECIMAL(12, 2) NOT NULL,
    reference_id VARCHAR(255), -- ID of the deposit, withdrawal, or game
    room_id BIGINT,
    cartela_id BIGINT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- PAYMENTS
CREATE TABLE deposit_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    method VARCHAR(50) NOT NULL, -- e.g., 'TELEBIRR', 'CBE'
    transaction_id VARCHAR(255) UNIQUE NOT NULL,
    status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    resolved_by BIGINT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE withdrawal_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    method VARCHAR(50) NOT NULL,
    account_info VARCHAR(255) NOT NULL,
    status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    resolved_by BIGINT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- BINGO ROOMS & CARTELAS
CREATE TABLE rooms (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_number VARCHAR(50) UNIQUE NOT NULL,
    status ENUM('WAITING', 'STARTING', 'PLAYING', 'FINISHED', 'CANCELLED') DEFAULT 'WAITING',
    stake DECIMAL(10, 2) DEFAULT 10.00,
    max_players INT DEFAULT 100,
    current_players INT DEFAULT 0,
    prize_pool DECIMAL(12, 2) DEFAULT 0.00,
    start_time TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE room_cartelas (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_id BIGINT NOT NULL,
    cartela_number INT NOT NULL CHECK (cartela_number BETWEEN 1 AND 100),
    user_id BIGINT NULL,
    status ENUM('AVAILABLE', 'TAKEN') DEFAULT 'AVAILABLE',
    selected_at TIMESTAMP NULL,
    UNIQUE KEY unique_room_cartela (room_id, cartela_number), -- CRITICAL CONCURRENCY LOCK
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- GAME ENGINE (Stateless Array + Timestamps)
CREATE TABLE games (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_id BIGINT UNIQUE NOT NULL,
    draw_order JSON NOT NULL, -- [43, 12, 67, 5, 29...] Pre-shuffled 1-75 array
    call_interval_seconds INT DEFAULT 5,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP NULL,
    gross_pot DECIMAL(12, 2) NOT NULL,
    house_fee DECIMAL(12, 2) NOT NULL,
    winner_pool DECIMAL(12, 2) NOT NULL,
    status ENUM('ACTIVE', 'FINISHED') DEFAULT 'ACTIVE',
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE game_winners (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    game_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    cartela_number INT NOT NULL,
    pattern VARCHAR(50) NOT NULL,
    prize_amount DECIMAL(12, 2) NOT NULL,
    won_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- SYSTEM CONFIG
CREATE TABLE settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default Settings Insert
INSERT INTO settings (setting_key, setting_value) VALUES
('house_fee_percent', '20'),
('default_stake', '10.00'),
('min_withdrawal', '50.00'),
('call_interval', '5');
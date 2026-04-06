-- Launcher news table (for persistent news from Discord)
CREATE TABLE IF NOT EXISTS launcher_news (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

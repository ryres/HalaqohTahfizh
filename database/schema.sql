-- HalaqohTahfizh Database Schema
-- Idempotent: all tables use CREATE TABLE IF NOT EXISTS

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- Table: users
-- ============================================================
CREATE TABLE IF NOT EXISTS `users` (
    `id`         INT          NOT NULL AUTO_INCREMENT,
    `username`   VARCHAR(50)  NOT NULL UNIQUE,
    `password`   VARCHAR(255) NOT NULL,
    `role`       ENUM('admin', 'guru_tahfizh', 'user') NOT NULL DEFAULT 'user',
    `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_users_username` (`username`),
    INDEX `idx_users_role`     (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table: guru
-- ============================================================
CREATE TABLE IF NOT EXISTS `guru` (
    `id`         INT          NOT NULL AUTO_INCREMENT,
    `nama`       VARCHAR(100) NOT NULL,
    `jabatan`    VARCHAR(100) DEFAULT NULL,
    `unit`       VARCHAR(100) DEFAULT NULL,
    `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_guru_nama` (`nama`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table: halaqoh
-- ============================================================
CREATE TABLE IF NOT EXISTS `halaqoh` (
    `id`           INT          NOT NULL AUTO_INCREMENT,
    `nama_halaqoh` VARCHAR(100) NOT NULL,
    `guru_id`      INT          DEFAULT NULL,
    `ruangan`      VARCHAR(100) DEFAULT NULL,
    `jadwal`       VARCHAR(100) DEFAULT NULL,
    `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_halaqoh_guru_id`      (`guru_id`),
    INDEX `idx_halaqoh_nama_halaqoh` (`nama_halaqoh`),
    CONSTRAINT `fk_halaqoh_guru`
        FOREIGN KEY (`guru_id`) REFERENCES `guru` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table: santri
-- ============================================================
CREATE TABLE IF NOT EXISTS `santri` (
    `id`          INT          NOT NULL AUTO_INCREMENT,
    `nama`        VARCHAR(100) NOT NULL,
    `kelas`       VARCHAR(20)  DEFAULT NULL,
    `juz`         INT          NOT NULL,
    `surat`       VARCHAR(100) DEFAULT NULL,
    `ayat`        INT          DEFAULT NULL,
    `baris`       INT          DEFAULT NULL,
    `setoran_tgl` DATE         DEFAULT NULL,
    `tajwid`      INT          DEFAULT NULL,
    `kelancaran`  INT          DEFAULT NULL,
    `makhraj`     INT          DEFAULT NULL,
    `halaqoh_id`  INT          DEFAULT NULL,
    `guru_id`     INT          DEFAULT NULL,
    `user_id`     INT          DEFAULT NULL,
    `target_juz`  INT          DEFAULT 30,
    `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_santri_halaqoh_id`  (`halaqoh_id`),
    INDEX `idx_santri_guru_id`     (`guru_id`),
    INDEX `idx_santri_user_id`     (`user_id`),
    INDEX `idx_santri_juz`         (`juz`),
    INDEX `idx_santri_setoran_tgl` (`setoran_tgl`),
    CONSTRAINT `fk_santri_halaqoh`
        FOREIGN KEY (`halaqoh_id`) REFERENCES `halaqoh` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_santri_guru`
        FOREIGN KEY (`guru_id`) REFERENCES `guru` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_santri_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table: delete_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS `delete_requests` (
    `id`           INT          NOT NULL AUTO_INCREMENT,
    `santri_id`    INT          NOT NULL,
    `requested_by` INT          NOT NULL,
    `reason`       TEXT         DEFAULT NULL,
    `status`       ENUM('pending', 'approved', 'rejected', 'deleted') NOT NULL DEFAULT 'pending',
    `approved_at`  DATETIME     DEFAULT NULL,
    `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_delete_requests_santri_id`    (`santri_id`),
    INDEX `idx_delete_requests_requested_by` (`requested_by`),
    INDEX `idx_delete_requests_status`       (`status`),
    CONSTRAINT `fk_delete_requests_santri`
        FOREIGN KEY (`santri_id`) REFERENCES `santri` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_delete_requests_user`
        FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table: logs
-- ============================================================
CREATE TABLE IF NOT EXISTS `logs` (
    `id`         INT          NOT NULL AUTO_INCREMENT,
    `user_id`    INT          DEFAULT NULL,
    `username`   VARCHAR(50)  DEFAULT NULL,
    `action`     VARCHAR(100) NOT NULL,
    `details`    TEXT         DEFAULT NULL,
    `ip_address` VARCHAR(45)  DEFAULT NULL,
    `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_logs_user_id`    (`user_id`),
    INDEX `idx_logs_action`     (`action`),
    INDEX `idx_logs_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table: notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS `notifications` (
    `id`         INT          NOT NULL AUTO_INCREMENT,
    `user_id`    INT          NOT NULL,
    `title`      VARCHAR(200) NOT NULL,
    `message`    TEXT         DEFAULT NULL,
    `type`       ENUM('info', 'success', 'warning', 'error') NOT NULL DEFAULT 'info',
    `link`       VARCHAR(255) DEFAULT NULL,
    `is_read`    TINYINT(1)   NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_notifications_user_id`    (`user_id`),
    INDEX `idx_notifications_is_read`    (`is_read`),
    INDEX `idx_notifications_created_at` (`created_at`),
    CONSTRAINT `fk_notifications_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

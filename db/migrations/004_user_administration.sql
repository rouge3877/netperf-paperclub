ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin'));
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1));
ALTER TABLE users ADD COLUMN require_password_change INTEGER NOT NULL DEFAULT 0 CHECK(require_password_change IN (0,1));
ALTER TABLE users ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

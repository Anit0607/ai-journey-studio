
CREATE TABLE IF NOT EXISTS studio_auth_user (
 id TEXT PRIMARY KEY CHECK(id='studio-owner'), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 "emailVerified" BOOLEAN NOT NULL DEFAULT true, image TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_auth_account (
 id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL CHECK("providerId"='credential'),
 "userId" TEXT NOT NULL REFERENCES studio_auth_user(id), password TEXT NOT NULL,
 "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT, "accessTokenExpiresAt" TIMESTAMPTZ,
 "refreshTokenExpiresAt" TIMESTAMPTZ, scope TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL,
 UNIQUE("providerId","accountId")
);
CREATE TABLE IF NOT EXISTS studio_auth_session (
 id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES studio_auth_user(id), token TEXT NOT NULL UNIQUE,
 "expiresAt" TIMESTAMPTZ NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL,
 "ipAddress" TEXT, "userAgent" TEXT
);
CREATE INDEX IF NOT EXISTS studio_auth_session_expiry ON studio_auth_session("expiresAt");
CREATE TABLE IF NOT EXISTS studio_auth_verification (
 id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
 "expiresAt" TIMESTAMPTZ NOT NULL, "createdAt" TIMESTAMPTZ, "updatedAt" TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS studio_auth_rate_limit (
 id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, "lastRequest" DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_owner_login_guard (
 id INTEGER PRIMARY KEY CHECK(id=1), attempts INTEGER NOT NULL DEFAULT 0,
 window_started TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO studio_owner_login_guard(id) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO schema_versions(version) VALUES(10) ON CONFLICT DO NOTHING;

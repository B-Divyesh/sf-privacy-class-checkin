use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use chrono::Utc;
use ed25519_dalek::{Signer, SigningKey};
use hmac::{Hmac, Mac};
use rand::{distributions::Alphanumeric, Rng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    collections::HashMap,
    env,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
    str::FromStr,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime},
};
use subtle::ConstantTimeEq;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
    signing_key: Arc<SigningKey>,
    build_sha: String,
    rate_limits: Arc<Mutex<HashMap<String, RateWindow>>>,
    demos: Arc<Mutex<HashMap<String, DemoWorkspace>>>,
    dist: Arc<PathBuf>,
}

#[derive(Clone)]
struct DemoRosterEntry {
    id: String,
    alias: String,
    status: String,
    checked_at: Option<i64>,
    source: Option<String>,
}

#[derive(Clone)]
struct DemoWorkspace {
    created_at: Instant,
    created_unix: i64,
    seed: String,
    learner_token: String,
    roster: Vec<DemoRosterEntry>,
}

struct RateWindow {
    started_at: Instant,
    count: u32,
}

#[derive(Debug)]
struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn bad(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(error = %error, "request failed");
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Something went wrong. Please try again.".into(),
    )
}

fn random_secret(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut value);
    hex::encode(value)
}

/// Returns a stable signing secret without requiring operators to supply one.
///
/// The database and this file deliberately live together: a local SQLite database
/// is a single-instance deployment boundary, and its exports must remain
/// verifiable after a normal container restart. An explicit environment value is
/// still supported for managed-secret deployments.
fn signing_secret_path(database_url: &str) -> Option<PathBuf> {
    database_file_path(database_url).map(|path| path.with_extension("export-signing-key"))
}

fn database_file_path(database_url: &str) -> Option<PathBuf> {
    database_url
        .strip_prefix("sqlite://")?
        .split('?')
        .next()
        .filter(|path| !path.is_empty() && *path != ":memory:")
        .map(PathBuf::from)
}

struct StartupGuard {
    path: PathBuf,
}

impl Drop for StartupGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

async fn acquire_startup_guard(database_url: &str) -> io::Result<StartupGuard> {
    let database = database_file_path(database_url).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "startup serialization needs a file-backed SQLite database",
        )
    })?;
    let path = database.with_extension("startup-lock");
    loop {
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                writeln!(file, "{}", Utc::now().timestamp())?;
                file.sync_all()?;
                return Ok(StartupGuard { path });
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let stale = fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                    .is_some_and(|age| age > Duration::from_secs(60));
                if stale {
                    let _ = fs::remove_file(&path);
                } else {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
            Err(error) => return Err(error),
        }
    }
}

fn recover_empty_bootstrap(database_url: &str) -> io::Result<bool> {
    let Some(database) = database_file_path(database_url) else {
        return Ok(false);
    };
    let journal = PathBuf::from(format!("{}-journal", database.display()));
    if fs::metadata(&database).is_ok_and(|metadata| metadata.len() == 0) && journal.exists() {
        fs::remove_file(&journal)?;
        fs::remove_file(&database)?;
        let dot_lock = PathBuf::from(format!("{}.lock", database.display()));
        if dot_lock.is_dir() {
            fs::remove_dir(&dot_lock)?;
        }
        return Ok(true);
    }
    Ok(false)
}

fn read_or_create_signing_secret(path: &FsPath) -> io::Result<(String, bool)> {
    if let Ok(mut file) = OpenOptions::new().read(true).open(path) {
        let mut existing = String::new();
        file.read_to_string(&mut existing)?;
        if !existing.trim().is_empty() {
            return Ok((existing.trim().to_owned(), false));
        }
        // Runtime startup holds the cross-replica startup guard while calling
        // this function, so an empty file is an interrupted bootstrap rather
        // than an in-progress write from another process.
        drop(file);
        fs::remove_file(path)?;
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let generated = random_secret(32);
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o600))?;
            }
            file.write_all(generated.as_bytes())?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            Ok((generated, true))
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            // Another process created it between our first read and create. Read
            // its value so both processes retain one signing identity.
            let mut existing = String::new();
            OpenOptions::new()
                .read(true)
                .open(path)?
                .read_to_string(&mut existing)?;
            if existing.trim().is_empty() {
                Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "persisted export signing key is empty",
                ))
            } else {
                Ok((existing.trim().to_owned(), false))
            }
        }
        Err(error) => Err(error),
    }
}

fn load_signing_secret(database_url: &str) -> io::Result<(String, &'static str)> {
    if let Ok(secret) = env::var("EXPORT_SIGNING_KEY") {
        if secret.trim().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "EXPORT_SIGNING_KEY must not be empty",
            ));
        }
        return Ok((secret, "supplied"));
    }
    let path = signing_secret_path(database_url).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "a file-backed SQLite DATABASE_URL is required without EXPORT_SIGNING_KEY",
        )
    })?;
    let (secret, generated) = read_or_create_signing_secret(&path)?;
    Ok((secret, if generated { "generated" } else { "persisted" }))
}

fn hash(value: &str) -> String {
    hex::encode(Sha256::digest(value.trim().to_ascii_lowercase().as_bytes()))
}

fn secure_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

fn session_code(seed: &str, bucket: i64) -> String {
    let mut mac = HmacSha256::new_from_slice(seed.as_bytes()).expect("hmac key");
    mac.update(bucket.to_string().as_bytes());
    let bytes = mac.finalize().into_bytes();
    let number = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{number:06}")
}

fn token() -> String {
    const PLANTS: &[&str] = &[
        "fern", "moss", "cedar", "sage", "aster", "birch", "clover", "willow",
    ];
    let mut rng = rand::thread_rng();
    let tail: String = (0..8)
        .map(|_| rng.sample(Alphanumeric) as char)
        .collect::<String>()
        .to_ascii_uppercase();
    format!("{}-{tail}", PLANTS[rng.gen_range(0..PLANTS.len())])
}

async fn security_headers(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert(HeaderName::from_static("content-security-policy"), HeaderValue::from_static("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' https://api.sociobot.in https://pilot-api.sociobot.in; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"));
    response
}

async fn rate_limit(State(state): State<AppState>, request: Request<Body>, next: Next) -> Response {
    if request.uri().path() == "/health" {
        return next.run(request).await;
    }
    let forwarded = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("local");
    let is_api = request.uri().path().starts_with("/api/");
    let is_write =
        request.method() != axum::http::Method::GET && request.method() != axum::http::Method::HEAD;
    let (bucket, allowance, window) = if is_api && is_write {
        ("api-write", 30, Duration::from_secs(10))
    } else if is_api {
        ("api-read", 80, Duration::from_secs(10))
    } else {
        ("page", 1_000, Duration::from_secs(10))
    };
    let key = format!("{forwarded}:{bucket}");
    let retry_after = {
        let mut limits = match state.rate_limits.lock() {
            Ok(limits) => limits,
            Err(_) => return internal("rate limiter lock").into_response(),
        };
        limits.retain(|_, item| item.started_at.elapsed() < Duration::from_secs(60));
        let item = limits.entry(key).or_insert(RateWindow {
            started_at: Instant::now(),
            count: 0,
        });
        if item.started_at.elapsed() >= window {
            item.started_at = Instant::now();
            item.count = 0;
        }
        if item.count >= allowance {
            Some(
                window
                    .saturating_sub(item.started_at.elapsed())
                    .as_secs()
                    .max(1),
            )
        } else {
            item.count += 1;
            None
        }
    };
    if let Some(seconds) = retry_after {
        let mut response = ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests from this connection. Wait a few seconds and try again.".into(),
        )
        .into_response();
        response.headers_mut().insert(
            header::RETRY_AFTER,
            HeaderValue::from_str(&seconds.to_string()).unwrap_or(HeaderValue::from_static("1")),
        );
        return response;
    }
    next.run(request).await
}

fn is_hashed_asset(path: &str) -> bool {
    let Some(file) = path.strip_prefix("/assets/") else {
        return false;
    };
    let Some((stem, _extension)) = file.rsplit_once('.') else {
        return false;
    };
    let Some((_name, fingerprint)) = stem.rsplit_once('-') else {
        return false;
    };
    fingerprint.len() >= 8
        && fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn cache_control(path: &str) -> &'static str {
    if path.starts_with("/api/") || path == "/health" {
        "no-store"
    } else if is_hashed_asset(path) {
        "public, max-age=31536000, immutable"
    } else {
        // HTML fallbacks, the manifest, and sw.js must be checked on every
        // navigation so a new release can take control without a stale shell.
        "no-cache"
    }
}

async fn cache_headers(request: Request<Body>, next: Next) -> Response {
    let policy = cache_control(request.uri().path());
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(policy));
    response
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateClass {
    class_name: String,
    roster: Vec<String>,
    retention_days: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IssuedToken {
    id: String,
    alias: String,
    token: String,
}

async fn create_class(
    State(state): State<AppState>,
    Json(input): Json<CreateClass>,
) -> ApiResult<impl IntoResponse> {
    let name = input.class_name.trim();
    if !(2..=80).contains(&name.chars().count()) {
        return Err(bad("Class name must be 2–80 characters."));
    }
    if input.roster.is_empty() || input.roster.len() > 60 {
        return Err(bad("Add between 1 and 60 pseudonyms."));
    }
    let retention = input.retention_days.unwrap_or(30);
    if !(1..=365).contains(&retention) {
        return Err(bad("Retention must be between 1 and 365 days."));
    }
    let mut aliases = Vec::new();
    for alias in input.roster {
        let cleaned = alias.trim().to_string();
        if cleaned.is_empty() || cleaned.chars().count() > 40 {
            return Err(bad("Each pseudonym must be 1–40 characters."));
        }
        if aliases
            .iter()
            .any(|a: &String| a.eq_ignore_ascii_case(&cleaned))
        {
            return Err(bad(format!("Pseudonym “{cleaned}” is duplicated.")));
        }
        aliases.push(cleaned);
    }
    let class_id = Uuid::new_v4().to_string();
    let teacher_key = random_secret(24);
    let now = Utc::now().timestamp();
    let mut tx = state.pool.begin().await.map_err(internal)?;
    sqlx::query(
        "INSERT INTO classes(id,name,teacher_key_hash,retention_days,created_at) VALUES(?,?,?,?,?)",
    )
    .bind(&class_id)
    .bind(name)
    .bind(hash(&teacher_key))
    .bind(retention)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    let mut issued = Vec::new();
    for alias in aliases {
        let roster_id = Uuid::new_v4().to_string();
        let roster_token = token();
        sqlx::query(
            "INSERT INTO roster(id,class_id,alias,token_hash,created_at) VALUES(?,?,?,?,?)",
        )
        .bind(&roster_id)
        .bind(&class_id)
        .bind(&alias)
        .bind(hash(&roster_token))
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
        issued.push(IssuedToken {
            id: roster_id,
            alias,
            token: roster_token,
        });
    }
    tx.commit().await.map_err(internal)?;
    Ok((
        StatusCode::CREATED,
        Json(
            json!({"classId": class_id, "teacherKey": teacher_key, "className": name, "retentionDays": retention, "roster": issued}),
        ),
    ))
}

async fn authorize(
    pool: &SqlitePool,
    class_id: &str,
    headers: &HeaderMap,
) -> ApiResult<sqlx::sqlite::SqliteRow> {
    let supplied = headers
        .get("x-teacher-key")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let row = sqlx::query(
        "SELECT id,name,teacher_key_hash,retention_days,created_at FROM classes WHERE id=?",
    )
    .bind(class_id)
    .fetch_optional(pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Class not found.".into()))?;
    if !secure_eq(
        &hash(supplied),
        row.get::<String, _>("teacher_key_hash").as_str(),
    ) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Teacher key is missing or incorrect.".into(),
        ));
    }
    Ok(row)
}

async fn get_class(
    Path(class_id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let class = authorize(&state.pool, &class_id, &headers).await?;
    let roster =
        sqlx::query("SELECT id,alias FROM roster WHERE class_id=? ORDER BY alias COLLATE NOCASE")
            .bind(&class_id)
            .fetch_all(&state.pool)
            .await
            .map_err(internal)?;
    let sessions = sqlx::query("SELECT id,started_at,ends_at,closed_at FROM sessions WHERE class_id=? ORDER BY started_at DESC LIMIT 20")
        .bind(&class_id).fetch_all(&state.pool).await.map_err(internal)?;
    Ok(Json(json!({
        "id": class_id, "name": class.get::<String,_>("name"), "retentionDays": class.get::<i64,_>("retention_days"),
        "roster": roster.into_iter().map(|r| json!({"id":r.get::<String,_>("id"),"alias":r.get::<String,_>("alias")})).collect::<Vec<_>>(),
        "sessions": sessions.into_iter().map(|r| json!({"id":r.get::<String,_>("id"),"startedAt":r.get::<i64,_>("started_at"),"endsAt":r.get::<i64,_>("ends_at"),"closedAt":r.get::<Option<i64>,_>("closed_at")})).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartSession {
    late_after_minutes: Option<i64>,
    duration_minutes: Option<i64>,
}

async fn start_session(
    Path(class_id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<StartSession>,
) -> ApiResult<impl IntoResponse> {
    authorize(&state.pool, &class_id, &headers).await?;
    let late = input.late_after_minutes.unwrap_or(10);
    let duration = input.duration_minutes.unwrap_or(60);
    if !(1..=120).contains(&late) || !(5..=240).contains(&duration) || late >= duration {
        return Err(bad("Choose a late threshold before the session end."));
    }
    let now = Utc::now().timestamp();
    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sessions WHERE class_id=? AND closed_at IS NULL AND ends_at>?",
    )
    .bind(&class_id)
    .bind(now)
    .fetch_one(&state.pool)
    .await
    .map_err(internal)?;
    if existing > 0 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Close the current session before starting another.".into(),
        ));
    }
    let id = Uuid::new_v4().to_string();
    let seed = random_secret(20);
    sqlx::query(
        "INSERT INTO sessions(id,class_id,seed,started_at,late_at,ends_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(&id)
    .bind(&class_id)
    .bind(&seed)
    .bind(now)
    .bind(now + late * 60)
    .bind(now + duration * 60)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    Ok((StatusCode::CREATED, Json(json!({"sessionId":id}))))
}

async fn session_detail(
    Path((class_id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    authorize(&state.pool, &class_id, &headers).await?;
    let s = sqlx::query("SELECT id,seed,started_at,late_at,ends_at,closed_at FROM sessions WHERE id=? AND class_id=?")
        .bind(&session_id).bind(&class_id).fetch_optional(&state.pool).await.map_err(internal)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Session not found.".into()))?;
    let rows = sqlx::query("SELECT r.id,r.alias,c.status,c.checked_at,c.source FROM roster r LEFT JOIN checkins c ON c.roster_id=r.id AND c.session_id=? WHERE r.class_id=? ORDER BY r.alias COLLATE NOCASE")
        .bind(&session_id).bind(&class_id).fetch_all(&state.pool).await.map_err(internal)?;
    let now = Utc::now().timestamp();
    let closed: Option<i64> = s.get("closed_at");
    let active = closed.is_none() && s.get::<i64, _>("ends_at") > now;
    Ok(Json(json!({
        "id":session_id, "code": if active { session_code(&s.get::<String,_>("seed"), now/90) } else { String::new() },
        "codeExpiresIn": 90-(now%90), "startedAt":s.get::<i64,_>("started_at"), "lateAt":s.get::<i64,_>("late_at"), "endsAt":s.get::<i64,_>("ends_at"), "closedAt":closed, "active":active,
        "roster": rows.into_iter().map(|r| json!({"id":r.get::<String,_>("id"),"alias":r.get::<String,_>("alias"),"status":r.get::<Option<String>,_>("status").unwrap_or_else(||"absent".into()),"checkedAt":r.get::<Option<i64>,_>("checked_at"),"source":r.get::<Option<String>,_>("source")})).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
struct Checkin {
    code: String,
    token: String,
}

async fn checkin(
    State(state): State<AppState>,
    Json(input): Json<Checkin>,
) -> ApiResult<Json<serde_json::Value>> {
    let code: String = input.code.chars().filter(|c| c.is_ascii_digit()).collect();
    if code.len() != 6 || input.token.trim().len() < 6 {
        return Err(bad(
            "Enter the six-digit session code and your roster token.",
        ));
    }
    let now = Utc::now().timestamp();
    let sessions = sqlx::query(
        "SELECT id,class_id,seed,late_at FROM sessions WHERE closed_at IS NULL AND ends_at>?",
    )
    .bind(now)
    .fetch_all(&state.pool)
    .await
    .map_err(internal)?;
    let found = sessions
        .into_iter()
        .find(|s| {
            let seed: String = s.get("seed");
            secure_eq(&code, &session_code(&seed, now / 90))
                || secure_eq(&code, &session_code(&seed, now / 90 - 1))
        })
        .ok_or_else(|| {
            ApiError(
                StatusCode::NOT_FOUND,
                "That code is not active. Ask the teacher for the current code.".into(),
            )
        })?;
    let roster = sqlx::query("SELECT id,alias FROM roster WHERE class_id=? AND token_hash=?")
        .bind(found.get::<String, _>("class_id"))
        .bind(hash(&input.token))
        .fetch_optional(&state.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| {
            ApiError(
                StatusCode::UNAUTHORIZED,
                "That roster token does not match this class. Check the label and try again."
                    .into(),
            )
        })?;
    let status = if now > found.get::<i64, _>("late_at") {
        "late"
    } else {
        "present"
    };
    let result = sqlx::query("INSERT INTO checkins(session_id,roster_id,status,checked_at,source) VALUES(?,?,?,?, 'student') ON CONFLICT(session_id,roster_id) DO NOTHING")
        .bind(found.get::<String,_>("id")).bind(roster.get::<String,_>("id")).bind(status).bind(now).execute(&state.pool).await.map_err(internal)?;
    let final_status: String =
        sqlx::query_scalar("SELECT status FROM checkins WHERE session_id=? AND roster_id=?")
            .bind(found.get::<String, _>("id"))
            .bind(roster.get::<String, _>("id"))
            .fetch_one(&state.pool)
            .await
            .map_err(internal)?;
    Ok(Json(
        json!({"alias":roster.get::<String,_>("alias"),"status":final_status,"recorded":result.rows_affected()==1}),
    ))
}

#[derive(Deserialize)]
struct StatusUpdate {
    status: String,
}

async fn update_status(
    Path((class_id, session_id, roster_id)): Path<(String, String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<StatusUpdate>,
) -> ApiResult<Json<serde_json::Value>> {
    authorize(&state.pool, &class_id, &headers).await?;
    if !["present", "late", "absent"].contains(&input.status.as_str()) {
        return Err(bad("Status must be present, late, or absent."));
    }
    let valid: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions s JOIN roster r ON r.class_id=s.class_id WHERE s.id=? AND s.class_id=? AND r.id=?")
        .bind(&session_id).bind(&class_id).bind(&roster_id).fetch_one(&state.pool).await.map_err(internal)?;
    if valid == 0 {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "Roster entry or session not found.".into(),
        ));
    }
    if input.status == "absent" {
        sqlx::query("DELETE FROM checkins WHERE session_id=? AND roster_id=?")
            .bind(&session_id)
            .bind(&roster_id)
            .execute(&state.pool)
            .await
            .map_err(internal)?;
    } else {
        sqlx::query("INSERT INTO checkins(session_id,roster_id,status,checked_at,source) VALUES(?,?,?,?, 'manual') ON CONFLICT(session_id,roster_id) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,source='manual'")
            .bind(&session_id).bind(&roster_id).bind(&input.status).bind(Utc::now().timestamp()).execute(&state.pool).await.map_err(internal)?;
    }
    Ok(Json(json!({"ok":true})))
}

async fn close_session(
    Path((class_id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    authorize(&state.pool, &class_id, &headers).await?;
    let done = sqlx::query(
        "UPDATE sessions SET closed_at=COALESCE(closed_at,?) WHERE id=? AND class_id=?",
    )
    .bind(Utc::now().timestamp())
    .bind(&session_id)
    .bind(&class_id)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    if done.rows_affected() == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "Session not found.".into()));
    }
    Ok(Json(json!({"ok":true})))
}

fn csv_cell(value: &str) -> String {
    let safe = if value.starts_with(['=', '+', '-', '@']) {
        format!("'{value}")
    } else {
        value.to_string()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

async fn export_csv(
    Path((class_id, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let class = authorize(&state.pool, &class_id, &headers).await?;
    let session = sqlx::query("SELECT started_at FROM sessions WHERE id=? AND class_id=?")
        .bind(&session_id)
        .bind(&class_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Session not found.".into()))?;
    let rows = sqlx::query("SELECT r.alias,COALESCE(c.status,'absent') status,c.checked_at,COALESCE(c.source,'automatic') source FROM roster r LEFT JOIN checkins c ON c.roster_id=r.id AND c.session_id=? WHERE r.class_id=? ORDER BY r.alias COLLATE NOCASE")
        .bind(&session_id).bind(&class_id).fetch_all(&state.pool).await.map_err(internal)?;
    let mut data = String::from("pseudonym,status,recorded_at_utc,source\r\n");
    for r in rows {
        let timestamp = r
            .get::<Option<i64>, _>("checked_at")
            .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
            .map(|d| d.to_rfc3339())
            .unwrap_or_default();
        data.push_str(&format!(
            "{},{},{},{}\r\n",
            csv_cell(&r.get::<String, _>("alias")),
            r.get::<String, _>("status"),
            timestamp,
            r.get::<String, _>("source")
        ));
    }
    let signature = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        state.signing_key.sign(data.as_bytes()).to_bytes(),
    );
    let public_key = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        state.signing_key.verifying_key().to_bytes(),
    );
    let created = Utc::now().to_rfc3339();
    let body = format!("# Privacy Class Check-in signed export\r\n# class={}\r\n# session_started={}\r\n# generated={}\r\n# signature=ed25519:{}\r\n# public_key=ed25519:{}\r\n{}", csv_cell(&class.get::<String,_>("name")), session.get::<i64,_>("started_at"), created, signature, public_key, data);
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=attendance.csv",
            ),
        ],
        body,
    )
        .into_response())
}

async fn delete_class(
    Path(class_id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    authorize(&state.pool, &class_id, &headers).await?;
    sqlx::query("DELETE FROM classes WHERE id=?")
        .bind(&class_id)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    Ok(Json(json!({"deleted":true})))
}

fn demo_view(id: &str, demo: &DemoWorkspace) -> serde_json::Value {
    let now = Utc::now().timestamp();
    let current_code = session_code(&demo.seed, now / 90);
    json!({
        "workspaceId": id,
        "expiresIn": 86_400_i64.saturating_sub(demo.created_at.elapsed().as_secs() as i64),
        "sampleToken": demo.learner_token,
        "class": {
            "id": format!("demo-{id}"),
            "name": "Tuesday science lab",
            "retentionDays": 7,
            "roster": demo.roster.iter().map(|entry| json!({"id":entry.id,"alias":entry.alias})).collect::<Vec<_>>(),
            "sessions": [{"id":"sample-session","startedAt":demo.created_unix,"endsAt":demo.created_unix + 3600,"closedAt":null}]
        },
        "session": {
            "id": "sample-session",
            "code": current_code,
            "codeExpiresIn": 90 - (now % 90),
            "startedAt": demo.created_unix,
            "lateAt": demo.created_unix + 600,
            "endsAt": demo.created_unix + 3600,
            "closedAt": null,
            "active": true,
            "roster": demo.roster.iter().map(|entry| json!({
                "id":entry.id,
                "alias":entry.alias,
                "status":entry.status,
                "checkedAt":entry.checked_at,
                "source":entry.source
            })).collect::<Vec<_>>()
        }
    })
}

fn purge_expired_demos(demos: &mut HashMap<String, DemoWorkspace>) {
    demos.retain(|_, demo| demo.created_at.elapsed() < Duration::from_secs(86_400));
}

async fn create_demo(State(state): State<AppState>) -> ApiResult<impl IntoResponse> {
    let aliases = [
        "Aster 01",
        "Birch 02",
        "Cedar 03",
        "Clover 04",
        "Fern 05",
        "Hazel 06",
        "Iris 07",
        "Juniper 08",
        "Linden 09",
        "Maple 10",
        "Moss 11",
        "Oak 12",
        "Pine 13",
        "Reed 14",
        "Sage 15",
        "Sorrel 16",
        "Spruce 17",
        "Thyme 18",
        "Violet 19",
        "Willow 20",
        "Yarrow 21",
        "Alder 22",
        "Beech 23",
        "Elm 24",
        "Laurel 25",
        "Rowan 26",
        "Bramble 27",
        "Heather 28",
        "Larch 29",
        "Rush 30",
    ];
    let created_unix = Utc::now().timestamp();
    let roster = aliases
        .iter()
        .enumerate()
        .map(|(index, alias)| {
            let (status, checked_at, source) = if index < 22 {
                (
                    "present",
                    Some(created_unix + 60 + index as i64 * 4),
                    Some("student"),
                )
            } else if index < 25 {
                (
                    "late",
                    Some(created_unix + 720 + index as i64 * 3),
                    Some("student"),
                )
            } else {
                ("absent", None, None)
            };
            DemoRosterEntry {
                id: format!("sample-roster-{}", index + 1),
                alias: (*alias).to_owned(),
                status: status.to_owned(),
                checked_at,
                source: source.map(str::to_owned),
            }
        })
        .collect();
    let id = random_secret(18);
    let demo = DemoWorkspace {
        created_at: Instant::now(),
        created_unix,
        seed: random_secret(20),
        learner_token: token(),
        roster,
    };
    let body = demo_view(&id, &demo);
    let mut demos = state.demos.lock().map_err(|_| internal("demo lock"))?;
    purge_expired_demos(&mut demos);
    demos.insert(id, demo);
    Ok((StatusCode::CREATED, Json(body)))
}

async fn get_demo(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> ApiResult<Json<serde_json::Value>> {
    let mut demos = state.demos.lock().map_err(|_| internal("demo lock"))?;
    purge_expired_demos(&mut demos);
    let demo = demos.get(&id).ok_or_else(|| {
        ApiError(
            StatusCode::NOT_FOUND,
            "This sample has expired. Reset the demo to start again.".into(),
        )
    })?;
    Ok(Json(demo_view(&id, demo)))
}

async fn delete_demo(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> ApiResult<Json<serde_json::Value>> {
    let mut demos = state.demos.lock().map_err(|_| internal("demo lock"))?;
    demos.remove(&id);
    Ok(Json(json!({"deleted":true})))
}

async fn demo_checkin(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(input): Json<Checkin>,
) -> ApiResult<Json<serde_json::Value>> {
    let now = Utc::now().timestamp();
    let code: String = input
        .code
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect();
    let mut demos = state.demos.lock().map_err(|_| internal("demo lock"))?;
    purge_expired_demos(&mut demos);
    let demo = demos.get_mut(&id).ok_or_else(|| {
        ApiError(
            StatusCode::NOT_FOUND,
            "This sample has expired. Reset the demo to start again.".into(),
        )
    })?;
    let code_matches = secure_eq(&code, &session_code(&demo.seed, now / 90))
        || secure_eq(&code, &session_code(&demo.seed, now / 90 - 1));
    if !code_matches {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "That sample code is no longer current. Refresh the sample and try again.".into(),
        ));
    }
    if !secure_eq(
        &input.token.trim().to_ascii_lowercase(),
        &demo.learner_token.to_ascii_lowercase(),
    ) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "That sample token does not match. Use the token shown in the demo.".into(),
        ));
    }
    let entry = demo
        .roster
        .last_mut()
        .ok_or_else(|| internal("sample roster is empty"))?;
    let recorded = entry.status == "absent";
    if recorded {
        entry.status = "present".into();
        entry.checked_at = Some(now);
        entry.source = Some("student".into());
    }
    Ok(Json(
        json!({"alias":entry.alias,"status":entry.status,"recorded":recorded}),
    ))
}

async fn update_demo_status(
    Path((id, roster_id)): Path<(String, String)>,
    State(state): State<AppState>,
    Json(input): Json<StatusUpdate>,
) -> ApiResult<Json<serde_json::Value>> {
    if !["present", "late", "absent"].contains(&input.status.as_str()) {
        return Err(bad("Status must be present, late, or absent."));
    }
    let mut demos = state.demos.lock().map_err(|_| internal("demo lock"))?;
    purge_expired_demos(&mut demos);
    let demo = demos.get_mut(&id).ok_or_else(|| {
        ApiError(
            StatusCode::NOT_FOUND,
            "This sample has expired. Reset the demo to start again.".into(),
        )
    })?;
    let entry = demo
        .roster
        .iter_mut()
        .find(|entry| entry.id == roster_id)
        .ok_or_else(|| {
            ApiError(
                StatusCode::NOT_FOUND,
                "Sample roster entry not found.".into(),
            )
        })?;
    entry.status = input.status;
    entry.checked_at = (entry.status != "absent").then(|| Utc::now().timestamp());
    entry.source = (entry.status != "absent").then(|| "manual".to_owned());
    Ok(Json(json!({"ok":true})))
}

async fn demo_export(Path(id): Path<String>, State(state): State<AppState>) -> ApiResult<Response> {
    let demos = state.demos.lock().map_err(|_| internal("demo lock"))?;
    let demo = demos
        .get(&id)
        .filter(|demo| demo.created_at.elapsed() < Duration::from_secs(86_400))
        .ok_or_else(|| {
            ApiError(
                StatusCode::NOT_FOUND,
                "This sample has expired. Reset the demo to start again.".into(),
            )
        })?;
    let mut data = String::from("pseudonym,status,recorded_at_utc,source\r\n");
    for entry in &demo.roster {
        let timestamp = entry
            .checked_at
            .and_then(|value| chrono::DateTime::from_timestamp(value, 0))
            .map(|value| value.to_rfc3339())
            .unwrap_or_default();
        data.push_str(&format!(
            "{},{},{},{}\r\n",
            csv_cell(&entry.alias),
            entry.status,
            timestamp,
            entry.source.as_deref().unwrap_or("automatic")
        ));
    }
    let signature = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        state.signing_key.sign(data.as_bytes()).to_bytes(),
    );
    let public_key = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        state.signing_key.verifying_key().to_bytes(),
    );
    let body = format!(
        "# Privacy Class Check-in signed sample export\r\n# class={}\r\n# session_started={}\r\n# generated={}\r\n# signature=ed25519:{}\r\n# public_key=ed25519:{}\r\n{}",
        csv_cell("Tuesday science lab"),
        demo.created_unix,
        Utc::now().to_rfc3339(),
        signature,
        public_key,
        data
    );
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=sample-attendance.csv",
            ),
        ],
        body,
    )
        .into_response())
}

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({"status":"ok","buildSha":state.build_sha}))
}

async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut connection = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(&mut *connection)
        .await?;

    // Container Apps can briefly start two replicas during a rolling update,
    // even though this service is constrained to one steady-state replica.
    // Taking the write reservation before reading schema state avoids two
    // starters deadlocking while both try to upgrade a read lock on /data.
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *connection)
        .await?;
    let result = async {
        sqlx::query("CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,name TEXT NOT NULL,teacher_key_hash TEXT NOT NULL,retention_days INTEGER NOT NULL,created_at INTEGER NOT NULL)").execute(&mut *connection).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS roster(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,alias TEXT NOT NULL,token_hash TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(class_id,token_hash))").execute(&mut *connection).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,seed TEXT NOT NULL,started_at INTEGER NOT NULL,late_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,closed_at INTEGER)").execute(&mut *connection).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS checkins(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,roster_id TEXT NOT NULL REFERENCES roster(id) ON DELETE CASCADE,status TEXT NOT NULL,checked_at INTEGER NOT NULL,source TEXT NOT NULL,PRIMARY KEY(session_id,roster_id))").execute(&mut *connection).await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ends_at,closed_at)")
            .execute(&mut *connection)
            .await?;
        sqlx::query("DELETE FROM classes WHERE created_at + retention_days * 86400 < ?")
            .bind(Utc::now().timestamp())
            .execute(&mut *connection)
            .await?;
        Ok::<(), sqlx::Error>(())
    }
    .await;

    match result {
        Ok(()) => {
            sqlx::query("COMMIT").execute(&mut *connection).await?;
            Ok(())
        }
        Err(error) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut *connection).await;
            Err(error)
        }
    }
}

async fn spa_page(State(state): State<AppState>) -> Response {
    match tokio::fs::read(state.dist.join("index.html")).await {
        Ok(body) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            body,
        )
            .into_response(),
        Err(error) => internal(error).into_response(),
    }
}

async fn not_found(State(state): State<AppState>) -> Response {
    match tokio::fs::read(state.dist.join("404.html")).await {
        Ok(body) => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            body,
        )
            .into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Page not found. Return to the home page.",
        )
            .into_response(),
    }
}

async fn api_not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "API endpoint not found.".into())
}

fn app(mut state: AppState, dist: PathBuf) -> Router {
    state.dist = Arc::new(dist.clone());
    let api = Router::new()
        .route("/classes", post(create_class))
        .route("/classes/{class_id}", get(get_class).delete(delete_class))
        .route("/classes/{class_id}/sessions", post(start_session))
        .route(
            "/classes/{class_id}/sessions/{session_id}",
            get(session_detail),
        )
        .route(
            "/classes/{class_id}/sessions/{session_id}/close",
            post(close_session),
        )
        .route(
            "/classes/{class_id}/sessions/{session_id}/roster/{roster_id}",
            put(update_status),
        )
        .route(
            "/classes/{class_id}/sessions/{session_id}/export",
            get(export_csv),
        )
        .route("/checkins", post(checkin))
        .route("/demo", post(create_demo))
        .route("/demo/{id}", get(get_demo).delete(delete_demo))
        .route("/demo/{id}/checkins", post(demo_checkin))
        .route("/demo/{id}/roster/{roster_id}", put(update_demo_status))
        .route("/demo/{id}/export", get(demo_export))
        .fallback(api_not_found)
        .layer(DefaultBodyLimit::max(64 * 1024));
    let pages = Router::new()
        .route("/", get(spa_page))
        .route("/demo", get(spa_page))
        .route("/privacy", get(spa_page))
        .route("/terms", get(spa_page))
        .route("/open-export", get(spa_page))
        .route_service("/sw.js", ServeFile::new(dist.join("sw.js")))
        .route_service(
            "/manifest.webmanifest",
            ServeFile::new(dist.join("manifest.webmanifest")),
        )
        .route_service("/favicon.svg", ServeFile::new(dist.join("favicon.svg")))
        .route_service(
            "/apple-touch-icon.png",
            ServeFile::new(dist.join("apple-touch-icon.png")),
        )
        .route_service(
            "/social-card.jpg",
            ServeFile::new(dist.join("social-card.jpg")),
        )
        .route_service("/robots.txt", ServeFile::new(dist.join("robots.txt")))
        .route_service("/sitemap.xml", ServeFile::new(dist.join("sitemap.xml")))
        .route_service("/404.css", ServeFile::new(dist.join("404.css")))
        .nest_service("/assets", ServeDir::new(dist.join("assets")))
        .fallback(not_found);
    Router::new()
        .route("/health", get(health))
        .nest("/api", api)
        .merge(pages)
        .layer(middleware::from_fn_with_state(state.clone(), rate_limit))
        .layer(middleware::from_fn(cache_headers))
        .layer(middleware::from_fn(security_headers))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    tracing::info!("shutdown signal received");
}

fn database_config() -> io::Result<(String, &'static str)> {
    if let Ok(value) = env::var("DATABASE_URL") {
        if !value.trim().is_empty() {
            return Ok((value, "supplied"));
        }
    }
    let (directory, source) = if FsPath::new("/data").is_dir() {
        (PathBuf::from("/data"), "durable /data")
    } else {
        let executable = env::current_exe()?;
        let parent = executable.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "cannot locate executable directory",
            )
        })?;
        (parent.join("data"), "local executable directory")
    };
    fs::create_dir_all(&directory)?;
    Ok((
        format!(
            "sqlite://{}?mode=rwc",
            directory.join("checkin.db").display()
        ),
        source,
    ))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let (database_url, database_source) =
        database_config().expect("choose a writable SQLite database location");
    if let Some(file) = database_url
        .strip_prefix("sqlite://")
        .and_then(|v| v.split('?').next())
    {
        if let Some(path) = std::path::Path::new(file).parent() {
            let _ = std::fs::create_dir_all(path);
        }
    }
    let startup_guard = acquire_startup_guard(&database_url)
        .await
        .expect("serialize sqlite startup");
    if recover_empty_bootstrap(&database_url).expect("recover an empty sqlite bootstrap") {
        tracing::warn!("removed an incomplete empty sqlite bootstrap");
    }
    let mut connect_options = SqliteConnectOptions::from_str(&database_url)
        .expect("parse sqlite database location")
        .busy_timeout(Duration::from_secs(120));
    if database_file_path(&database_url).is_some_and(|path| path.starts_with("/data")) {
        // Azure Files does not provide the byte-range lock behavior used by
        // SQLite's default Unix VFS. Dot-file locking uses atomic directory
        // operations supported by the mounted share.
        connect_options = connect_options.vfs("unix-dotfile");
    }
    let pool = SqlitePoolOptions::new()
        // SQLite is intentionally the persistence boundary for this small,
        // single-replica product. One connection prevents an Azure Files mount
        // from seeing competing SQLite file locks during startup or writes.
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .expect("connect sqlite");
    migrate(&pool).await.expect("migrate database");
    let (signing_secret, signing_key_source) =
        load_signing_secret(&database_url).expect("load or create persisted export signing key");
    drop(startup_guard);
    tracing::info!(
        database_source,
        signing_key_source,
        "durable configuration ready"
    );
    let signing_bytes: [u8; 32] = Sha256::digest(signing_secret.as_bytes()).into();
    let state = AppState {
        pool: pool.clone(),
        signing_key: Arc::new(SigningKey::from_bytes(&signing_bytes)),
        build_sha: env::var("BUILD_SHA")
            .unwrap_or_else(|_| option_env!("BUILD_SHA").unwrap_or("development").to_owned()),
        rate_limits: Arc::new(Mutex::new(HashMap::new())),
        demos: Arc::new(Mutex::new(HashMap::new())),
        dist: Arc::new(PathBuf::new()),
    };
    let cleanup_pool = pool.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3600)).await;
            if let Err(error) =
                sqlx::query("DELETE FROM classes WHERE created_at + retention_days * 86400 < ?")
                    .bind(Utc::now().timestamp())
                    .execute(&cleanup_pool)
                    .await
            {
                tracing::error!(%error,"retention cleanup failed");
            }
        }
    });
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .expect("bind");
    tracing::info!(port, "server listening");
    axum::serve(
        listener,
        app(
            state,
            PathBuf::from(env::var("DIST_DIR").unwrap_or_else(|_| "dist".into())),
        ),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("serve");
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    #[test]
    fn codes_are_stable_and_rotate() {
        let a = session_code("seed", 10);
        assert_eq!(a.len(), 6);
        assert_eq!(a, session_code("seed", 10));
        assert_ne!(a, session_code("seed", 11));
    }
    #[test]
    fn token_hash_is_case_insensitive() {
        assert_eq!(hash(" Fern-Ab12 "), hash("fern-ab12"));
    }
    #[test]
    fn csv_escapes_formula_and_quotes_as_data() {
        assert_eq!(csv_cell("a\"b"), "\"a\"\"b\"");
        assert_eq!(csv_cell("=1+1"), "\"'=1+1\"");
    }

    #[test]
    fn generated_signing_key_persists_beside_sqlite_database() {
        let root = std::env::temp_dir().join(format!("pcc-signing-key-{}", Uuid::new_v4()));
        let database_url = format!("sqlite://{}?mode=rwc", root.join("checkin.db").display());
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("checkin.export-signing-key"), []).unwrap();
        let (first, first_source) = load_signing_secret(&database_url).unwrap();
        let (second, second_source) = load_signing_secret(&database_url).unwrap();
        assert_eq!(first_source, "generated");
        assert_eq!(second_source, "persisted");
        assert_eq!(first, second);
        let first_key: [u8; 32] = Sha256::digest(first.as_bytes()).into();
        let second_key: [u8; 32] = Sha256::digest(second.as_bytes()).into();
        assert_eq!(
            SigningKey::from_bytes(&first_key).verifying_key(),
            SigningKey::from_bytes(&second_key).verifying_key()
        );
        let key = root.join("checkin.export-signing-key");
        assert!(key.is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&key).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn health_and_static_responses_have_release_safe_cache_policies() {
        let dist = std::env::temp_dir().join(format!("pcc-cache-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dist.join("assets")).unwrap();
        std::fs::write(
            dist.join("index.html"),
            "<!doctype html><title>test</title>",
        )
        .unwrap();
        std::fs::write(dist.join("sw.js"), "// generated worker").unwrap();
        std::fs::write(dist.join("assets/app-AbCdEfg1.js"), "export {};").unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let service = app(
            AppState {
                pool,
                signing_key: Arc::new(SigningKey::from_bytes(&[9u8; 32])),
                build_sha: "immutable-release-sha".into(),
                rate_limits: Arc::new(Mutex::new(HashMap::new())),
                demos: Arc::new(Mutex::new(HashMap::new())),
                dist: Arc::new(PathBuf::new()),
            },
            dist.clone(),
        );

        let health = service
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(json_body(health).await["buildSha"], "immutable-release-sha");

        for (uri, expected) in [
            (
                "/assets/app-AbCdEfg1.js",
                "public, max-age=31536000, immutable",
            ),
            ("/sw.js", "no-cache"),
            ("/privacy", "no-cache"),
        ] {
            let response = service
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
            assert_eq!(response.headers()[header::CACHE_CONTROL], expected, "{uri}");
        }
        std::fs::remove_dir_all(dist).unwrap();
    }

    async fn json_body(response: Response) -> serde_json::Value {
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }

    #[tokio::test]
    #[doc = "@claim:rotating-code"]
    async fn claim_rotating_code_and_closed_session_behavior() {
        assert_ne!(session_code("seed", 10), session_code("seed", 11));
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let state = AppState {
            pool,
            signing_key: Arc::new(SigningKey::from_bytes(&[7u8; 32])),
            build_sha: "test".into(),
            rate_limits: Arc::new(Mutex::new(HashMap::new())),
            demos: Arc::new(Mutex::new(HashMap::new())),
            dist: Arc::new(PathBuf::new()),
        };
        let service = app(state, std::env::temp_dir());
        let create=service.clone().oneshot(Request::builder().method("POST").uri("/api/classes").header("content-type","application/json").body(Body::from(r#"{"className":"Botany 101","roster":["Fern 01","Moss 02"],"retentionDays":7}"#)).unwrap()).await.unwrap();
        assert_eq!(create.status(), StatusCode::CREATED);
        let created = json_body(create).await;
        let class_id = created["classId"].as_str().unwrap();
        let key = created["teacherKey"].as_str().unwrap();
        let roster_id = created["roster"][0]["id"].as_str().unwrap();
        let roster_token = created["roster"][0]["token"].as_str().unwrap();
        let start = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/classes/{class_id}/sessions"))
                    .header("content-type", "application/json")
                    .header("x-teacher-key", key)
                    .body(Body::from(
                        r#"{"lateAfterMinutes":10,"durationMinutes":60}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(start.status(), StatusCode::CREATED);
        let started = json_body(start).await;
        let session_id = started["sessionId"].as_str().unwrap();
        let detail = service
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/classes/{class_id}/sessions/{session_id}"))
                    .header("x-teacher-key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let detail = json_body(detail).await;
        let code = detail["code"].as_str().unwrap();
        let submit = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/checkins")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"code":code,"token":roster_token}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(submit.status(), StatusCode::OK);
        let update = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!(
                        "/api/classes/{class_id}/sessions/{session_id}/roster/{roster_id}"
                    ))
                    .header("content-type", "application/json")
                    .header("x-teacher-key", key)
                    .body(Body::from(r#"{"status":"late"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(update.status(), StatusCode::OK);
        let export = service
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/classes/{class_id}/sessions/{session_id}/export"
                    ))
                    .header("x-teacher-key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(export.status(), StatusCode::OK);
        let csv = String::from_utf8(
            export
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
        .unwrap();
        assert!(csv.contains("signature=ed25519:"));
        assert!(csv.contains("late"));
        let close = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/classes/{class_id}/sessions/{session_id}/close"
                    ))
                    .header("x-teacher-key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(close.status(), StatusCode::OK);
        let stopped = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/checkins")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"code":code,"token":roster_token}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(stopped.status(), StatusCode::NOT_FOUND);
        let delete = service
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/classes/{class_id}"))
                    .header("x-teacher-key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(delete.status(), StatusCode::OK);
    }

    #[tokio::test]
    #[doc = "@claim:one-way-credentials"]
    async fn claim_one_way_credentials_are_not_stored_or_returned_readable() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let service = app(
            AppState {
                pool: pool.clone(),
                signing_key: Arc::new(SigningKey::from_bytes(&[3u8; 32])),
                build_sha: "test".into(),
                rate_limits: Arc::new(Mutex::new(HashMap::new())),
                demos: Arc::new(Mutex::new(HashMap::new())),
                dist: Arc::new(PathBuf::new()),
            },
            std::env::temp_dir(),
        );
        let create = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/classes")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"className":"Private class","roster":["Fern 01"],"retentionDays":7}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let created = json_body(create).await;
        let class_id = created["classId"].as_str().unwrap();
        let teacher_key = created["teacherKey"].as_str().unwrap();
        let roster_token = created["roster"][0]["token"].as_str().unwrap();
        let stored_teacher: String =
            sqlx::query_scalar("SELECT teacher_key_hash FROM classes WHERE id=?")
                .bind(class_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let stored_token: String =
            sqlx::query_scalar("SELECT token_hash FROM roster WHERE class_id=?")
                .bind(class_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_teacher.len(), 64);
        assert_eq!(stored_token.len(), 64);
        assert_ne!(stored_teacher, teacher_key);
        assert_ne!(stored_token, roster_token);
        let read = service
            .oneshot(
                Request::builder()
                    .uri(format!("/api/classes/{class_id}"))
                    .header("x-teacher-key", teacher_key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = String::from_utf8(
            read.into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
        .unwrap();
        assert!(!body.contains(teacher_key));
        assert!(!body.contains(roster_token));
    }

    #[tokio::test]
    #[doc = "@claim:retention-delete"]
    async fn claim_class_deletion_removes_all_related_records() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let service = app(
            AppState {
                pool: pool.clone(),
                signing_key: Arc::new(SigningKey::from_bytes(&[4u8; 32])),
                build_sha: "test".into(),
                rate_limits: Arc::new(Mutex::new(HashMap::new())),
                demos: Arc::new(Mutex::new(HashMap::new())),
                dist: Arc::new(PathBuf::new()),
            },
            std::env::temp_dir(),
        );
        let create = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/classes")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"className":"Delete test","roster":["Fern 01"],"retentionDays":7}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let created = json_body(create).await;
        let class_id = created["classId"].as_str().unwrap();
        let teacher_key = created["teacherKey"].as_str().unwrap();
        let start = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/classes/{class_id}/sessions"))
                    .header("content-type", "application/json")
                    .header("x-teacher-key", teacher_key)
                    .body(Body::from(
                        r#"{"lateAfterMinutes":10,"durationMinutes":60}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(start.status(), StatusCode::CREATED);
        let delete = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/classes/{class_id}"))
                    .header("x-teacher-key", teacher_key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(delete.status(), StatusCode::OK);
        for table in ["classes", "roster", "sessions", "checkins"] {
            let query = format!("SELECT COUNT(*) FROM {table}");
            let count: i64 = sqlx::query_scalar(&query).fetch_one(&pool).await.unwrap();
            assert_eq!(count, 0, "{table} retained rows after deletion");
        }
        let missing = service
            .oneshot(
                Request::builder()
                    .uri(format!("/api/classes/{class_id}"))
                    .header("x-teacher-key", teacher_key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        let expired_at = Utc::now().timestamp() - 172_800;
        sqlx::query("INSERT INTO classes(id,name,teacher_key_hash,retention_days,created_at) VALUES('expired','Expired class','hash',1,?)")
            .bind(expired_at)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO roster(id,class_id,alias,token_hash,created_at) VALUES('expired-roster','expired','Fern 01','hash',?)")
            .bind(expired_at)
            .execute(&pool)
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let expired_classes: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM classes WHERE id='expired'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let expired_roster: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM roster WHERE class_id='expired'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((expired_classes, expired_roster), (0, 0));
    }

    #[tokio::test]
    #[doc = "@claim:tenant-isolation"]
    async fn claim_teacher_keys_cannot_open_another_class() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let service = app(
            AppState {
                pool,
                signing_key: Arc::new(SigningKey::from_bytes(&[5u8; 32])),
                build_sha: "test".into(),
                rate_limits: Arc::new(Mutex::new(HashMap::new())),
                demos: Arc::new(Mutex::new(HashMap::new())),
                dist: Arc::new(PathBuf::new()),
            },
            std::env::temp_dir(),
        );
        let mut classes = Vec::new();
        for name in ["Class alpha", "Class beta"] {
            let response = service
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/classes")
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({"className":name,"roster":["Fern 01"],"retentionDays":7})
                                .to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            classes.push(json_body(response).await);
        }
        let forbidden = service
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/classes/{}",
                        classes[0]["classId"].as_str().unwrap()
                    ))
                    .header("x-teacher-key", classes[1]["teacherKey"].as_str().unwrap())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::UNAUTHORIZED);
        let allowed = service
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/classes/{}",
                        classes[0]["classId"].as_str().unwrap()
                    ))
                    .header("x-teacher-key", classes[0]["teacherKey"].as_str().unwrap())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
    }

    #[tokio::test]
    #[doc = "@claim:rate-limit"]
    async fn claim_limits_each_forwarded_client_and_returns_retry_after() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let service = app(
            AppState {
                pool,
                signing_key: Arc::new(SigningKey::from_bytes(&[6u8; 32])),
                build_sha: "test".into(),
                rate_limits: Arc::new(Mutex::new(HashMap::new())),
                demos: Arc::new(Mutex::new(HashMap::new())),
                dist: Arc::new(PathBuf::new()),
            },
            std::env::temp_dir(),
        );
        for attempt in 0..31 {
            let response = service
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/classes")
                        .header("content-type", "application/json")
                        .header("x-forwarded-for", "198.51.100.9, 10.0.0.4")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            if attempt < 30 {
                assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS);
            } else {
                assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
                assert!(response.headers().get(header::RETRY_AFTER).is_some());
            }
        }
        let other_client = service
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/classes")
                    .header("content-type", "application/json")
                    .header("x-forwarded-for", "203.0.113.10")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(other_client.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    #[doc = "@claim:restart-persistence"]
    async fn claim_file_database_and_signing_identity_survive_restart() {
        let root = std::env::temp_dir().join(format!("pcc-restart-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database_url = format!("sqlite://{}?mode=rwc", root.join("checkin.db").display());
        let (first_secret, first_source) = load_signing_secret(&database_url).unwrap();
        assert_eq!(first_source, "generated");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let service = app(
            AppState {
                pool: pool.clone(),
                signing_key: Arc::new(SigningKey::from_bytes(
                    &Sha256::digest(first_secret.as_bytes()).into(),
                )),
                build_sha: "test".into(),
                rate_limits: Arc::new(Mutex::new(HashMap::new())),
                demos: Arc::new(Mutex::new(HashMap::new())),
                dist: Arc::new(PathBuf::new()),
            },
            root.clone(),
        );
        let created = json_body(service.oneshot(Request::builder().method("POST").uri("/api/classes").header("content-type", "application/json").body(Body::from(r#"{"className":"Restart class","roster":["Fern 01"],"retentionDays":7}"#)).unwrap()).await.unwrap()).await;
        pool.close().await;
        let (second_secret, second_source) = load_signing_secret(&database_url).unwrap();
        assert_eq!(second_source, "persisted");
        assert_eq!(first_secret, second_secret);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let restarted = app(
            AppState {
                pool: pool.clone(),
                signing_key: Arc::new(SigningKey::from_bytes(
                    &Sha256::digest(second_secret.as_bytes()).into(),
                )),
                build_sha: "test".into(),
                rate_limits: Arc::new(Mutex::new(HashMap::new())),
                demos: Arc::new(Mutex::new(HashMap::new())),
                dist: Arc::new(PathBuf::new()),
            },
            root.clone(),
        );
        let read = restarted
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/classes/{}",
                        created["classId"].as_str().unwrap()
                    ))
                    .header("x-teacher-key", created["teacherKey"].as_str().unwrap())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(read.status(), StatusCode::OK);
        pool.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn startup_migration_waits_for_a_rolling_replica_lock() {
        let root = std::env::temp_dir().join(format!("pcc-rolling-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database_url = format!("sqlite://{}?mode=rwc", root.join("checkin.db").display());
        let options = SqliteConnectOptions::from_str(&database_url)
            .unwrap()
            .busy_timeout(Duration::from_secs(2));
        let first = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        let second = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();

        let mut lock = first.acquire().await.unwrap();
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut *lock)
            .await
            .unwrap();
        let migrating = tokio::spawn(async move { migrate(&second).await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!migrating.is_finished());
        sqlx::query("COMMIT").execute(&mut *lock).await.unwrap();
        drop(lock);
        migrating.await.unwrap().unwrap();

        let table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('classes','roster','sessions','checkins')",
        )
        .fetch_one(&first)
        .await
        .unwrap();
        assert_eq!(table_count, 4);
        first.close().await;
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn startup_guard_serializes_replicas_and_recovers_only_an_empty_database() {
        let root = std::env::temp_dir().join(format!("pcc-guard-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("checkin.db");
        let journal = root.join("checkin.db-journal");
        let dot_lock = root.join("checkin.db.lock");
        let database_url = format!("sqlite://{}?mode=rwc", database.display());
        fs::write(&database, []).unwrap();
        fs::write(&journal, b"incomplete bootstrap").unwrap();
        fs::create_dir(&dot_lock).unwrap();

        let first = acquire_startup_guard(&database_url).await.unwrap();
        assert!(recover_empty_bootstrap(&database_url).unwrap());
        assert!(!database.exists());
        assert!(!journal.exists());
        assert!(!dot_lock.exists());
        let waiting_url = database_url.clone();
        let waiting = tokio::spawn(async move { acquire_startup_guard(&waiting_url).await });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!waiting.is_finished());
        drop(first);
        let second = tokio::time::timeout(Duration::from_secs(2), waiting)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        drop(second);
        assert!(!root.join("checkin.startup-lock").exists());

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&database_url)
                    .unwrap()
                    .vfs("unix-dotfile"),
            )
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        pool.close().await;
        let database_bytes = fs::read(&database).unwrap();
        assert!(!database_bytes.is_empty());
        fs::write(&journal, b"journal").unwrap();
        assert!(!recover_empty_bootstrap(&database_url).unwrap());
        assert_eq!(fs::read(&database).unwrap(), database_bytes);
        fs::remove_dir_all(root).unwrap();
    }
}
